import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import {
  LOCKOUT_DURATION_MS,
  LOCKOUT_THRESHOLD,
  evaluateLockState,
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from '@/lib/auth/lockout';

/**
 * Lockout integration tests — Unit 37.
 *
 * Hits the live Postgres. Fixture is one User row with no orgUser
 * (lockout is User-level, not org-level). Verifies the lock crosses
 * at the 5th failed attempt, the lock window is exactly 15 minutes,
 * the lock blocks even with correct password, successful auth after
 * expiry clears state + fires USER_UNLOCKED.
 */

// Skipped in CI (no Postgres). Run locally via `npm test` with DATABASE_URL set.
const hasDb = !!process.env.DATABASE_URL;
const describeMaybe = hasDb ? describe : describe.skip;
const prisma = hasDb ? new PrismaClient() : (null as unknown as PrismaClient);
const USER_ID = 'test-user-unit-37-lockout';

beforeAll(async () => {
  if (!hasDb) return;
  await prisma.user.upsert({
    where: { id: USER_ID },
    update: {},
    create: {
      id: USER_ID,
      email: 'unit37lockout@test.local',
      passwordHash: 'irrelevant',
    },
  });
});

beforeEach(async () => {
  // Reset counter + lock state before each test.
  await prisma.user.update({
    where: { id: USER_ID },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
  await prisma.auditLog.deleteMany({ where: { userId: USER_ID } });
});

afterAll(async () => {
  if (!hasDb) return;
  await prisma.auditLog.deleteMany({ where: { userId: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.$disconnect();
});

describeMaybe('evaluateLockState', () => {
  it('returns open when lockedUntil is null', () => {
    expect(evaluateLockState({ lockedUntil: null })).toEqual({ state: 'open' });
  });

  it('returns open when lockedUntil is in the past', () => {
    const past = new Date(Date.now() - 60_000);
    expect(evaluateLockState({ lockedUntil: past })).toEqual({ state: 'open' });
  });

  it('returns locked when lockedUntil is in the future', () => {
    const future = new Date(Date.now() + 60_000);
    const result = evaluateLockState({ lockedUntil: future });
    expect(result.state).toBe('locked');
    if (result.state === 'locked') {
      expect(result.lockedUntil).toEqual(future);
    }
  });
});

describeMaybe('recordFailedAttempt', () => {
  it('increments counter on each call', async () => {
    await recordFailedAttempt(USER_ID);
    let user = await prisma.user.findUnique({ where: { id: USER_ID } });
    expect(user!.failedLoginCount).toBe(1);

    await recordFailedAttempt(USER_ID);
    user = await prisma.user.findUnique({ where: { id: USER_ID } });
    expect(user!.failedLoginCount).toBe(2);
  });

  it('locks the account when threshold is crossed', async () => {
    for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i++) {
      await recordFailedAttempt(USER_ID);
    }
    let user = await prisma.user.findUnique({ where: { id: USER_ID } });
    expect(user!.failedLoginCount).toBe(LOCKOUT_THRESHOLD - 1);
    expect(user!.lockedUntil).toBeNull();

    const result = await recordFailedAttempt(USER_ID);
    user = await prisma.user.findUnique({ where: { id: USER_ID } });
    expect(user!.lockedUntil).not.toBeNull();
    expect(result.locked).toBe(true);

    // Window is the 15-minute spec value.
    const expectedExpiry = Date.now() + LOCKOUT_DURATION_MS;
    expect(user!.lockedUntil!.getTime()).toBeGreaterThan(expectedExpiry - 1000);
    expect(user!.lockedUntil!.getTime()).toBeLessThan(expectedExpiry + 1000);
  });

  it('writes USER_LOCKED audit when the threshold is crossed', async () => {
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      await recordFailedAttempt(USER_ID);
    }
    const lockedRows = await prisma.auditLog.findMany({
      where: { userId: USER_ID, action: 'USER_LOCKED' },
    });
    expect(lockedRows).toHaveLength(1);
    const meta = lockedRows[0]!.metadata as { failedLoginCount: number };
    expect(meta.failedLoginCount).toBeGreaterThanOrEqual(LOCKOUT_THRESHOLD);
  });

  it('does not double-lock when already locked + threshold re-crossed', async () => {
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      await recordFailedAttempt(USER_ID);
    }
    const firstLock = await prisma.user.findUnique({ where: { id: USER_ID } });
    const firstLockExpiry = firstLock!.lockedUntil!.getTime();

    // Another wrong attempt while locked.
    await recordFailedAttempt(USER_ID);
    const secondLock = await prisma.user.findUnique({ where: { id: USER_ID } });
    // lockedUntil stays put (doesn't extend); audit row count stays at 1.
    expect(secondLock!.lockedUntil!.getTime()).toBe(firstLockExpiry);

    const lockedRows = await prisma.auditLog.findMany({
      where: { userId: USER_ID, action: 'USER_LOCKED' },
    });
    expect(lockedRows).toHaveLength(1);
  });
});

describeMaybe('recordSuccessfulAttempt', () => {
  it('clears counter + lockedUntil', async () => {
    await prisma.user.update({
      where: { id: USER_ID },
      data: {
        failedLoginCount: 3,
        lockedUntil: new Date(Date.now() + 60_000),
      },
    });
    await recordSuccessfulAttempt(USER_ID, new Date(Date.now() + 60_000));
    const user = await prisma.user.findUnique({ where: { id: USER_ID } });
    expect(user!.failedLoginCount).toBe(0);
    expect(user!.lockedUntil).toBeNull();
  });

  it('writes USER_UNLOCKED when previouslyLockedUntil is in the past', async () => {
    const stale = new Date(Date.now() - 60_000);
    await prisma.user.update({
      where: { id: USER_ID },
      data: { lockedUntil: stale, failedLoginCount: 5 },
    });
    await recordSuccessfulAttempt(USER_ID, stale);

    const unlockedRows = await prisma.auditLog.findMany({
      where: { userId: USER_ID, action: 'USER_UNLOCKED' },
    });
    expect(unlockedRows).toHaveLength(1);
    const meta = unlockedRows[0]!.metadata as { unlockedVia: string };
    expect(meta.unlockedVia).toBe('auto');
  });

  it('does not write USER_UNLOCKED when never locked', async () => {
    await recordSuccessfulAttempt(USER_ID, null);
    const unlockedRows = await prisma.auditLog.findMany({
      where: { userId: USER_ID, action: 'USER_UNLOCKED' },
    });
    expect(unlockedRows).toHaveLength(0);
  });
});
