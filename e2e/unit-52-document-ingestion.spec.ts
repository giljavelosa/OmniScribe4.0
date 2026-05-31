import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

import { authStatePath } from './fixtures/seeded-users';

test.use({ storageState: authStatePath('clinician') });

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

test('Unit 52 document upload, extraction review, approval, and verified state', async ({ page }) => {
  const label = `E2E Unit 52 lab image ${Date.now()}`;

  await page.goto('/patients?query=James');
  await page.getByRole('link', { name: /park/i }).last().click();
  await page.waitForURL(/\/patients\/[a-z0-9-]+$/);
  const patientId = page.url().split('/patients/')[1]!;

  await page.getByTestId('open-prior-records').click();
  await page.getByRole('button', { name: /^upload document$/i }).first().click();
  await expect(page.getByRole('heading', { name: /add outside record/i })).toBeVisible();
  await page.getByLabel(/date of underlying event/i).fill('2026-05-01');
  await page.getByLabel(/source label/i).fill(label);
  await expect(page.getByRole('tab', { name: /upload document/i })).toHaveAttribute('data-state', 'active');
  await page.locator('#ec-document').setInputFiles({
    name: 'unit-52-lab.png',
    mimeType: 'image/png',
    buffer: PNG_1X1,
  });
  await page.getByRole('button', { name: /^upload document$/i }).last().click();
  const pendingDocumentRow = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
  await expect(pendingDocumentRow).toContainText(/extracting/i);

  const prisma = new PrismaClient();
  try {
    await expect
      .poll(async () => prisma.externalContext.findFirst({
        where: { patientId, sourceLabel: label },
        select: { id: true, orgId: true },
      }))
      .not.toBeNull();
    const row = await prisma.externalContext.findFirstOrThrow({
      where: { patientId, sourceLabel: label },
      select: { id: true, orgId: true },
    });

    process.env.AWS_BEARER_TOKEN_BEDROCK = '';
    process.env.BEDROCK_MODEL_ID = '';
    const { handle } = await import('../src/workers/external-context-extraction/handler');
    await handle({
      data: { externalContextId: row!.id, orgId: row!.orgId, requestId: `e2e-${Date.now()}` },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as Parameters<typeof handle>[0]);
  } finally {
    await prisma.$disconnect();
  }

  await page.reload();
  // Let the reloaded chart fully settle before interacting — the dev server
  // briefly double-renders the Overview while the force-dynamic page streams
  // and hydrates, so wait for network idle then a stable single rail.
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('open-prior-records')).toHaveCount(1);
  await page.getByTestId('open-prior-records').click();
  const documentRow = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
  await expect(documentRow).toContainText(/review pages/i);
  await documentRow.click();
  await page.getByLabel(/extracted summary/i).fill('Clinician-vetted E2E lab summary.');
  await page.getByRole('button', { name: /^approve batch$/i }).click();
  await page.getByRole('button', { name: /^approve pages$/i }).click();
  await expect(page.getByText(/final document review/i)).toBeVisible();
  await page.getByRole('button', { name: /^verify document$/i }).click();
  await page.getByRole('button', { name: /confirm verification/i }).click();
  await expect(page.getByText(/verified/i).first()).toBeVisible();
});

test('verified synthetic packet feeds patient UI and Miss Cleo chart retrieval', async ({ page }) => {
  const runId = Date.now();
  const patientId = `e2e-mock-doc-patient-${runId}`;
  const sourceLabel = `E2E mock packet ${runId}`;
  const fixturePath = 'tests/fixtures/ingestion/mock-large-medical-packet.pdf';
  const prisma = new PrismaClient();

  try {
    await prisma.patient.create({
      data: {
        id: patientId,
        orgId: 'seed-demo-clinic',
        siteId: 'seed-demo-site',
        firstName: 'Morgan',
        lastName: `Vale${runId}`,
        mrn: `MOCK-${runId}`,
        dob: new Date('1962-02-12T00:00:00Z'),
        sex: 'MALE',
        preferredLanguage: 'English',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
  } finally {
    await prisma.$disconnect();
  }

  await page.goto(`/patients/${patientId}`);
  await expect(page.getByRole('heading', { name: /morgan/i })).toBeVisible();
  await page.getByTestId('open-prior-records').first().click();
  await page.getByRole('button', { name: /^upload document$/i }).first().click();
  await expect(page.getByRole('heading', { name: /add outside record/i })).toBeVisible();
  await page.getByLabel(/date of underlying event/i).fill('2026-05-29');
  await page.getByLabel(/source label/i).fill(sourceLabel);
  await page.locator('#ec-document').setInputFiles(fixturePath);
  await page.getByRole('button', { name: /^upload document$/i }).last().click();
  await expect(page.getByRole('button', { name: new RegExp(sourceLabel, 'i') }).first())
    .toContainText(/extracting/i);

  const workerPrisma = new PrismaClient();
  try {
    await expect
      .poll(async () => workerPrisma.externalContext.findFirst({
        where: { patientId, sourceLabel },
        select: { id: true, orgId: true },
      }))
      .not.toBeNull();
    const row = await workerPrisma.externalContext.findFirstOrThrow({
      where: { patientId, sourceLabel },
      select: { id: true, orgId: true },
    });

    process.env.OMNISCRIBE_FILE_ROUTER_V2 = 'true';
    process.env.AWS_BEARER_TOKEN_BEDROCK = '';
    process.env.BEDROCK_MODEL_ID = '';
    const { handle } = await import('../src/workers/external-context-extraction/handler');
    await handle({
      data: { externalContextId: row.id, orgId: row.orgId, requestId: `e2e-cleodoc-${runId}` },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as Parameters<typeof handle>[0]);
  } finally {
    await workerPrisma.$disconnect();
  }

  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('open-prior-records').first().click();
  const documentRow = page.getByRole('button', { name: new RegExp(sourceLabel, 'i') }).first();
  await expect(documentRow).toContainText(/review pages/i);
  await documentRow.click();
  await expect(page.getByText(/batch review: pages 1-6/i)).toBeVisible();
  await page.getByLabel(/extracted summary/i).fill('Clinician-vetted E2E mock packet summary.');
  await page.getByRole('button', { name: /^approve batch$/i }).click();
  await page.getByRole('button', { name: /^approve pages$/i }).click();
  await expect(page.getByText(/final document review/i)).toBeVisible();
  await page.getByRole('button', { name: /^verify document$/i }).click();
  await page.getByRole('button', { name: /confirm verification/i }).click();
  await expect(page.getByText(/document verified/i)).toBeVisible();

  await page.goto(`/patients/${patientId}`);
  await expect(page.getByText(/10 current meds from verified records/i).last()).toBeVisible();
  const safetyBand = page.getByTestId('safety-band');
  await expect(safetyBand).toContainText(/Penicillin/i);
  await expect(safetyBand).toContainText(/Bee stings\/hymenoptera venom/i);
  await expect(safetyBand).toContainText(/Latex/i);
  await expect(page.getByTestId('open-prior-records').last()).toContainText(/1 verified record/i);

  await page.getByRole('button', { name: /ask me anything/i }).first().click();
  await expect(page.getByRole('heading', { name: /miss cleo/i })).toBeVisible();

  async function askCleo(question: string, expected: RegExp[]) {
    await page.getByPlaceholder(/ask about this patient/i).fill(question);
    await page.getByRole('button', { name: /^send$/i }).click();
    for (const pattern of expected) {
      await expect(page.getByText(pattern).last()).toBeVisible({ timeout: 15_000 });
    }
    await expect(page.getByText(/document · E2E mock packet/i).last()).toBeVisible();
  }

  await askCleo('What medications were listed in the uploaded packet?', [
    /Mycophenolate mofetil/i,
    /Metformin XR/i,
    /page 3/i,
  ]);
  await askCleo('What was the creatinine lab value in the uploaded outside record?', [
    /Creatinine was 1\.42/i,
    /page 4/i,
  ]);
  await askCleo('What allergies were documented in the outside records?', [
    /Penicillin/i,
    /Latex/i,
    /page 1/i,
  ]);
  await askCleo('What diagnoses or problems were listed in the uploaded records?', [
    /Heart transplant recipient/i,
    /Hypertension/i,
    /page 2/i,
  ]);
  await askCleo('Show me page 5 of the uploaded record.', [
    /Page 5 from the verified uploaded document/i,
    /Endomyocardial biopsy/i,
  ]);
  await askCleo('Is warfarin listed in the uploaded records?', [
    /did not find matching text/i,
  ]);
});
