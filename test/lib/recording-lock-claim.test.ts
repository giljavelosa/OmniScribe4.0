import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Recording-lock helper tests.
 *
 * The lock module is pure logic over the Prisma client — we mock the
 * single `activeRecordingLock` model and assert every branch of
 * `claimRecordingLock` + `releaseRecordingLock` + `validateRecordingLock`.
 *
 * What's covered:
 *   1. First claim creates a row.
 *   2. Same-device claim refreshes the heartbeat (and lets the
 *      noteId pivot if the clinician moved to a new note).
 *   3. Different-device claim with a FRESH lock → rejected (the
 *      caller will offer takeover via AlertDialog).
 *   4. Different-device claim with a STALE lock → automatic takeover.
 *   5. Different-device claim with takeover=true on a FRESH lock →
 *      forced takeover (the user explicitly confirmed in the dialog).
 *   6. Release with matching nonce removes the row + reports lockHeldMs.
 *   7. Release with mismatched nonce is a no-op (don't accidentally
 *      free someone else's lock).
 *   8. Validate returns the snapshot when nonce matches; null when
 *      it doesn't or the row is gone.
 *   9. The 6-char nonce prefix is stable + PHI-safe.
 */

const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
const del = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    activeRecordingLock: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
      delete: (...a: unknown[]) => del(...a),
    },
  },
}));

import {
  claimRecordingLock,
  clientNoncePrefix,
  LOCK_STALE_MS,
  releaseRecordingLock,
  validateRecordingLock,
} from '@/lib/recording-lock/claim';

const NOW = new Date('2026-05-25T22:00:00.000Z');
const USER = 'user_solo_clinician';
const ORG = 'org_demo';
const NOTE_A = 'note_alvarez_visit';
const NOTE_B = 'note_park_visit';
const NONCE_DEVICE_A = 'noncea-tablet-abc1234567';
const NONCE_DEVICE_B = 'nonceb-phone-zyx9876543';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  findUnique.mockReset();
  create.mockReset();
  update.mockReset();
  del.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function existingLock(overrides: Partial<{
  noteId: string;
  clientNonce: string;
  claimedAt: Date;
  lastHeartbeatAt: Date;
}> = {}) {
  return {
    id: 'lock_existing',
    userId: USER,
    orgId: ORG,
    noteId: overrides.noteId ?? NOTE_A,
    clientNonce: overrides.clientNonce ?? NONCE_DEVICE_A,
    claimedAt: overrides.claimedAt ?? new Date(NOW.getTime() - 5_000),
    lastHeartbeatAt: overrides.lastHeartbeatAt ?? new Date(NOW.getTime() - 5_000),
  };
}

describe('claimRecordingLock — first claim', () => {
  it('creates a new row when no lock exists for the user', async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({
      id: 'lock_new',
      userId: USER,
      orgId: ORG,
      noteId: NOTE_A,
      clientNonce: NONCE_DEVICE_A,
      claimedAt: NOW,
      lastHeartbeatAt: NOW,
    });

    const result = await claimRecordingLock({
      userId: USER,
      orgId: ORG,
      noteId: NOTE_A,
      clientNonce: NONCE_DEVICE_A,
    });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ action: 'claimed' });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER,
        orgId: ORG,
        noteId: NOTE_A,
        clientNonce: NONCE_DEVICE_A,
        claimedAt: NOW,
        lastHeartbeatAt: NOW,
      }),
    });
  });
});

describe('claimRecordingLock — same-device refresh', () => {
  it('updates heartbeat without changing the nonce', async () => {
    findUnique.mockResolvedValue(existingLock());
    update.mockResolvedValue({
      ...existingLock(),
      lastHeartbeatAt: NOW,
    });

    const result = await claimRecordingLock({
      userId: USER,
      orgId: ORG,
      noteId: NOTE_A,
      clientNonce: NONCE_DEVICE_A,
    });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ action: 'refreshed' });
    expect(update).toHaveBeenCalledWith({
      where: { userId: USER },
      data: expect.objectContaining({
        lastHeartbeatAt: NOW,
        noteId: NOTE_A,
      }),
    });
    // Nonce is NOT included in the data — the device identity is
    // unchanged on a refresh.
    expect(update.mock.calls[0]?.[0]?.data?.clientNonce).toBeUndefined();
  });

  it('allows the same device to pivot to a new note (refresh with new noteId)', async () => {
    findUnique.mockResolvedValue(existingLock({ noteId: NOTE_A }));
    update.mockResolvedValue({
      ...existingLock({ noteId: NOTE_B }),
      lastHeartbeatAt: NOW,
    });

    const result = await claimRecordingLock({
      userId: USER,
      orgId: ORG,
      noteId: NOTE_B,
      clientNonce: NONCE_DEVICE_A,
    });

    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({
      where: { userId: USER },
      data: expect.objectContaining({ noteId: NOTE_B }),
    });
  });
});

describe('claimRecordingLock — different-device REJECT (lock fresh, no takeover)', () => {
  it('rejects when the existing lock heartbeat is fresh and takeover=false', async () => {
    findUnique.mockResolvedValue(
      existingLock({
        clientNonce: NONCE_DEVICE_A,
        // Heartbeat just 10s ago — well under the 60s staleness window.
        lastHeartbeatAt: new Date(NOW.getTime() - 10_000),
      }),
    );

    const result = await claimRecordingLock({
      userId: USER,
      orgId: ORG,
      noteId: NOTE_B,
      clientNonce: NONCE_DEVICE_B,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable'); // narrow for TS
    expect(result.action).toBe('rejected');
    expect(result.activeNoteId).toBe(NOTE_A);
    expect(result.activeLockAgeMs).toBe(10_000);
    // No write side effects — the rejected path doesn't mutate.
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('claimRecordingLock — different-device TAKEOVER (stale)', () => {
  it('automatically takes over when the existing heartbeat is past the staleness window', async () => {
    const STALE_AGE_MS = LOCK_STALE_MS + 5_000;
    findUnique.mockResolvedValue(
      existingLock({
        clientNonce: NONCE_DEVICE_A,
        lastHeartbeatAt: new Date(NOW.getTime() - STALE_AGE_MS),
        claimedAt: new Date(NOW.getTime() - STALE_AGE_MS),
      }),
    );
    update.mockResolvedValue({
      ...existingLock(),
      noteId: NOTE_B,
      clientNonce: NONCE_DEVICE_B,
      claimedAt: NOW,
      lastHeartbeatAt: NOW,
    });

    const result = await claimRecordingLock({
      userId: USER,
      orgId: ORG,
      noteId: NOTE_B,
      clientNonce: NONCE_DEVICE_B,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.action).toBe('takeover');
    expect(result.previousNoteId).toBe(NOTE_A);
    expect(result.previousLockAgeMs).toBeGreaterThanOrEqual(LOCK_STALE_MS);
    expect(result.displaceReason).toBe('stale');
    expect(update).toHaveBeenCalledWith({
      where: { userId: USER },
      data: expect.objectContaining({
        clientNonce: NONCE_DEVICE_B,
        noteId: NOTE_B,
        claimedAt: NOW,
      }),
    });
  });
});

describe('claimRecordingLock — different-device TAKEOVER (forced)', () => {
  it('takes over even on a fresh lock when takeover=true', async () => {
    findUnique.mockResolvedValue(
      existingLock({
        clientNonce: NONCE_DEVICE_A,
        // Heartbeat just 5s ago — would normally REJECT, but takeover
        // is forced.
        lastHeartbeatAt: new Date(NOW.getTime() - 5_000),
      }),
    );
    update.mockResolvedValue({
      ...existingLock(),
      noteId: NOTE_B,
      clientNonce: NONCE_DEVICE_B,
      claimedAt: NOW,
      lastHeartbeatAt: NOW,
    });

    const result = await claimRecordingLock({
      userId: USER,
      orgId: ORG,
      noteId: NOTE_B,
      clientNonce: NONCE_DEVICE_B,
      takeover: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.action).toBe('takeover');
    expect(result.displaceReason).toBe('forced');
    expect(result.previousLockAgeMs).toBe(5_000);
  });
});

describe('releaseRecordingLock', () => {
  it('deletes the row when the nonce matches and reports lockHeldMs', async () => {
    const existing = existingLock({
      claimedAt: new Date(NOW.getTime() - 90_000),
    });
    findUnique.mockResolvedValue(existing);
    del.mockResolvedValue(existing);

    const result = await releaseRecordingLock({
      userId: USER,
      clientNonce: NONCE_DEVICE_A,
    });

    expect(result.released).toBe(true);
    expect(result.lockHeldMs).toBeGreaterThanOrEqual(90_000);
    expect(del).toHaveBeenCalledWith({ where: { userId: USER } });
  });

  it('refuses to release a lock owned by a different nonce (no-op)', async () => {
    findUnique.mockResolvedValue(existingLock({ clientNonce: NONCE_DEVICE_A }));

    const result = await releaseRecordingLock({
      userId: USER,
      clientNonce: NONCE_DEVICE_B,
    });

    expect(result.released).toBe(false);
    expect(result.lockHeldMs).toBeNull();
    expect(del).not.toHaveBeenCalled();
  });

  it('handles the case where no lock exists', async () => {
    findUnique.mockResolvedValue(null);

    const result = await releaseRecordingLock({
      userId: USER,
      clientNonce: NONCE_DEVICE_A,
    });

    expect(result.released).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });
});

describe('validateRecordingLock', () => {
  it('returns the snapshot when the nonce matches', async () => {
    findUnique.mockResolvedValue(existingLock());
    const snap = await validateRecordingLock({
      userId: USER,
      clientNonce: NONCE_DEVICE_A,
    });
    expect(snap).not.toBeNull();
    expect(snap?.noteId).toBe(NOTE_A);
  });

  it('returns null when the nonce does NOT match', async () => {
    findUnique.mockResolvedValue(existingLock({ clientNonce: NONCE_DEVICE_A }));
    const snap = await validateRecordingLock({
      userId: USER,
      clientNonce: NONCE_DEVICE_B,
    });
    expect(snap).toBeNull();
  });

  it('returns null when no lock exists', async () => {
    findUnique.mockResolvedValue(null);
    expect(
      await validateRecordingLock({ userId: USER, clientNonce: NONCE_DEVICE_A }),
    ).toBeNull();
  });
});

describe('clientNoncePrefix — PHI fence', () => {
  it('returns exactly the first 6 chars (audit-safe)', () => {
    expect(clientNoncePrefix('noncea-tablet-abc1234567')).toBe('noncea');
    expect(clientNoncePrefix('short')).toBe('short');
    expect(clientNoncePrefix('')).toBe('');
  });

  it('NEVER returns the full nonce (forensic-safe)', () => {
    const full = 'noncea-tablet-abc1234567';
    const prefix = clientNoncePrefix(full);
    expect(prefix.length).toBeLessThan(full.length);
  });
});
