import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Division,
  EpisodeStatus,
  GoalStatus,
  GoalType,
  PatientSex,
  PrismaClient,
} from '@prisma/client';

import { runTool } from '@/services/copilot/tools';

/**
 * Phase 1A — lookupPatientGoals fan-out integration test.
 *
 * Seeds an org + patient with TWO concurrent episodes; each carries
 * one ACTIVE goal plus one MET goal (the MET one must be filtered
 * out). A third patient in the same org with zero episodes covers
 * the empty-state branch. A fourth patient in a *different* org
 * covers the org-scope guard.
 *
 * Skipped when DATABASE_URL is unset (CI without Postgres).
 */

const hasDb = !!process.env.DATABASE_URL;
const describeMaybe = hasDb ? describe : describe.skip;
const prisma = hasDb ? new PrismaClient() : (null as unknown as PrismaClient);

const ORG_ID = 'test-org-p1a-patient-goals';
const OTHER_ORG_ID = 'test-org-p1a-patient-goals-other';
const PATIENT_WITH_EPISODES = 'test-pat-p1a-with-episodes';
const PATIENT_EMPTY = 'test-pat-p1a-empty';
const PATIENT_OTHER_ORG = 'test-pat-p1a-other-org';
const DEPT_ID = 'test-dept-p1a-patient-goals';
const OTHER_DEPT_ID = 'test-dept-p1a-patient-goals-other';
const EPISODE_A = 'test-episode-p1a-a';
const EPISODE_B = 'test-episode-p1a-b';

describeMaybe('runTool lookupPatientGoals (Phase 1A fan-out)', () => {
  beforeAll(async () => {
    if (!hasDb) return;
    for (const [orgId, name] of [
      [ORG_ID, 'Phase 1A Test Org'],
      [OTHER_ORG_ID, 'Phase 1A Other Org'],
    ] as const) {
      await prisma.organization.upsert({
        where: { id: orgId },
        update: {},
        create: {
          id: orgId,
          name,
          division: Division.MEDICAL,
          billingEmail: `${orgId}@test.local`,
        },
      });
    }
    await prisma.department.upsert({
      where: { id: DEPT_ID },
      update: {},
      create: { id: DEPT_ID, orgId: ORG_ID, name: 'P1A Dept', division: Division.MEDICAL },
    });
    await prisma.department.upsert({
      where: { id: OTHER_DEPT_ID },
      update: {},
      create: {
        id: OTHER_DEPT_ID,
        orgId: OTHER_ORG_ID,
        name: 'P1A Other Dept',
        division: Division.MEDICAL,
      },
    });

    const patientFixtures: Array<{ id: string; orgId: string }> = [
      { id: PATIENT_WITH_EPISODES, orgId: ORG_ID },
      { id: PATIENT_EMPTY, orgId: ORG_ID },
      { id: PATIENT_OTHER_ORG, orgId: OTHER_ORG_ID },
    ];
    for (const p of patientFixtures) {
      await prisma.patient.upsert({
        where: { id: p.id },
        update: {},
        create: {
          id: p.id,
          orgId: p.orgId,
          mrn: p.id,
          firstName: 'Test',
          lastName: p.id,
          dob: new Date('1980-01-01'),
          sex: PatientSex.FEMALE,
        },
      });
    }

    for (const [id, diagnosis, caseId] of [
      [EPISODE_A, 'Low back pain', 'test-case-p1a-a'],
      [EPISODE_B, 'Rotator cuff strain', 'test-case-p1a-b'],
    ] as const) {
      await prisma.caseManagement.upsert({
        where: { id: caseId },
        update: {},
        create: {
          id: caseId,
          orgId: ORG_ID,
          patientId: PATIENT_WITH_EPISODES,
          primaryIcdLabel: diagnosis,
          // Unit 49: REHAB matches the rest of this fixture's episode division.
          division: 'REHAB',
          status: 'ACTIVE',
        },
      });
      await prisma.episodeOfCare.upsert({
        where: { id },
        update: {},
        create: {
          id,
          orgId: ORG_ID,
          patientId: PATIENT_WITH_EPISODES,
          caseManagementId: caseId,
          clinicianOrgUserId: 'test-clin-p1a',
          departmentId: DEPT_ID,
          division: Division.REHAB,
          diagnosis,
          status: EpisodeStatus.ACTIVE,
        },
      });
    }

    // Clean stale goal rows then re-seed deterministic fixtures.
    await prisma.episodeGoal.deleteMany({
      where: { episodeId: { in: [EPISODE_A, EPISODE_B] } },
    });
    await prisma.episodeGoal.createMany({
      data: [
        {
          id: 'test-goal-p1a-a-active',
          episodeId: EPISODE_A,
          goalType: GoalType.LTG,
          goalText: 'Walk 1/4 mile without pain',
          status: GoalStatus.ACTIVE,
        },
        {
          id: 'test-goal-p1a-a-met',
          episodeId: EPISODE_A,
          goalType: GoalType.STG,
          goalText: 'Pain <= 3/10 with ADLs',
          status: GoalStatus.MET,
        },
        {
          id: 'test-goal-p1a-b-active',
          episodeId: EPISODE_B,
          goalType: GoalType.STG,
          goalText: 'Restore shoulder abduction to 160 deg',
          status: GoalStatus.ACTIVE,
        },
      ],
    });
  });

  afterAll(async () => {
    if (!hasDb) return;
    await prisma.episodeGoal.deleteMany({
      where: { episodeId: { in: [EPISODE_A, EPISODE_B] } },
    });
    await prisma.episodeOfCare.deleteMany({ where: { id: { in: [EPISODE_A, EPISODE_B] } } });
    await prisma.caseManagement.deleteMany({
      where: { id: { in: ['test-case-p1a-a', 'test-case-p1a-b'] } },
    });
    await prisma.patient.deleteMany({
      where: { id: { in: [PATIENT_WITH_EPISODES, PATIENT_EMPTY, PATIENT_OTHER_ORG] } },
    });
    await prisma.department.deleteMany({ where: { id: { in: [DEPT_ID, OTHER_DEPT_ID] } } });
    await prisma.orgUsageDaily.deleteMany({
      where: { orgId: { in: [ORG_ID, OTHER_ORG_ID] } },
    });
    await prisma.orgLlmCostDaily.deleteMany({
      where: { orgId: { in: [ORG_ID, OTHER_ORG_ID] } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: [ORG_ID, OTHER_ORG_ID] } } });
    await prisma.$disconnect();
  });

  it('fans out across all episodes and returns ACTIVE/PARTIALLY_MET goals only', async () => {
    const result = await runTool(
      'lookupPatientGoals',
      { patientId: PATIENT_WITH_EPISODES },
      { orgId: ORG_ID },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rowCount).toBe(2);
    const goals = (result.data as { goals: Array<{ episodeId: string; status: string }> }).goals;
    expect(goals.map((g) => g.episodeId).sort()).toEqual([EPISODE_A, EPISODE_B].sort());
    expect(goals.every((g) => g.status === 'ACTIVE' || g.status === 'PARTIALLY_MET')).toBe(true);
  });

  it('includes episodeId and episodeDiagnosis on every returned goal', async () => {
    const result = await runTool(
      'lookupPatientGoals',
      { patientId: PATIENT_WITH_EPISODES },
      { orgId: ORG_ID },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const goals = (
      result.data as {
        goals: Array<{ episodeId: string; episodeDiagnosis: string | null }>;
      }
    ).goals;
    expect(goals).toHaveLength(2);
    for (const g of goals) {
      expect(typeof g.episodeId).toBe('string');
      expect(g.episodeDiagnosis).toMatch(/Low back pain|Rotator cuff strain/);
    }
  });

  it('returns rowCount: 0 with empty goals array when patient has no episodes', async () => {
    const result = await runTool(
      'lookupPatientGoals',
      { patientId: PATIENT_EMPTY },
      { orgId: ORG_ID },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rowCount).toBe(0);
    expect((result.data as { goals: unknown[] }).goals).toEqual([]);
  });

  it('returns patient_not_found for an unknown patientId', async () => {
    const result = await runTool(
      'lookupPatientGoals',
      { patientId: 'definitely-not-real' },
      { orgId: ORG_ID },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('patient_not_found');
  });

  it('throws on a cross-org patientId (org-scope guard via assertOrgScoped)', async () => {
    // assertOrgScoped throws; runTool's try/catch surfaces the message
    // as a tool error so the agent can recover without crashing the run.
    const result = await runTool(
      'lookupPatientGoals',
      { patientId: PATIENT_OTHER_ORG },
      { orgId: ORG_ID },
    );
    expect(result.ok).toBe(false);
  });

  it('rejects malformed args via Zod', async () => {
    const result = await runTool(
      'lookupPatientGoals',
      { wrongField: 'oops' },
      { orgId: ORG_ID },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/args_invalid/);
  });
});
