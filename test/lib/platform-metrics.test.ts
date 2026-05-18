import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Division,
  NoteStatus,
  OrgRole,
  PatientSex,
  PrismaClient,
} from '@prisma/client';

import {
  PLATFORM_METRICS_CACHE_TTL_MS,
  _peekPlatformMetricsCacheForTest,
  _resetPlatformMetricsCacheForTest,
  getPlatformMetrics,
} from '@/lib/ops/platform-metrics';

/**
 * getPlatformMetrics integration tests — Unit 33.
 *
 * Hits the live Postgres. Fixture: one org with a signed note in the
 * last 24h and another a week old, plus an interrupted note, a USER_
 * SIGNED_IN audit, and a NOTE_GENERATION_FAILED. Verifies the metric
 * aggregator returns the right counts + the 60-second cache short-
 * circuits the second call.
 *
 * Each test resets the in-memory cache via the test helper so the
 * cache isn't leaking state across cases.
 */

const prisma = new PrismaClient();

const ORG_ID = 'test-org-unit-33-metrics';
const USER_ID = 'test-user-unit-33-metrics';
const ORG_USER_ID = 'test-orguser-unit-33-metrics';
const PATIENT_ID = 'test-pat-unit-33-metrics';

beforeAll(async () => {
  const now = new Date();
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: 'Unit 33 Metrics Test Org',
      division: Division.MEDICAL,
      billingEmail: 'unit33metrics@test.local',
    },
  });
  await prisma.user.upsert({
    where: { id: USER_ID },
    update: {},
    create: {
      id: USER_ID,
      email: 'unit33metrics@test.local',
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
      firstName: 'U33',
      lastName: 'Metrics',
      dob: new Date('1980-01-01'),
      sex: PatientSex.FEMALE,
      division: Division.MEDICAL,
    },
  });

  // Two signed notes (one within 24h, one within 7d) + one interrupted.
  await prisma.note.upsert({
    where: { id: 'test-note-33-recent' },
    update: { status: NoteStatus.SIGNED, signedAt: sixHoursAgo },
    create: {
      id: 'test-note-33-recent',
      orgId: ORG_ID,
      patientId: PATIENT_ID,
      clinicianOrgUserId: ORG_USER_ID,
      division: Division.MEDICAL,
      status: NoteStatus.SIGNED,
      signedAt: sixHoursAgo,
    },
  });
  await prisma.note.upsert({
    where: { id: 'test-note-33-older' },
    update: { status: NoteStatus.SIGNED, signedAt: fiveDaysAgo },
    create: {
      id: 'test-note-33-older',
      orgId: ORG_ID,
      patientId: PATIENT_ID,
      clinicianOrgUserId: ORG_USER_ID,
      division: Division.MEDICAL,
      status: NoteStatus.SIGNED,
      signedAt: fiveDaysAgo,
    },
  });
  await prisma.note.upsert({
    where: { id: 'test-note-33-interrupted' },
    update: { status: NoteStatus.INTERRUPTED },
    create: {
      id: 'test-note-33-interrupted',
      orgId: ORG_ID,
      patientId: PATIENT_ID,
      clinicianOrgUserId: ORG_USER_ID,
      division: Division.MEDICAL,
      status: NoteStatus.INTERRUPTED,
    },
  });

  // USER_SIGNED_IN within 30d → active-user count.
  await prisma.auditLog.create({
    data: {
      userId: USER_ID,
      orgId: ORG_ID,
      action: 'USER_SIGNED_IN',
      createdAt: sixHoursAgo,
      metadata: { method: 'credentials' },
    },
  });
  // NOTE_GENERATION_FAILED within 1h → error-rate-last-hour + AI worker fail.
  await prisma.auditLog.create({
    data: {
      userId: USER_ID,
      orgId: ORG_ID,
      action: 'NOTE_GENERATION_FAILED',
      createdAt: new Date(now.getTime() - 15 * 60 * 1000),
      metadata: { code: 'bedrock_timeout' },
    },
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { orgId: ORG_ID } });
  for (const id of ['test-note-33-recent', 'test-note-33-older', 'test-note-33-interrupted']) {
    await prisma.note.deleteMany({ where: { id } });
  }
  await prisma.patient.deleteMany({ where: { id: PATIENT_ID } });
  await prisma.orgUser.deleteMany({ where: { id: ORG_USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

beforeEach(() => {
  _resetPlatformMetricsCacheForTest();
});

describe('getPlatformMetrics', () => {
  it('returns aggregated counts that include the fixture data', async () => {
    const metrics = await getPlatformMetrics();
    expect(metrics.orgs.total).toBeGreaterThanOrEqual(1);
    expect(metrics.orgs.activeLast30d).toBeGreaterThanOrEqual(1);
    expect(metrics.users.activeLast30d).toBeGreaterThanOrEqual(1);
    expect(metrics.notes.signedLast24h).toBeGreaterThanOrEqual(1);
    expect(metrics.notes.signedLast7d).toBeGreaterThanOrEqual(2);
    expect(metrics.notes.interrupted).toBeGreaterThanOrEqual(1);
    expect(metrics.workers.aiGenerationFailedLast24h).toBeGreaterThanOrEqual(1);
    expect(metrics.errorRateLastHour).toBeGreaterThanOrEqual(1);
  });

  it('caches: second call within TTL returns the same cached object', async () => {
    const first = await getPlatformMetrics();
    expect(_peekPlatformMetricsCacheForTest()).not.toBeNull();
    const second = await getPlatformMetrics();
    expect(second).toBe(first); // reference equality — same cached value
  });

  it('recomputes when the cache is expired (now > expiry)', async () => {
    const first = await getPlatformMetrics();
    const farFuture = new Date(Date.now() + PLATFORM_METRICS_CACHE_TTL_MS + 1000);
    const second = await getPlatformMetrics(farFuture);
    expect(second).not.toBe(first); // new computation, new object
    expect(second.computedAt).not.toBe(first.computedAt);
  });

  it('cache reset returns null peek', async () => {
    await getPlatformMetrics();
    expect(_peekPlatformMetricsCacheForTest()).not.toBeNull();
    _resetPlatformMetricsCacheForTest();
    expect(_peekPlatformMetricsCacheForTest()).toBeNull();
  });
});
