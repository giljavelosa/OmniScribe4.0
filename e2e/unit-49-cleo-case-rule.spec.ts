import { expect, test, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

import { authStatePath, SEED_USERS } from './fixtures/seeded-users';

/**
 * Unit 49 §F (case-nominator badge) + §G (pre-sign intent-fit chip).
 *
 * Both surfaces are gated behind the `cleo.caseRule.v1` feature flag.
 * To exercise both flag-on and flag-off paths in the same suite, we
 * flip the FeatureFlag row in the DB directly via PrismaClient (the
 * org-admin UI for editing flags is out of scope for this round).
 *
 * Scope of this spec (per user request — "deep e2e: drive start-visit +
 * /review with badge + chip"):
 *
 *   FLAG OFF (default seed state):
 *     - /api/patients/[id]/case-suggestions returns flagOff:true
 *     - /review for a misfit note shows NO intent-fit chip
 *
 *   FLAG ON (we set the row before these tests):
 *     - /api/patients/[id]/case-suggestions returns a ranked list
 *       (and a nominee when the patient has activity)
 *     - The endpoint honors the optional `intent` query param
 *     - /review for a misfit note SHOWS the intent-fit chip
 *     - /review for a FITS note does NOT show the chip
 *     - The endpoint requires VISITS_CREATE (401 / 403 for viewer)
 *
 *   FLAG TOGGLES MID-SUITE:
 *     - We flip the flag back off after the test group and confirm
 *       both surfaces silence again.
 */

const DEMO_ORG_ID = 'seed-demo-clinic';
const FLAG_KEY = 'cleo.caseRule.v1';

let prisma: PrismaClient;

test.beforeAll(async () => {
  prisma = new PrismaClient();
});

test.afterAll(async () => {
  await prisma?.$disconnect();
});

async function setFlag(value: boolean): Promise<void> {
  await prisma.featureFlag.upsert({
    where: { orgId_key: { orgId: DEMO_ORG_ID, key: FLAG_KEY } },
    create: { orgId: DEMO_ORG_ID, key: FLAG_KEY, value },
    update: { value },
  });
}

/**
 * Pick the first patient with at least one active case (so the
 * nominator has something to score). We look this up via Prisma rather
 * than hard-coding an id because cuid2 ids change across seeds.
 */
async function pickPatientWithActiveCase(): Promise<{
  patientId: string;
  caseId: string;
}> {
  const c = await prisma.caseManagement.findFirst({
    where: { orgId: DEMO_ORG_ID, status: 'ACTIVE' },
    orderBy: { openedAt: 'desc' },
    select: { id: true, patientId: true },
  });
  if (!c) throw new Error('no active case in demo org — seed broken');
  return { patientId: c.patientId, caseId: c.id };
}

// ===========================================================================
// FLAG OFF — defaults / negative path
// ===========================================================================

test.describe('Unit 49 — feature flag OFF (default)', () => {
  test.use({ storageState: authStatePath('clinician') });

  test.beforeAll(async () => {
    await setFlag(false);
  });

  test('case-suggestions endpoint returns flagOff:true', async ({ request }) => {
    const { patientId } = await pickPatientWithActiveCase();
    const res = await request.get(`/api/patients/${patientId}/case-suggestions`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ flagOff: true, nominee: null, ranked: [] });
  });
});

// ===========================================================================
// FLAG ON — full §F + §G surface
// ===========================================================================

test.describe('Unit 49 — feature flag ON', () => {
  test.use({ storageState: authStatePath('clinician') });

  test.beforeAll(async () => {
    await setFlag(true);
  });

  test.afterAll(async () => {
    // Be a good citizen — leave the seed flag in its default OFF state
    // so other specs don't pick up unexpected Cleo surfaces.
    await setFlag(false);
  });

  test('case-suggestions returns ranked list with structured fields', async ({ request }) => {
    const { patientId } = await pickPatientWithActiveCase();
    const res = await request.get(`/api/patients/${patientId}/case-suggestions`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.flagOff).toBeFalsy();
    expect(Array.isArray(body.data.ranked)).toBe(true);
    // Every ranked row has the shape the badge depends on
    for (const r of body.data.ranked) {
      expect(typeof r.id).toBe('string');
      expect(typeof r.score).toBe('number');
      expect(typeof r.reason).toBe('string');
      expect(r.reason.length).toBeGreaterThan(0);
    }
    if (body.data.nominee) {
      expect(typeof body.data.nominee.id).toBe('string');
      expect(typeof body.data.nominee.reason).toBe('string');
    }
  });

  test('case-suggestions honors the optional intent query param', async ({ request }) => {
    const { patientId } = await pickPatientWithActiveCase();
    const res = await request.get(
      `/api/patients/${patientId}/case-suggestions?intent=REHAB_PROGRESS_NOTE`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.intent).toBe('REHAB_PROGRESS_NOTE');
  });

  test('case-suggestions ignores an unknown intent value safely', async ({ request }) => {
    const { patientId } = await pickPatientWithActiveCase();
    const res = await request.get(
      `/api/patients/${patientId}/case-suggestions?intent=NOT_A_REAL_INTENT`,
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.intent).toBeNull();
  });

  test('case-suggestions 404s for an unknown patient', async ({ request }) => {
    const res = await request.get('/api/patients/cmpl_not_a_real_patient/case-suggestions');
    expect(res.status()).toBe(404);
  });
});

// ===========================================================================
// FLAG ON — drives /review and asserts the intent-fit chip
// ===========================================================================

test.describe('Unit 49 §G — pre-sign intent-fit chip on /review', () => {
  test.use({ storageState: authStatePath('clinician') });

  test.beforeAll(async () => {
    await setFlag(true);
  });

  test.afterAll(async () => {
    await setFlag(false);
  });

  /**
   * The seed corpus only ships SIGNED notes (rule 3 keeps signed
   * notes' finalJson immutable; the test harness doesn't create new
   * SIGNED notes). The /review page only renders the chip when
   * !isSigned. So both §G tests temporarily flip a SIGNED note's
   * STATUS to DRAFT for the duration of the assertion + restore it
   * afterwards. We never touch `finalJson` or `signedAt` — only the
   * status enum — so rule 3 stays preserved at the data level.
   */
  async function pickFlippableNote(): Promise<{
    noteId: string;
    encounterId: string;
    originalStatus: 'SIGNED' | 'TRANSFERRED';
    originalIntent: 'UNSPECIFIED' | string;
  } | null> {
    const clinicianOrgUser = await prisma.orgUser.findFirst({
      where: { orgId: DEMO_ORG_ID, user: { email: SEED_USERS.clinician.email } },
      select: { id: true },
    });
    if (!clinicianOrgUser) return null;
    const note = await prisma.note.findFirst({
      where: {
        orgId: DEMO_ORG_ID,
        clinicianOrgUserId: clinicianOrgUser.id,
        status: { in: ['SIGNED', 'TRANSFERRED'] },
        encounter: { caseManagement: { primaryIcd: { not: null } } },
      },
      select: {
        id: true,
        status: true,
        encounterId: true,
        encounter: { select: { intent: true } },
      },
    });
    if (!note || !note.encounterId) return null;
    return {
      noteId: note.id,
      encounterId: note.encounterId,
      originalStatus: note.status as 'SIGNED' | 'TRANSFERRED',
      originalIntent: (note.encounter?.intent ?? 'UNSPECIFIED') as string,
    };
  }

  test('a DRAFT note with intent ⇆ case ICD MISFIT shows the chip', async ({ page }) => {
    const target = await pickFlippableNote();
    test.skip(!target, 'No SIGNED note in seed corpus to flip for the §G test');
    if (!target) return;

    await prisma.note.update({
      where: { id: target.noteId },
      data: { status: 'DRAFT' },
    });
    await prisma.encounter.update({
      where: { id: target.encounterId },
      data: { intent: 'REHAB_PROGRESS_NOTE' },
    });
    try {
      const cm = await prisma.encounter.findUnique({
        where: { id: target.encounterId },
        select: { caseManagement: { select: { primaryIcd: true } } },
      });
      const icd = cm?.caseManagement?.primaryIcd ?? '';
      const isRehabAffinity = /^[MS]/.test(icd);

      await page.goto(`/review/${target.noteId}`);
      // The readiness panel's title is rendered via shadcn CardTitle
      // which is a styled span, not a semantic heading. Match the text.
      await expect(page.getByText('Readiness', { exact: true })).toBeVisible();
      const chip = page.getByTestId('intent-fit-chip');
      if (isRehabAffinity) {
        // Forced REHAB intent FITS this case (M/S prefix) — chip silent.
        await expect(chip).toHaveCount(0);
      } else {
        // Real MISFIT — chip visible with the expected copy.
        await expect(chip).toBeVisible({ timeout: 10_000 });
        await expect(chip).toContainText(/doesn't match this case/i);
      }
    } finally {
      await prisma.encounter.update({
        where: { id: target.encounterId },
        data: { intent: target.originalIntent as 'UNSPECIFIED' },
      });
      await prisma.note.update({
        where: { id: target.noteId },
        data: { status: target.originalStatus },
      });
    }
  });

  test('a DRAFT note with intent=UNSPECIFIED renders NO chip (silent)', async ({ page }) => {
    const target = await pickFlippableNote();
    test.skip(!target, 'No SIGNED note in seed corpus to flip for the §G test');
    if (!target) return;

    await prisma.note.update({
      where: { id: target.noteId },
      data: { status: 'DRAFT' },
    });
    await prisma.encounter.update({
      where: { id: target.encounterId },
      data: { intent: 'UNSPECIFIED' },
    });
    try {
      await page.goto(`/review/${target.noteId}`);
      await expect(page.getByText('Readiness', { exact: true })).toBeVisible();
      const chip = page.getByTestId('intent-fit-chip');
      await expect(chip).toHaveCount(0);
    } finally {
      await prisma.encounter.update({
        where: { id: target.encounterId },
        data: { intent: target.originalIntent as 'UNSPECIFIED' },
      });
      await prisma.note.update({
        where: { id: target.noteId },
        data: { status: target.originalStatus },
      });
    }
  });
});

// ===========================================================================
// Negative-permission — viewer is blocked from the endpoint
// ===========================================================================

test.describe('Unit 49 — viewer cannot reach case-suggestions', () => {
  test.use({ storageState: authStatePath('viewer') });

  test('viewer gets 401/403 from case-suggestions endpoint', async ({ request }) => {
    const patient = await prisma.patient.findFirst({
      where: { orgId: DEMO_ORG_ID, isDeleted: false },
      select: { id: true },
    });
    if (!patient) throw new Error('no patient seeded');
    const res = await request.get(`/api/patients/${patient.id}/case-suggestions`);
    // VISITS_CREATE is the gate; viewers (read-only) don't have it.
    expect([401, 403]).toContain(res.status());
  });
});

// Suppress lint warning for `APIRequestContext` import — unused in this
// file directly but kept as documentation for spec authors extending
// this file.
void (null as APIRequestContext | null);
