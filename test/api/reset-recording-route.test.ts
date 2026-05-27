import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * POST /api/notes/[id]/reset-recording — empty-transcript recovery.
 *
 * Background
 * ----------
 * Reported 2026-05-25: a clinician hit "Finish" on a 4-second silent
 * recording. The pipeline correctly wrote placeholder text (rule 1
 * attestation guard) and the clinician landed on /review with a
 * placeholder-only draft. The /prepare page's recording CTA was
 * disabled because the note was already DRAFT, leaving the clinician
 * unable to re-record. This route is the recovery primitive — it
 * resets the note back to PREPARING after verifying the transcript
 * really was empty.
 *
 * Coverage targets:
 *   - Refuses on a real-content note (transcript with words OR
 *     edited sections) — the SAFETY GUARD that prevents data loss.
 *   - Refuses on SIGNED notes (rule 3).
 *   - Refuses on non-DRAFT/INTERRUPTED states (no work in flight to
 *     preempt).
 *   - Refuses for non-clinician/non-admin callers (rule: only the
 *     assigned clinician or an org admin can reset).
 *   - Happy path: explicit _meta marker → soft-deletes audio + flips
 *     to PREPARING + clears transcript/draft + audits RECORDING_RESET.
 *   - Legacy detection path: notes generated before _meta landed
 *     still reset cleanly via the placeholder-text heuristic.
 */

const noteFindFirst = vi.fn();
const noteUpdate = vi.fn();
const audioSegmentUpdateMany = vi.fn();
const txMock = vi.fn();
const writeAuditLog = vi.fn();
const requireFeatureAccess = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: {
      findFirst: (...a: unknown[]) => noteFindFirst(...a),
      update: (...a: unknown[]) => noteUpdate(...a),
    },
    audioSegment: {
      updateMany: (...a: unknown[]) => audioSegmentUpdateMany(...a),
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      txMock(cb) ??
      cb({
        note: { update: (...a: unknown[]) => noteUpdate(...a) },
        audioSegment: { updateMany: (...a: unknown[]) => audioSegmentUpdateMany(...a) },
      }),
  },
}));

vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));

vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

vi.mock('@/lib/phi-access', () => ({
  assertOrgScoped: vi.fn(),
}));

import { POST } from '@/app/api/notes/[id]/reset-recording/route';

const PLACEHOLDER =
  'No transcript captured for this encounter. This section cannot be drafted from source material. Re-record or paste a transcript, then regenerate this section.';

function authedGuard(role: 'CLINICIAN' | 'ORG_ADMIN' = 'CLINICIAN') {
  return {
    user: { id: 'user_1' },
    orgUser: { orgId: 'org_1' },
    authorizationUser: {
      userId: 'user_1',
      orgUserId: 'ou_caller',
      orgId: 'org_1',
      role,
      division: 'REHAB',
      canManagePatients: false,
    },
  };
}

function noteFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'note_empty',
    orgId: 'org_1',
    patientId: 'pat_1',
    clinicianOrgUserId: 'ou_caller',
    status: 'DRAFT',
    transcriptClean: { plaintext: '', wordCount: 0, structured: [], durationMs: 0 },
    draftJson: {
      plan: { content: PLACEHOLDER, updatedAt: '2026-05-25T23:19:19Z' },
      subjective: { content: PLACEHOLDER, updatedAt: '2026-05-25T23:19:19Z' },
    },
    inferenceLog: {
      _sectionStatus: { plan: { status: 'populated' } },
      _meta: {
        emptyTranscript: true,
        emptyTranscriptDurationMs: 4312,
        emptyTranscriptByteSize: 138028,
        emptyTranscriptDetectedAt: '2026-05-25T23:19:19Z',
      },
    },
    audioSegments: [
      { id: 'seg_a', durationMs: 4312, byteSize: 138028 },
    ],
    ...overrides,
  };
}

function buildRequest() {
  return new Request('http://test.local/api/notes/note_empty/reset-recording', {
    method: 'POST',
  });
}

beforeEach(() => {
  noteFindFirst.mockReset();
  noteUpdate.mockReset();
  audioSegmentUpdateMany.mockReset();
  txMock.mockReset();
  writeAuditLog.mockReset();
  requireFeatureAccess.mockReset();

  requireFeatureAccess.mockResolvedValue(authedGuard());
  noteUpdate.mockResolvedValue({});
  audioSegmentUpdateMany.mockResolvedValue({ count: 1 });
  txMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      note: { update: noteUpdate },
      audioSegment: { updateMany: audioSegmentUpdateMany },
    }),
  );
});

describe('POST /api/notes/[id]/reset-recording — happy path', () => {
  it('flips DRAFT → PREPARING, clears transcript/draft, soft-deletes audio', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture());

    const res = await POST(buildRequest(), {
      params: Promise.resolve({ id: 'note_empty' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      ok: true,
      noteId: 'note_empty',
      status: 'PREPARING',
      discardedSegments: 1,
    });

    // Audio segments were soft-deleted, not hard-deleted (rule 7).
    expect(audioSegmentUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['seg_a'] } },
      data: { isDeleted: true, deletedAt: expect.any(Date) },
    });

    // Note reset payload — status flipped, scratchpad fields cleared.
    expect(noteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'note_empty' },
        data: expect.objectContaining({
          status: 'PREPARING',
          audioFileKey: null,
          interruptedAt: null,
          lastWorkerError: null,
        }),
      }),
    );
  });

  it('audits RECORDING_RESET with discarded-content metadata', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture());

    await POST(buildRequest(), {
      params: Promise.resolve({ id: 'note_empty' }),
    });

    const audit = writeAuditLog.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'RECORDING_RESET',
    );
    expect(audit).toBeDefined();
    const meta = (audit![0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta.priorStatus).toBe('DRAFT');
    expect(meta.segmentIdsSoftDeleted).toEqual(['seg_a']);
    expect(meta.discardedDurationMs).toBe(4312);
    expect(meta.discardedByteSize).toBe(138028);
    expect(meta.reason).toBe('empty_transcript_recovery');
  });

  it('resets a legacy note (no _meta signal) via the placeholder heuristic', async () => {
    noteFindFirst.mockResolvedValueOnce(
      noteFixture({
        inferenceLog: { _sectionStatus: { plan: { status: 'populated' } } },
      }),
    );

    const res = await POST(buildRequest(), {
      params: Promise.resolve({ id: 'note_empty' }),
    });

    expect(res.status).toBe(200);
    expect(noteUpdate).toHaveBeenCalled();
  });

  it('handles INTERRUPTED status the same as DRAFT', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture({ status: 'INTERRUPTED' }));

    const res = await POST(buildRequest(), {
      params: Promise.resolve({ id: 'note_empty' }),
    });
    expect(res.status).toBe(200);
  });

  it('preserves _sectionStats in inferenceLog (org-level latency rollups)', async () => {
    const stats = {
      totalAttempts: 3,
      successCount: 3,
      failureCount: 0,
      latencyP50Ms: 800,
      latencyP95Ms: 1200,
      lastUpdatedAt: '2026-05-25T23:19:00Z',
      recentLatenciesMs: [700, 800, 1200],
    };
    noteFindFirst.mockResolvedValueOnce(
      noteFixture({
        inferenceLog: {
          _sectionStatus: { plan: { status: 'populated' } },
          _meta: { emptyTranscript: true },
          _sectionStats: stats,
        },
      }),
    );

    await POST(buildRequest(), { params: Promise.resolve({ id: 'note_empty' }) });

    const updateData = (noteUpdate.mock.calls[0]![0] as {
      data: { inferenceLog: { _sectionStats?: unknown; _sectionStatus?: unknown; _meta?: unknown } };
    }).data;
    expect(updateData.inferenceLog._sectionStats).toEqual(stats);
    expect(updateData.inferenceLog._sectionStatus).toBeUndefined();
    expect(updateData.inferenceLog._meta).toBeUndefined();
  });
});

describe('POST /api/notes/[id]/reset-recording — refusals (safety guards)', () => {
  it('refuses 409 has_content when transcript has words (real recording)', async () => {
    noteFindFirst.mockResolvedValueOnce(
      noteFixture({
        transcriptClean: { plaintext: 'real visit', wordCount: 42, structured: [], durationMs: 30000 },
      }),
    );

    const res = await POST(buildRequest(), {
      params: Promise.resolve({ id: 'note_empty' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('has_content');
    expect(noteUpdate).not.toHaveBeenCalled();
    expect(audioSegmentUpdateMany).not.toHaveBeenCalled();
  });

  it('refuses 409 has_content when a section was edited away from placeholder', async () => {
    // Partial recovery: clinician already wrote real content into one
    // section. Reset would destroy that work — refuse.
    noteFindFirst.mockResolvedValueOnce(
      noteFixture({
        inferenceLog: { _sectionStatus: { plan: { status: 'populated' } } },
        draftJson: {
          plan: { content: PLACEHOLDER, updatedAt: '2026-05-25T23:19:19Z' },
          subjective: { content: 'Patient reports new symptoms.', updatedAt: '2026-05-25T23:30:00Z' },
        },
      }),
    );

    const res = await POST(buildRequest(), {
      params: Promise.resolve({ id: 'note_empty' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('has_content');
    expect(noteUpdate).not.toHaveBeenCalled();
  });

  it('refuses 409 note_signed on SIGNED notes (rule 3)', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture({ status: 'SIGNED' }));

    const res = await POST(buildRequest(), {
      params: Promise.resolve({ id: 'note_empty' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('note_signed');
    expect(noteUpdate).not.toHaveBeenCalled();
  });

  it('refuses 409 invalid_state on PREPARING / RECORDING / DRAFTING', async () => {
    for (const status of ['PREPARING', 'RECORDING', 'PAUSED', 'TRANSCRIBING', 'DRAFTING']) {
      noteFindFirst.mockResolvedValueOnce(noteFixture({ status }));
      const res = await POST(buildRequest(), {
        params: Promise.resolve({ id: 'note_empty' }),
      });
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe('invalid_state');
    }
    expect(noteUpdate).not.toHaveBeenCalled();
  });

  it('refuses 403 forbidden when caller is not the assigned clinician', async () => {
    requireFeatureAccess.mockResolvedValueOnce({
      ...authedGuard(),
      authorizationUser: {
        ...authedGuard().authorizationUser,
        orgUserId: 'ou_someone_else',
      },
    });
    noteFindFirst.mockResolvedValueOnce(noteFixture());

    const res = await POST(buildRequest(), {
      params: Promise.resolve({ id: 'note_empty' }),
    });
    expect(res.status).toBe(403);
    expect(noteUpdate).not.toHaveBeenCalled();
  });

  it('allows ORG_ADMIN to reset another clinician’s empty draft', async () => {
    requireFeatureAccess.mockResolvedValueOnce({
      ...authedGuard('ORG_ADMIN'),
      authorizationUser: {
        ...authedGuard('ORG_ADMIN').authorizationUser,
        orgUserId: 'ou_admin',
      },
    });
    noteFindFirst.mockResolvedValueOnce(noteFixture());

    const res = await POST(buildRequest(), {
      params: Promise.resolve({ id: 'note_empty' }),
    });
    expect(res.status).toBe(200);
    expect(noteUpdate).toHaveBeenCalled();
  });

  it('returns 404 when the note is not found', async () => {
    noteFindFirst.mockResolvedValueOnce(null);

    const res = await POST(buildRequest(), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });
});
