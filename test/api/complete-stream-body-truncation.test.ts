import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * POST /api/notes/[id]/complete-stream — body-truncation regression.
 *
 * Reported 2026-05-25: a clinician completed a real, multi-minute
 * recording on /capture, hit Finish, and saw "Couldn't finalize the
 * recording (500)" with no further detail. Dev-server log showed:
 *
 *   "Request body exceeded 10MB for /api/notes/.../complete-stream.
 *    Only the first 10MB will be available unless configured."
 *   ⨯ TypeError: Failed to parse body as FormData.
 *     [cause]: TypeError: expected boundary after body
 *
 * Root cause was Next.js 16's middleware/proxy buffer truncating the
 * multipart body to 10 MB by default (the impersonation middleware in
 * src/middleware.ts forces every /api request through the buffer);
 * once truncated, the multipart boundary line is gone and
 * `req.formData()` throws a generic TypeError → 500.
 *
 * Fixes shipped:
 *   1. `experimental.proxyClientMaxBodySize: '200mb'` in next.config.ts
 *      so the buffer is sized for real clinical recordings.
 *   2. The route now wraps `req.formData()` in try/catch and maps
 *      parse failures to 413 `audio_too_large` with a clear message
 *      so the client surfaces a useful error instead of an opaque 500.
 *
 * This test pins the SECOND fix — the route's defense in depth. If
 * someone someday lowers the proxy buffer, removes the limit, or a
 * client sends a malformed multipart payload for any other reason,
 * the user must still get a clean error.
 */

const noteFindFirst = vi.fn();
const writeAuditLog = vi.fn();
const requireFeatureAccess = vi.fn();
const enqueueTranscriptionJob = vi.fn();
const putAudio = vi.fn();
const audioKeyFor = vi.fn((..._args: unknown[]) => 'stub/key');

vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: { findFirst: (...a: unknown[]) => noteFindFirst(...a), update: vi.fn() },
    audioSegment: { create: vi.fn(), update: vi.fn() },
    $transaction: async (ops: unknown) => ops,
  },
}));

vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));

vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

vi.mock('@/lib/queue', () => ({
  enqueueTranscriptionJob: (...a: unknown[]) => enqueueTranscriptionJob(...a),
}));

vi.mock('@/lib/s3/client', () => ({
  audioKeyFor: (...a: unknown[]) => audioKeyFor(...a),
  putAudio: (...a: unknown[]) => putAudio(...a),
}));

import { POST } from '@/app/api/notes/[id]/complete-stream/route';

function authedGuard() {
  return {
    user: { id: 'user_1' },
    orgUser: { orgId: 'org_1' },
    authorizationUser: {
      userId: 'user_1',
      orgUserId: 'ou_caller',
      orgId: 'org_1',
      role: 'CLINICIAN',
    },
  };
}

beforeEach(() => {
  noteFindFirst.mockReset();
  writeAuditLog.mockReset();
  requireFeatureAccess.mockReset();
  enqueueTranscriptionJob.mockReset();
  putAudio.mockReset();

  requireFeatureAccess.mockResolvedValue(authedGuard());
  noteFindFirst.mockResolvedValue({
    id: 'note_1',
    status: 'RECORDING',
    clinicianOrgUserId: 'ou_caller',
    captureMode: 'LIVE',
  });
});

/**
 * Build a Request whose `formData()` throws with the exact error
 * Next.js raises on a truncated multipart boundary. We can't easily
 * fabricate a raw truncated multipart payload in a test env, so we
 * stub the method directly — this exercises the route's catch
 * handler with the same error shape it sees in production.
 */
function requestWithBrokenFormData(): Request {
  const req = new Request('http://test.local/api/notes/note_1/complete-stream', {
    method: 'POST',
    body: 'irrelevant',
  });
  Object.defineProperty(req, 'formData', {
    value: async () => {
      const err = new TypeError('Failed to parse body as FormData.');
      // The TypeError Next.js raises has a `cause` field — preserved
      // through fetch's body-parser. The route doesn't read it, but
      // the audit row records the message so we keep the shape
      // realistic for any future inspection.
      Object.assign(err, {
        cause: new TypeError('expected boundary after body'),
      });
      throw err;
    },
  });
  return req;
}

describe('POST /api/notes/[id]/complete-stream — body-truncation defense', () => {
  it('returns 413 audio_too_large when formData() throws (truncated multipart)', async () => {
    const res = await POST(requestWithBrokenFormData(), {
      params: Promise.resolve({ id: 'note_1' }),
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe('audio_too_large');
    // Message is user-friendly enough to surface in the
    // capture-state error chip without further translation.
    expect(body.error.message).toMatch(/too large/i);
  });

  it('audits RECORDING_FINALIZED with body_parse_failed outcome', async () => {
    await POST(requestWithBrokenFormData(), {
      params: Promise.resolve({ id: 'note_1' }),
    });

    const audit = writeAuditLog.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'RECORDING_FINALIZED',
    );
    expect(audit).toBeDefined();
    const meta = (audit![0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta.outcome).toBe('body_parse_failed');
    expect(typeof meta.message).toBe('string');
  });

  it('does NOT enqueue transcription / write audio on a body parse failure', async () => {
    await POST(requestWithBrokenFormData(), {
      params: Promise.resolve({ id: 'note_1' }),
    });
    expect(enqueueTranscriptionJob).not.toHaveBeenCalled();
    expect(putAudio).not.toHaveBeenCalled();
  });

  it('refuses 404 when note is not found (preflight before body parse)', async () => {
    noteFindFirst.mockResolvedValueOnce(null);
    const res = await POST(requestWithBrokenFormData(), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
    // The 413 path must NOT fire when the note 404s — auth+preflight
    // run before formData() is even called.
    expect(writeAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RECORDING_FINALIZED' }),
    );
  });
});

describe('POST /api/notes/[id]/complete-stream — autoStopReason audit', () => {
  /**
   * Build a Request whose `formData()` returns a synthetic
   * empty-audio payload + the autoStopReason field. We don't need a
   * real WAV for this audit-shape assertion — the route's
   * audio-missing branch (transcript-only finalize) commits without
   * S3 + still writes RECORDING_FINALIZED with the auto-stop reason.
   */
  function requestWithAutoStop(reason: string): Request {
    const req = new Request('http://test.local/api/notes/note_1/complete-stream', {
      method: 'POST',
      body: 'irrelevant',
    });
    Object.defineProperty(req, 'formData', {
      value: async () => {
        const fd = new FormData();
        fd.append('finalTranscript', JSON.stringify({ segments: [], partial: '' }));
        fd.append('autoStopReason', reason);
        // No 'audio' field → audio_missing path (dev-allowed). The
        // route still fires RECORDING_FINALIZED with the metadata
        // we want to verify here.
        return fd;
      },
    });
    return req;
  }

  it('records autoStopReason: "time_limit" in RECORDING_FINALIZED audit', async () => {
    const res = await POST(requestWithAutoStop('time_limit'), {
      params: Promise.resolve({ id: 'note_1' }),
    });
    expect(res.status).toBe(200);

    const audit = writeAuditLog.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'RECORDING_FINALIZED',
    );
    expect(audit).toBeDefined();
    expect(
      (audit![0] as { metadata: Record<string, unknown> }).metadata.autoStopReason,
    ).toBe('time_limit');
  });

  it('records autoStopReason: "size_limit" in RECORDING_FINALIZED audit', async () => {
    const res = await POST(requestWithAutoStop('size_limit'), {
      params: Promise.resolve({ id: 'note_1' }),
    });
    expect(res.status).toBe(200);

    const audit = writeAuditLog.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'RECORDING_FINALIZED',
    );
    expect(audit).toBeDefined();
    expect(
      (audit![0] as { metadata: Record<string, unknown> }).metadata.autoStopReason,
    ).toBe('size_limit');
  });

  it('records autoStopReason: null when no auto-stop fired (normal finish)', async () => {
    const req = new Request('http://test.local/api/notes/note_1/complete-stream', {
      method: 'POST',
      body: 'irrelevant',
    });
    Object.defineProperty(req, 'formData', {
      value: async () => {
        const fd = new FormData();
        fd.append('finalTranscript', JSON.stringify({ segments: [], partial: '' }));
        // No autoStopReason field at all.
        return fd;
      },
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(200);

    const audit = writeAuditLog.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'RECORDING_FINALIZED',
    );
    expect(
      (audit![0] as { metadata: Record<string, unknown> }).metadata.autoStopReason,
    ).toBeNull();
  });

  it('rejects unknown autoStopReason values (defensive — no audit pollution)', async () => {
    const res = await POST(requestWithAutoStop('hacked_value'), {
      params: Promise.resolve({ id: 'note_1' }),
    });
    expect(res.status).toBe(200);

    const audit = writeAuditLog.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'RECORDING_FINALIZED',
    );
    expect(
      (audit![0] as { metadata: Record<string, unknown> }).metadata.autoStopReason,
    ).toBeNull();
  });
});
