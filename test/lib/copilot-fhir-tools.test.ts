import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Division, PatientSex, PrismaClient, Prisma } from '@prisma/client';

import { MAX_FHIR_ROWS_PER_SESSION, runTool } from '@/services/copilot/tools';

/**
 * Unit 28 — FHIR tool integration tests.
 *
 * Hits the real local Postgres via Prisma (matches the Unit 08
 * onboarding-expired-invite test pattern). Sets up two fixtures:
 *   - patient WITH a 'verified' PatientFhirIdentity + 3 cached Conditions
 *   - patient WITHOUT a link
 *
 * Exercises:
 *   - lookupFhirCondition returns rows for verified patient
 *   - same call against unverified patient returns verified_link_required
 *   - Stale rows (>7d) are excluded from results
 *   - Rate-limit ceiling enforced via fhirRowsConsumed budget
 *
 * Cleans up its own fixtures regardless of pass/fail.
 */

const prisma = new PrismaClient();

const ORG_ID = 'test-org-unit-28-fhir-tools';
const VERIFIED_PATIENT_ID = 'test-pat-unit-28-verified';
const UNVERIFIED_PATIENT_ID = 'test-pat-unit-28-unverified';
const LINK_ID = 'test-link-unit-28';

beforeAll(async () => {
  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: 'Unit 28 Test Org',
      division: Division.MEDICAL,
      billingEmail: 'unit28@test.local',
    },
  });
  for (const id of [VERIFIED_PATIENT_ID, UNVERIFIED_PATIENT_ID]) {
    await prisma.patient.upsert({
      where: { id },
      update: {},
      create: {
        id,
        orgId: ORG_ID,
        mrn: id,
        firstName: 'Test',
        lastName: id,
        dob: new Date('1980-01-01'),
        sex: PatientSex.FEMALE,
        division: Division.MEDICAL,
      },
    });
  }
  // Verified link for the first patient only.
  await prisma.patientFhirIdentity.upsert({
    where: { id: LINK_ID },
    update: { matchConfidence: 'verified' },
    create: {
      id: LINK_ID,
      patientId: VERIFIED_PATIENT_ID,
      ehrSystem: 'nextgen',
      fhirPatientId: 'fhir-pat-unit-28',
      matchConfidence: 'verified',
    },
  });
  // 3 cached Conditions: 2 fresh (1 active + 1 resolved), 1 stale.
  const now = new Date();
  const fresh = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
  const stale = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
  await prisma.fhirCachedResource.upsert({
    where: {
      ehrSystem_resourceType_fhirResourceId: {
        ehrSystem: 'nextgen',
        resourceType: 'Condition',
        fhirResourceId: 'cond-active',
      },
    },
    update: { fetchedAt: fresh, resource: makeConditionResource('cond-active', 'active') as unknown as Prisma.InputJsonValue },
    create: {
      patientId: VERIFIED_PATIENT_ID,
      ehrSystem: 'nextgen',
      resourceType: 'Condition',
      fhirResourceId: 'cond-active',
      resource: makeConditionResource('cond-active', 'active') as unknown as Prisma.InputJsonValue,
      fetchedAt: fresh,
    },
  });
  await prisma.fhirCachedResource.upsert({
    where: {
      ehrSystem_resourceType_fhirResourceId: {
        ehrSystem: 'nextgen',
        resourceType: 'Condition',
        fhirResourceId: 'cond-resolved',
      },
    },
    update: { fetchedAt: fresh, resource: makeConditionResource('cond-resolved', 'resolved') as unknown as Prisma.InputJsonValue },
    create: {
      patientId: VERIFIED_PATIENT_ID,
      ehrSystem: 'nextgen',
      resourceType: 'Condition',
      fhirResourceId: 'cond-resolved',
      resource: makeConditionResource('cond-resolved', 'resolved') as unknown as Prisma.InputJsonValue,
      fetchedAt: fresh,
    },
  });
  await prisma.fhirCachedResource.upsert({
    where: {
      ehrSystem_resourceType_fhirResourceId: {
        ehrSystem: 'nextgen',
        resourceType: 'Condition',
        fhirResourceId: 'cond-stale',
      },
    },
    update: { fetchedAt: stale, resource: makeConditionResource('cond-stale', 'active') as unknown as Prisma.InputJsonValue },
    create: {
      patientId: VERIFIED_PATIENT_ID,
      ehrSystem: 'nextgen',
      resourceType: 'Condition',
      fhirResourceId: 'cond-stale',
      resource: makeConditionResource('cond-stale', 'active') as unknown as Prisma.InputJsonValue,
      fetchedAt: stale,
    },
  });
});

afterAll(async () => {
  await prisma.fhirCachedResource.deleteMany({
    where: { patientId: { in: [VERIFIED_PATIENT_ID, UNVERIFIED_PATIENT_ID] } },
  });
  await prisma.patientFhirIdentity.deleteMany({
    where: { patientId: { in: [VERIFIED_PATIENT_ID, UNVERIFIED_PATIENT_ID] } },
  });
  await prisma.patient.deleteMany({
    where: { id: { in: [VERIFIED_PATIENT_ID, UNVERIFIED_PATIENT_ID] } },
  });
  await prisma.organization.delete({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

function makeConditionResource(id: string, clinicalStatus: string) {
  return {
    raw: {
      resourceType: 'Condition',
      id,
      code: { coding: [{ code: id, display: `Condition ${id}` }] },
      clinicalStatus: { coding: [{ code: clinicalStatus }] },
      onsetDateTime: '2020-01-01',
    },
    simplified: {
      code: id,
      display: `Condition ${id}`,
      clinicalStatus,
      onsetDate: '2020-01-01',
      recordedDate: null,
    },
  };
}

describe('lookupFhirCondition', () => {
  it('returns active conditions for a verified patient (drops stale + non-active)', async () => {
    const ctx = { orgId: ORG_ID, fhirRowsConsumed: { count: 0 } };
    const result = await runTool('lookupFhirCondition', { patientId: VERIFIED_PATIENT_ID }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { conditions: Array<{ fhirResourceId: string }> };
    expect(data.conditions).toHaveLength(1);
    expect(data.conditions[0]!.fhirResourceId).toBe('cond-active');
    expect(ctx.fhirRowsConsumed.count).toBe(1);
  });

  it('respects the clinicalStatus arg (returns resolved when asked)', async () => {
    const ctx = { orgId: ORG_ID, fhirRowsConsumed: { count: 0 } };
    const result = await runTool(
      'lookupFhirCondition',
      { patientId: VERIFIED_PATIENT_ID, clinicalStatus: 'resolved' },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { conditions: Array<{ fhirResourceId: string }> };
    expect(data.conditions).toHaveLength(1);
    expect(data.conditions[0]!.fhirResourceId).toBe('cond-resolved');
  });

  it('returns verified_link_required for a patient without a verified link', async () => {
    const ctx = { orgId: ORG_ID, fhirRowsConsumed: { count: 0 } };
    const result = await runTool(
      'lookupFhirCondition',
      { patientId: UNVERIFIED_PATIENT_ID },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('verified_link_required');
  });

  it('returns patient_not_found for an unknown patient id', async () => {
    const ctx = { orgId: ORG_ID, fhirRowsConsumed: { count: 0 } };
    const result = await runTool(
      'lookupFhirCondition',
      { patientId: 'nonexistent' },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');
  });

  it('refuses when the per-session rate-limit budget is exhausted', async () => {
    const ctx = {
      orgId: ORG_ID,
      fhirRowsConsumed: { count: MAX_FHIR_ROWS_PER_SESSION },
    };
    const result = await runTool('lookupFhirCondition', { patientId: VERIFIED_PATIENT_ID }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('fhir_rate_limit_exceeded');
  });
});

describe('lookupFhirAllergy + lookupFhirCarePlan (empty cache paths)', () => {
  it('returns empty allergies + empty carePlans without erroring', async () => {
    const ctx1 = { orgId: ORG_ID, fhirRowsConsumed: { count: 0 } };
    const ctx2 = { orgId: ORG_ID, fhirRowsConsumed: { count: 0 } };
    const a = await runTool('lookupFhirAllergy', { patientId: VERIFIED_PATIENT_ID }, ctx1);
    const c = await runTool('lookupFhirCarePlan', { patientId: VERIFIED_PATIENT_ID }, ctx2);
    expect(a.ok).toBe(true);
    expect(c.ok).toBe(true);
    if (a.ok) expect((a.data as { allergies: unknown[] }).allergies).toEqual([]);
    if (c.ok) expect((c.data as { carePlans: unknown[] }).carePlans).toEqual([]);
  });
});
