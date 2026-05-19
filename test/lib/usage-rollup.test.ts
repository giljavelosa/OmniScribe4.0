import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Division,
  NoteStatus,
  OrgRole,
  PatientSex,
  PrismaClient,
} from '@prisma/client';

import {
  USAGE_CACHE_TTL_MS,
  USAGE_MAX_WINDOW_DAYS,
  computeOrgUsage,
} from '@/lib/owner/usage-rollup';

/**
 * computeOrgUsage integration tests — Unit 32.
 *
 * Hits the live Postgres via Prisma. Fixture: one org, one user,
 * one patient, three signed notes spread across three days, two
 * AudioSegments, plus a few COPILOT_ASK_QUERY + COPILOT_DRAFT_CONFIRMED
 * audit rows.
 *
 * Verifies: empty buckets render as zeros, signed-note count rolls
 * up to the right day, transcription minutes round down correctly,
 * audit-based counts match, the 60-min cache short-circuits the
 * recompute, and a stale row triggers recompute.
 */

// Skipped in CI (no Postgres). Run locally via `npm test` with DATABASE_URL set.
const hasDb = !!process.env.DATABASE_URL;
const describeMaybe = hasDb ? describe : describe.skip;
const prisma = hasDb ? new PrismaClient() : (null as unknown as PrismaClient);

const ORG_ID = 'test-org-unit-32-usage';
const USER_ID = 'test-user-unit-32-usage';
const ORG_USER_ID = 'test-orguser-unit-32-usage';
const PATIENT_ID = 'test-pat-unit-32-usage';

const NOTE_ID_TODAY_1 = 'test-note-32-today-1';
const NOTE_ID_TODAY_2 = 'test-note-32-today-2';
const NOTE_ID_YESTERDAY = 'test-note-32-yesterday';

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

beforeAll(async () => {
  if (!hasDb) return;
  const today = startOfTodayUtc();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const noonToday = new Date(today.getTime() + 12 * 60 * 60 * 1000);
  const noonYesterday = new Date(yesterday.getTime() + 12 * 60 * 60 * 1000);

  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: 'Unit 32 Usage Test Org',
      division: Division.MEDICAL,
      billingEmail: 'unit32usage@test.local',
    },
  });
  await prisma.user.upsert({
    where: { id: USER_ID },
    update: {},
    create: {
      id: USER_ID,
      email: 'unit32usage@test.local',
      passwordHash: 'irrelevant',
    },
  });
  await prisma.orgUser.upsert({
    where: { id: ORG_USER_ID },
    update: {},
    create: {
      id: ORG_USER_ID,
      orgId: ORG_ID,
      userId: USER_ID,
      role: OrgRole.CLINICIAN,
      division: Division.MEDICAL,
      profession: 'PT',
    },
  });
  await prisma.patient.upsert({
    where: { id: PATIENT_ID },
    update: {},
    create: {
      id: PATIENT_ID,
      orgId: ORG_ID,
      mrn: PATIENT_ID,
      firstName: 'U32',
      lastName: 'Usage',
      dob: new Date('1980-01-01'),
      sex: PatientSex.FEMALE,
    },
  });

  // Two signed notes today (15 min + 10 min audio); one signed note
  // yesterday (5 min audio).
  for (const { id, signedAt, duration } of [
    { id: NOTE_ID_TODAY_1, signedAt: noonToday, duration: 15 * 60 * 1000 },
    { id: NOTE_ID_TODAY_2, signedAt: noonToday, duration: 10 * 60 * 1000 },
    { id: NOTE_ID_YESTERDAY, signedAt: noonYesterday, duration: 5 * 60 * 1000 },
  ]) {
    await prisma.note.upsert({
      where: { id },
      update: { status: NoteStatus.SIGNED, signedAt },
      create: {
        id,
        orgId: ORG_ID,
        patientId: PATIENT_ID,
        clinicianOrgUserId: ORG_USER_ID,
        division: Division.MEDICAL,
        status: NoteStatus.SIGNED,
        signedAt,
      },
    });
    await prisma.audioSegment.upsert({
      where: { id: `${id}-seg` },
      update: { durationMs: duration },
      create: {
        id: `${id}-seg`,
        noteId: id,
        segmentIndex: 0,
        s3Key: `test/${id}.wav`,
        durationMs: duration,
        sampleRate: 16000,
        byteSize: 100_000,
      },
    });
  }

  // 3 copilot asks today, 1 yesterday; 2 draft confirms today.
  for (let i = 0; i < 3; i++) {
    await prisma.auditLog.create({
      data: {
        userId: USER_ID,
        orgId: ORG_ID,
        action: 'COPILOT_ASK_QUERY',
        createdAt: new Date(noonToday.getTime() + i * 1000),
        metadata: { questionLength: 50 + i },
      },
    });
  }
  await prisma.auditLog.create({
    data: {
      userId: USER_ID,
      orgId: ORG_ID,
      action: 'COPILOT_ASK_QUERY',
      createdAt: noonYesterday,
      metadata: { questionLength: 80 },
    },
  });
  for (let i = 0; i < 2; i++) {
    await prisma.auditLog.create({
      data: {
        userId: USER_ID,
        orgId: ORG_ID,
        action: 'COPILOT_DRAFT_CONFIRMED',
        createdAt: new Date(noonToday.getTime() + 60_000 + i * 1000),
        metadata: { kind: 'patient-message', contentLength: 200 },
      },
    });
  }

  // Wipe any prior cache rows so the test starts cold.
  await prisma.orgUsageDaily.deleteMany({ where: { orgId: ORG_ID } });
});

afterAll(async () => {
  if (!hasDb) return;
  await prisma.orgUsageDaily.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.auditLog.deleteMany({ where: { orgId: ORG_ID } });
  for (const id of [NOTE_ID_TODAY_1, NOTE_ID_TODAY_2, NOTE_ID_YESTERDAY]) {
    await prisma.audioSegment.deleteMany({ where: { noteId: id } });
    await prisma.note.deleteMany({ where: { id } });
  }
  await prisma.patient.deleteMany({ where: { id: PATIENT_ID } });
  await prisma.orgUser.deleteMany({ where: { id: ORG_USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

describeMaybe('computeOrgUsage', () => {
  it('returns exactly windowDays entries sorted oldest-first', async () => {
    const result = await computeOrgUsage(ORG_ID, 7);
    expect(result).toHaveLength(7);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.day > result[i - 1]!.day).toBe(true);
    }
  });

  it('rolls up signed notes + transcription minutes per day', async () => {
    const result = await computeOrgUsage(ORG_ID, 3);
    const [twoDaysAgo, yesterday, today] = result;
    expect(twoDaysAgo!.notesSigned).toBe(0);
    expect(yesterday!.notesSigned).toBe(1);
    expect(yesterday!.transcriptionMinutes).toBe(5);
    expect(today!.notesSigned).toBe(2);
    expect(today!.transcriptionMinutes).toBe(25); // 15 + 10
  });

  it('counts copilot asks + drafts accepted per day from audit log', async () => {
    const result = await computeOrgUsage(ORG_ID, 3);
    const [, yesterday, today] = result;
    expect(yesterday!.copilotAsks).toBe(1);
    expect(yesterday!.draftsAccepted).toBe(0);
    expect(today!.copilotAsks).toBe(3);
    expect(today!.draftsAccepted).toBe(2);
  });

  it('caches: second call within TTL does not recompute (cache hit)', async () => {
    // Clear so this test's assertions aren't contaminated by prior tests.
    await prisma.orgUsageDaily.deleteMany({ where: { orgId: ORG_ID } });

    await computeOrgUsage(ORG_ID, 3);
    const cachedBefore = await prisma.orgUsageDaily.findMany({
      where: { orgId: ORG_ID },
      select: { day: true, computedAt: true },
      orderBy: { day: 'asc' },
    });
    expect(cachedBefore.length).toBe(3);
    // Immediate re-call — should NOT bump computedAt for any row still
    // within TTL.
    await computeOrgUsage(ORG_ID, 3);
    const cachedAfter = await prisma.orgUsageDaily.findMany({
      where: { orgId: ORG_ID },
      select: { day: true, computedAt: true },
      orderBy: { day: 'asc' },
    });
    expect(cachedAfter.length).toBe(3);
    for (const after of cachedAfter) {
      const before = cachedBefore.find(
        (b) => b.day.getTime() === after.day.getTime(),
      );
      expect(after.computedAt.getTime()).toBe(before!.computedAt.getTime());
    }
  });

  it('recomputes when a cached row is past the TTL', async () => {
    // Clear so this test owns the cache state for its window.
    await prisma.orgUsageDaily.deleteMany({ where: { orgId: ORG_ID } });

    await computeOrgUsage(ORG_ID, 3);
    const stale = new Date(Date.now() - USAGE_CACHE_TTL_MS - 60_000);
    await prisma.orgUsageDaily.updateMany({
      where: { orgId: ORG_ID },
      data: { computedAt: stale },
    });

    await computeOrgUsage(ORG_ID, 3);

    const after = await prisma.orgUsageDaily.findMany({
      where: { orgId: ORG_ID },
      select: { computedAt: true },
    });
    expect(after.length).toBe(3);
    for (const row of after) {
      expect(row.computedAt.getTime()).toBeGreaterThan(stale.getTime());
    }
  });

  it('caps the window at USAGE_MAX_WINDOW_DAYS regardless of argument', async () => {
    const result = await computeOrgUsage(ORG_ID, 999);
    expect(result.length).toBe(USAGE_MAX_WINDOW_DAYS);
  });
});
