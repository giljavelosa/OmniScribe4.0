import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoteStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// POST /api/notes/[id]/realtime-key — lock-claim integration tests.
//
// We mock the recording-lock helper + the auth + transcription mint paths
// so the test exercises ONLY the lock-claim wiring on the route. The
// helper itself is tested independently in test/lib/recording-lock-claim.test.ts.
// ---------------------------------------------------------------------------

const requireFeatureAccess = vi.fn();
const noteFindFirst = vi.fn();
const noteUpdate = vi.fn();
const auditLogCreate = vi.fn();
const mintEphemeralKey = vi.fn();
const claimRecordingLock = vi.fn();

vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: {
      findFirst: (...a: unknown[]) => noteFindFirst(...a),
      update: (...a: unknown[]) => noteUpdate(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditLogCreate(...a) },
  },
}));
vi.mock('@/services/transcription', () => ({
  mintEphemeralKey: (...a: unknown[]) => mintEphemeralKey(...a),
}));
vi.mock('@/lib/recording-lock/claim', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/recording-lock/claim')>(
      '@/lib/recording-lock/claim',
    );
  return {
    ...actual,
    claimRecordingLock: (...a: unknown[]) => claimRecordingLock(...a),
  };
});

import { POST } from '@/app/api/notes/[id]/realtime-key/route';

const NOTE_ID = 'note_alvarez';
const USER_ID = 'user_clinician';
const ORG_ID = 'org_demo';
const ORGUSER_ID = 'orguser_clinician';
const NONCE = 'nonceaa-tablet-abc12345';
const OTHER_NONCE = 'nonceeb-phone-xyz98765';

function postReq(body?: object): Request {
  return new Request(`http://localhost/api/notes/${NOTE_ID}/realtime-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function params() {
  return { params: Promise.resolve({ id: NOTE_ID }) };
}

beforeEach(() => {
  requireFeatureAccess.mockReset().mockResolvedValue({
    user: { id: USER_ID },
    authorizationUser: {
      orgId: ORG_ID,
      orgUserId: ORGUSER_ID,
      role: 'CLINICIAN',
    },
    orgUser: { orgId: ORG_ID },
  });
  noteFindFirst.mockReset().mockResolvedValue({
    id: NOTE_ID,
    orgId: ORG_ID,
    status: NoteStatus.RECORDING,
    clinicianOrgUserId: ORGUSER_ID,
  });
  noteUpdate.mockReset().mockResolvedValue({});
  auditLogCreate.mockReset().mockResolvedValue({});
  mintEphemeralKey.mockReset().mockResolvedValue({
    apiKey: 'stub-key',
    websocketUrl: 'wss://stub.example/ws',
    config: { audio_format: 'pcm_s16le' },
    expiresAt: new Date('2026-05-25T22:01:00Z').toISOString(),
    stub: true,
    keyMode: 'stub',
  });
  claimRecordingLock.mockReset();
});

describe('realtime-key — happy path (claim)', () => {
  it('claims a fresh lock and returns the Soniox key data', async () => {
    claimRecordingLock.mockResolvedValue({
      ok: true,
      action: 'claimed',
      lock: {
        id: 'lock_1',
        userId: USER_ID,
        orgId: ORG_ID,
        noteId: NOTE_ID,
        clientNonce: NONCE,
        claimedAt: new Date(),
        lastHeartbeatAt: new Date(),
      },
    });

    const res = await POST(postReq({ clientNonce: NONCE }), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.apiKey).toBe('stub-key');
    expect(body.data.clientNonce).toBe(NONCE);

    // RECORDING_LOCK_CLAIMED audit row written.
    const auditActions = auditLogCreate.mock.calls.map(
      (c) => (c[0] as { data: { action: string } }).data.action,
    );
    expect(auditActions).toContain('RECORDING_LOCK_CLAIMED');
    expect(auditActions).toContain('REALTIME_KEY_ISSUED');
  });

  it('refreshes the lock for a same-device re-mint (different audit action)', async () => {
    claimRecordingLock.mockResolvedValue({
      ok: true,
      action: 'refreshed',
      lock: {
        id: 'lock_1',
        userId: USER_ID,
        orgId: ORG_ID,
        noteId: NOTE_ID,
        clientNonce: NONCE,
        claimedAt: new Date(Date.now() - 30_000),
        lastHeartbeatAt: new Date(Date.now() - 1_000),
      },
    });

    const res = await POST(postReq({ clientNonce: NONCE }), params());
    expect(res.status).toBe(200);

    const auditActions = auditLogCreate.mock.calls.map(
      (c) => (c[0] as { data: { action: string } }).data.action,
    );
    expect(auditActions).toContain('RECORDING_LOCK_REFRESHED');
    expect(auditActions).not.toContain('RECORDING_LOCK_CLAIMED');
  });
});

describe('realtime-key — lock conflict', () => {
  it('returns 409 recording_locked when a different device already holds the lock', async () => {
    const claimedAt = new Date('2026-05-25T21:55:00Z');
    claimRecordingLock.mockResolvedValue({
      ok: false,
      action: 'rejected',
      activeNoteId: 'note_park',
      activeClaimedAt: claimedAt,
      activeLockAgeMs: 12_000,
    });

    const res = await POST(postReq({ clientNonce: OTHER_NONCE }), params());
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error.code).toBe('recording_locked');
    expect(body.meta.activeNoteId).toBe('note_park');
    expect(body.meta.activeLockAgeMs).toBe(12_000);
    expect(body.meta.activeClaimedAt).toBe(claimedAt.toISOString());

    // Mint NEVER called when the lock claim failed.
    expect(mintEphemeralKey).not.toHaveBeenCalled();

    // RECORDING_LOCK_REJECTED audit row written.
    const auditActions = auditLogCreate.mock.calls.map(
      (c) => (c[0] as { data: { action: string } }).data.action,
    );
    expect(auditActions).toContain('RECORDING_LOCK_REJECTED');
    expect(auditActions).not.toContain('RECORDING_LOCK_CLAIMED');
  });
});

describe('realtime-key — takeover', () => {
  it('audits RECORDING_LOCK_TAKEOVER with displaceReason when a stale lock is replaced', async () => {
    claimRecordingLock.mockResolvedValue({
      ok: true,
      action: 'takeover',
      lock: {
        id: 'lock_1',
        userId: USER_ID,
        orgId: ORG_ID,
        noteId: NOTE_ID,
        clientNonce: OTHER_NONCE,
        claimedAt: new Date(),
        lastHeartbeatAt: new Date(),
      },
      previousNoteId: 'note_park',
      previousLockAgeMs: 75_000,
      displaceReason: 'stale',
    });

    const res = await POST(postReq({ clientNonce: OTHER_NONCE }), params());
    expect(res.status).toBe(200);

    const takeoverCall = auditLogCreate.mock.calls.find(
      (c) =>
        (c[0] as { data: { action: string } }).data.action ===
        'RECORDING_LOCK_TAKEOVER',
    );
    expect(takeoverCall).toBeDefined();
    const meta = (takeoverCall![0] as { data: { metadata: Record<string, unknown> } })
      .data.metadata;
    expect(meta).toMatchObject({
      newNoteId: NOTE_ID,
      previousNoteId: 'note_park',
      previousLockAgeMs: 75_000,
      displaceReason: 'stale',
    });
  });

  it('passes takeover=true through to the helper for a forced takeover', async () => {
    claimRecordingLock.mockResolvedValue({
      ok: true,
      action: 'takeover',
      lock: {
        id: 'lock_1',
        userId: USER_ID,
        orgId: ORG_ID,
        noteId: NOTE_ID,
        clientNonce: OTHER_NONCE,
        claimedAt: new Date(),
        lastHeartbeatAt: new Date(),
      },
      previousNoteId: NOTE_ID,
      previousLockAgeMs: 5_000,
      displaceReason: 'forced',
    });

    await POST(
      postReq({ clientNonce: OTHER_NONCE, takeover: true }),
      params(),
    );

    expect(claimRecordingLock).toHaveBeenCalledWith(
      expect.objectContaining({ takeover: true, clientNonce: OTHER_NONCE }),
    );
  });
});

describe('realtime-key — PHI fence on audit metadata', () => {
  it('only writes the 6-char nonce prefix, never the full nonce', async () => {
    claimRecordingLock.mockResolvedValue({
      ok: true,
      action: 'claimed',
      lock: {
        id: 'lock_1',
        userId: USER_ID,
        orgId: ORG_ID,
        noteId: NOTE_ID,
        clientNonce: NONCE,
        claimedAt: new Date(),
        lastHeartbeatAt: new Date(),
      },
    });

    await POST(postReq({ clientNonce: NONCE }), params());

    const claimedCall = auditLogCreate.mock.calls.find(
      (c) =>
        (c[0] as { data: { action: string } }).data.action ===
        'RECORDING_LOCK_CLAIMED',
    );
    const meta = (claimedCall![0] as { data: { metadata: Record<string, unknown> } })
      .data.metadata;
    expect(meta.clientNoncePrefix).toBe(NONCE.slice(0, 6));

    // Full nonce must NEVER appear anywhere in audit metadata.
    const allMeta = JSON.stringify(
      auditLogCreate.mock.calls.map(
        (c) => (c[0] as { data: { metadata: unknown } }).data.metadata,
      ),
    );
    expect(allMeta).not.toContain(NONCE);
  });
});

describe('realtime-key — backward compat (legacy clients)', () => {
  it('accepts a body-less POST and generates a server-side nonce', async () => {
    claimRecordingLock.mockResolvedValue({
      ok: true,
      action: 'claimed',
      lock: {
        id: 'lock_1',
        userId: USER_ID,
        orgId: ORG_ID,
        noteId: NOTE_ID,
        clientNonce: 'legacy-server-generated',
        claimedAt: new Date(),
        lastHeartbeatAt: new Date(),
      },
    });

    const res = await POST(postReq(), params());
    expect(res.status).toBe(200);

    // Server-generated nonce is echoed back so the client (if it
    // ever upgrades) can refresh from the same identity.
    const body = await res.json();
    expect(body.data.clientNonce).toMatch(/^legacy-/);

    expect(claimRecordingLock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientNonce: expect.stringMatching(/^legacy-/),
        takeover: false,
      }),
    );
  });
});
