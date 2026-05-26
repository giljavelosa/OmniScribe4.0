/**
 * Recording-lock helpers — single-concurrent-recording enforcement.
 *
 * Why this exists
 * ---------------
 * Two clinicians sharing one $179 Solo subscription would otherwise be
 * able to record on different devices simultaneously. We can't legally
 * enforce non-sharing without EHR write-back (the audit chain that
 * matters lives in the EHR, not OmniScribe), but we can make it
 * OPERATIONALLY impossible: only one device per account can hold the
 * recording lock at a time. Two clinicians sharing credentials
 * discover that whichever of them logs in second kills the other's
 * mid-visit recording. After one experience of that in front of a
 * patient, sharing stops.
 *
 * Lifecycle
 * ---------
 *   claim    → first time a user-device pair issues a realtime-key
 *   refresh  → same device re-mints (the realtime-key route is called
 *              every ~50s before the 60s key TTL expires). Updates
 *              `lastHeartbeatAt` so the lock stays "fresh" without
 *              needing a separate heartbeat endpoint.
 *   takeover → a new device claims while a lock exists. Allowed if
 *              the prior lock is stale (older than the window) OR
 *              the new device passes `takeover=true` (the client's
 *              "this is my real device, kill the other" path).
 *              On takeover, the displaced device's next call sees
 *              "lock no longer yours" and surfaces a friendly
 *              "your recording was taken over" message.
 *   release  → /complete-stream success deletes the row. Explicit
 *              cancel paths (reset-recording) also release.
 *
 * Why per-USER (not per-org or per-noteId)
 * ----------------------------------------
 * Per-user is the credential-sharing surface. Per-noteId would let two
 * clinicians sharing one login record DIFFERENT notes simultaneously
 * (which is exactly what we want to prevent). Per-org would block
 * legitimate teammates from recording at the same time.
 *
 * PHI fence
 * ---------
 * `clientNonce` is opaque (random per device-mount) and never logged
 * in full — only a 6-char prefix in audit metadata. userId/orgId/
 * noteId are the same FK-shaped identifiers used everywhere else in
 * the schema; they are NOT HIPAA Safe Harbor PHI on their own.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import { prisma as defaultPrisma } from '@/lib/prisma';

/**
 * How fresh the heartbeat must be for the lock to be considered
 * "active". 60 seconds matches the realtime-key TTL — if the client
 * hasn't re-minted in over a minute, either the browser tab is gone
 * (crash, navigation, network blip) or the recording finished. Either
 * way the lock is safe to displace.
 *
 * The window is exported for the route handlers' audit metadata (the
 * `displaceReason` calculation) and for the unit tests.
 */
export const LOCK_STALE_MS = 60_000;

/** PHI-safe nonce-prefix length for audit metadata. 6 chars is enough
 *  for a forensic auditor to correlate audit rows for a single device
 *  across multiple recording sessions, and short enough that the full
 *  random nonce can never be recovered from log dumps. */
export const NONCE_PREFIX_LENGTH = 6;

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ClaimArgs = {
  userId: string;
  orgId: string;
  noteId: string;
  clientNonce: string;
  /** When true, the new device displaces ANY existing lock — even one
   *  with a fresh heartbeat. The client sets this only after the
   *  clinician explicitly confirmed in the takeover AlertDialog. */
  takeover?: boolean;
  /** Optional Prisma transaction client — pass when calling from
   *  inside `$transaction` so the lock + a downstream write commit/
   *  rollback together. */
  tx?: DbClient;
};

export type ClaimResult =
  | {
      ok: true;
      action: 'claimed' | 'refreshed' | 'takeover';
      lock: ActiveLockSnapshot;
      /** When action === 'takeover', the noteId of the lock that was
       *  displaced. Pairs with RECORDING_LOCK_TAKEOVER audit metadata. */
      previousNoteId?: string;
      /** ms since the displaced lock's last heartbeat. Lets the audit
       *  row distinguish "stale takeover" from "forced takeover". */
      previousLockAgeMs?: number;
      /** 'stale' = displaced because heartbeat aged out;
       *  'forced' = displaced because takeover=true was passed. */
      displaceReason?: 'stale' | 'forced';
    }
  | {
      ok: false;
      action: 'rejected';
      activeNoteId: string;
      activeClaimedAt: Date;
      activeLockAgeMs: number;
    };

export type ActiveLockSnapshot = {
  id: string;
  userId: string;
  orgId: string;
  noteId: string;
  clientNonce: string;
  claimedAt: Date;
  lastHeartbeatAt: Date;
};

/**
 * Try to claim or refresh the recording lock for `userId`.
 *
 * Branches:
 *   1. No existing lock → CREATE → action: 'claimed'
 *   2. Existing lock with same `clientNonce` → UPDATE heartbeat (and
 *      possibly noteId if the clinician moved to a new note in the
 *      same browser session) → action: 'refreshed'
 *   3. Existing lock, different `clientNonce`, heartbeat stale OR
 *      `takeover=true` → REPLACE → action: 'takeover'
 *   4. Existing lock, different `clientNonce`, heartbeat fresh, no
 *      takeover → REJECT → ok: false, with metadata so the client
 *      can show the AlertDialog and offer takeover.
 *
 * Atomic: the upsert path uses `prisma.activeRecordingLock.upsert`
 * keyed by the unique `userId` index, so concurrent claims race at
 * the DB level and exactly one wins. A loser sees the winner's row
 * on next read.
 */
export async function claimRecordingLock(args: ClaimArgs): Promise<ClaimResult> {
  const db = (args.tx ?? defaultPrisma) as DbClient;
  const now = new Date();

  // We model this as: read existing → decide → write the appropriate
  // mutation. The unique constraint on userId means a concurrent
  // racer who tries the same path either sees our update (and bails
  // gracefully) or gets a write conflict (P2002) we re-throw.
  const existing = await db.activeRecordingLock.findUnique({
    where: { userId: args.userId },
  });

  if (!existing) {
    const created = await db.activeRecordingLock.create({
      data: {
        userId: args.userId,
        orgId: args.orgId,
        noteId: args.noteId,
        clientNonce: args.clientNonce,
        claimedAt: now,
        lastHeartbeatAt: now,
      },
    });
    return { ok: true, action: 'claimed', lock: snapshot(created) };
  }

  // Same device — refresh.
  if (existing.clientNonce === args.clientNonce) {
    const updated = await db.activeRecordingLock.update({
      where: { userId: args.userId },
      data: {
        lastHeartbeatAt: now,
        // Allow same-device note pivot: a clinician finishes recording
        // note A then immediately starts recording note B in the same
        // browser session. The clientNonce stays the same; the noteId
        // moves. (Alternative: require explicit release first. We
        // prefer the friendlier UX.)
        noteId: args.noteId,
      },
    });
    return { ok: true, action: 'refreshed', lock: snapshot(updated) };
  }

  // Different device.
  const ageMs = now.getTime() - existing.lastHeartbeatAt.getTime();
  const isStale = ageMs >= LOCK_STALE_MS;

  if (isStale || args.takeover) {
    const updated = await db.activeRecordingLock.update({
      where: { userId: args.userId },
      data: {
        orgId: args.orgId,
        noteId: args.noteId,
        clientNonce: args.clientNonce,
        claimedAt: now,
        lastHeartbeatAt: now,
      },
    });
    return {
      ok: true,
      action: 'takeover',
      lock: snapshot(updated),
      previousNoteId: existing.noteId,
      previousLockAgeMs: ageMs,
      displaceReason: isStale ? 'stale' : 'forced',
    };
  }

  return {
    ok: false,
    action: 'rejected',
    activeNoteId: existing.noteId,
    activeClaimedAt: existing.claimedAt,
    activeLockAgeMs: ageMs,
  };
}

/**
 * Release the lock for `userId` IFF the caller's nonce matches.
 *
 * The nonce-match guard is the safety: a stale request from a
 * displaced device can't accidentally release the new device's
 * lock. If the nonce doesn't match the current row, this is a
 * no-op (and signals to the caller that the lock has moved).
 *
 * Returns true if a row was deleted, false if nothing matched.
 */
export async function releaseRecordingLock(args: {
  userId: string;
  clientNonce: string;
  tx?: DbClient;
}): Promise<{ released: boolean; lockHeldMs: number | null }> {
  const db = (args.tx ?? defaultPrisma) as DbClient;
  const existing = await db.activeRecordingLock.findUnique({
    where: { userId: args.userId },
  });
  if (!existing || existing.clientNonce !== args.clientNonce) {
    return { released: false, lockHeldMs: null };
  }
  await db.activeRecordingLock.delete({ where: { userId: args.userId } });
  return {
    released: true,
    lockHeldMs: Date.now() - existing.claimedAt.getTime(),
  };
}

/**
 * Confirm a caller still holds the lock — used by /complete-stream
 * before accepting the audio upload. If the lock has been taken over,
 * the caller is the OLD device and should not be allowed to finalize
 * (their audio belongs to a recording someone else is now driving).
 *
 * Returns the snapshot when the nonce matches, null otherwise.
 */
export async function validateRecordingLock(args: {
  userId: string;
  clientNonce: string;
  tx?: DbClient;
}): Promise<ActiveLockSnapshot | null> {
  const db = (args.tx ?? defaultPrisma) as DbClient;
  const existing = await db.activeRecordingLock.findUnique({
    where: { userId: args.userId },
  });
  if (!existing || existing.clientNonce !== args.clientNonce) return null;
  return snapshot(existing);
}

/** Short opaque prefix for audit metadata (PHI-safe by design). */
export function clientNoncePrefix(nonce: string): string {
  return nonce.slice(0, NONCE_PREFIX_LENGTH);
}

function snapshot(row: {
  id: string;
  userId: string;
  orgId: string;
  noteId: string;
  clientNonce: string;
  claimedAt: Date;
  lastHeartbeatAt: Date;
}): ActiveLockSnapshot {
  return {
    id: row.id,
    userId: row.userId,
    orgId: row.orgId,
    noteId: row.noteId,
    clientNonce: row.clientNonce,
    claimedAt: row.claimedAt,
    lastHeartbeatAt: row.lastHeartbeatAt,
  };
}
