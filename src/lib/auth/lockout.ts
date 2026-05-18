/**
 * Account lockout policy — Unit 37.
 *
 * Pure-function helpers that read/write `User.failedLoginCount` +
 * `User.lockedUntil`. Called from `auth.config.ts authorize()` to
 * gate sign-in attempts after the 5-attempt threshold.
 *
 * Three observable behaviors:
 *   - Locked + within window → return locked() (caller refuses login).
 *   - Wrong password → increment counter; lock + audit USER_LOCKED
 *     when crossing the threshold.
 *   - Successful auth → clear counter + lockedUntil; audit
 *     USER_UNLOCKED when the user WAS previously locked.
 */

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export type LockoutCheck =
  | { state: 'open' }
  | { state: 'locked'; lockedUntil: Date };

/**
 * Read-only check: is this user currently locked? Doesn't mutate.
 * Caller uses this BEFORE checking the password — otherwise an
 * attacker sees "wrong password" timing while the account is locked,
 * vs "locked" timing on a fresh attempt.
 */
export function evaluateLockState(user: {
  lockedUntil: Date | null;
}, now: Date = new Date()): LockoutCheck {
  if (user.lockedUntil && user.lockedUntil > now) {
    return { state: 'locked', lockedUntil: user.lockedUntil };
  }
  return { state: 'open' };
}

/**
 * Increment failedLoginCount + (if threshold crossed) set lockedUntil
 * and write the USER_LOCKED audit row.
 */
export async function recordFailedAttempt(
  userId: string,
  now: Date = new Date(),
): Promise<{ locked: boolean; lockedUntil: Date | null }> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true, lockedUntil: true },
  });

  // If we just crossed the threshold AND the account isn't already
  // within an active lock window, set lockedUntil + audit USER_LOCKED.
  const alreadyLocked = updated.lockedUntil && updated.lockedUntil > now;
  if (updated.failedLoginCount >= LOCKOUT_THRESHOLD && !alreadyLocked) {
    const newLockExpiry = new Date(now.getTime() + LOCKOUT_DURATION_MS);
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: newLockExpiry },
    });
    await writeAuditLog({
      userId,
      action: 'USER_LOCKED',
      resourceType: 'User',
      resourceId: userId,
      metadata: {
        failedLoginCount: updated.failedLoginCount,
        lockedUntil: newLockExpiry.toISOString(),
        durationMs: LOCKOUT_DURATION_MS,
      },
    });
    return { locked: true, lockedUntil: newLockExpiry };
  }
  return {
    locked: !!alreadyLocked,
    lockedUntil: updated.lockedUntil,
  };
}

/**
 * Clear failedLoginCount + lockedUntil on successful auth. When the
 * user WAS previously locked (lockedUntil set but past), writes
 * USER_UNLOCKED to mark the auto-recovery.
 */
export async function recordSuccessfulAttempt(
  userId: string,
  previouslyLockedUntil: Date | null,
  now: Date = new Date(),
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
  // Was previously locked + the window has expired = auto-unlock event.
  // (If lockedUntil > now we'd have refused the login upstream; this
  // branch only fires for stale-lock state.)
  if (previouslyLockedUntil && previouslyLockedUntil <= now) {
    await writeAuditLog({
      userId,
      action: 'USER_UNLOCKED',
      resourceType: 'User',
      resourceId: userId,
      metadata: {
        previousLockExpiredAt: previouslyLockedUntil.toISOString(),
        unlockedVia: 'auto',
      },
    });
  }
}
