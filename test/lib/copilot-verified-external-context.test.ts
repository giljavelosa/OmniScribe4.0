import { afterAll, describe, expect, it } from 'vitest';
import {
  Division,
  ExternalContextMediaKind,
  ExternalContextSource,
  ExternalContextStatus,
  OrgRole,
  PatientSex,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import { runTool } from '@/services/copilot/tools';

const prisma = new PrismaClient();

const ORG_ID = 'test-org-unit-52-doc-tool';
const USER_ID = 'test-user-unit-52-doc-tool';
const ORG_USER_ID = 'test-org-user-unit-52-doc-tool';
const PATIENT_ID = 'test-patient-unit-52-doc-tool';

const extraction = {
  documentType: 'lab_report',
  summary: 'Verified creatinine lab report.',
  diagnoses: [],
  medications: [],
  allergies: [],
  labs: [
    {
      name: 'Creatinine',
      value: '1.0',
      unit: 'mg/dL',
      referenceRange: null,
      abnormalFlag: 'normal',
      collectedDate: null,
      sourcePage: 1,
      confidence: 'high',
      verbatim: 'Creatinine 1.0 mg/dL.',
    },
  ],
  vitals: [],
  procedures: [],
  documentDateGuess: null,
  extractionNotes: null,
};

async function databaseAvailable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function seedRows(): Promise<void> {
  await prisma.externalContext.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: 'Unit 52 Doc Tool Org',
      division: Division.MEDICAL,
      billingEmail: 'unit52-doc-tool@test.local',
    },
  });
  await prisma.user.upsert({
    where: { id: USER_ID },
    update: {},
    create: {
      id: USER_ID,
      email: 'unit52-doc-tool@test.local',
      passwordHash: 'hash',
    },
  });
  await prisma.orgUser.upsert({
    where: { id: ORG_USER_ID },
    update: {},
    create: {
      id: ORG_USER_ID,
      userId: USER_ID,
      orgId: ORG_ID,
      role: OrgRole.CLINICIAN,
      division: Division.MEDICAL,
    },
  });
  await prisma.patient.upsert({
    where: { id: PATIENT_ID },
    update: {},
    create: {
      id: PATIENT_ID,
      orgId: ORG_ID,
      firstName: 'Doc',
      lastName: 'Tool',
      mrn: 'UNIT52-DOC-TOOL',
      dob: new Date('1980-01-01T00:00:00Z'),
      sex: PatientSex.FEMALE,
    },
  });
  await prisma.externalContext.createMany({
    data: [
      {
        id: 'test-ec-unit-52-verified-doc',
        orgId: ORG_ID,
        patientId: PATIENT_ID,
        dateOfRecord: new Date('2026-04-01T00:00:00Z'),
        source: ExternalContextSource.OUTSIDE_PROVIDER,
        sourceLabel: 'Verified lab',
        transcriptClean: 'Verified document transcript.',
        mediaKind: ExternalContextMediaKind.DOCUMENT,
        status: ExternalContextStatus.READY,
        verifiedAt: new Date('2026-04-02T00:00:00Z'),
        verifiedByOrgUserId: ORG_USER_ID,
        extractionJson: extraction as Prisma.InputJsonValue,
        vettedExtractionJson: extraction as Prisma.InputJsonValue,
        addedByOrgUserId: ORG_USER_ID,
      },
      {
        id: 'test-ec-unit-52-unverified-doc',
        orgId: ORG_ID,
        patientId: PATIENT_ID,
        dateOfRecord: new Date('2026-04-03T00:00:00Z'),
        source: ExternalContextSource.OUTSIDE_PROVIDER,
        sourceLabel: 'Unverified lab',
        transcriptClean: '',
        mediaKind: ExternalContextMediaKind.DOCUMENT,
        status: ExternalContextStatus.EXTRACTED,
        extractionJson: extraction as Prisma.InputJsonValue,
        addedByOrgUserId: ORG_USER_ID,
      },
    ],
  });
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

async function cleanupRows(): Promise<void> {
  await prisma.externalContext.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.patient.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.orgUser.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
}

describe('lookupVerifiedExternalContext', () => {
  it('returns verified document rows and excludes unverified EXTRACTED rows', async () => {
    if (!(await databaseAvailable())) return;

    await seedRows();
    try {
      const result = await runTool('lookupVerifiedExternalContext', { patientId: PATIENT_ID }, { orgId: ORG_ID });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { documents: Array<{ id: string; summary: string }> };
      expect(data.documents.map((doc) => doc.id)).toEqual(['test-ec-unit-52-verified-doc']);
      expect(data.documents[0]?.summary).toBe('Verified creatinine lab report.');
    } finally {
      await cleanupRows();
    }
  });
});
