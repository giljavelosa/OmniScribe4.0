import { createHash } from 'node:crypto';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks. The handler imports prisma, the audit writer, FlagAnalyzer, and the
// patient projection. section-status.ts (recordFlagAnalyses / readInferenceLog)
// runs FOR REAL against the mocked prisma — that's what we want to exercise.
// ---------------------------------------------------------------------------

const noteFindFirst = vi.fn();
const noteFindUnique = vi.fn();
const noteUpdate = vi.fn();
const reviewFlagDeleteMany = vi.fn();
const reviewFlagCreate = vi.fn();
const writeAuditLog = vi.fn();
const analyzeSection = vi.fn();

const txn = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({ reviewFlag: { deleteMany: reviewFlagDeleteMany, create: reviewFlagCreate } }),
);

vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: {
      findFirst: (...a: unknown[]) => noteFindFirst(...a),
      findUnique: (...a: unknown[]) => noteFindUnique(...a),
      update: (...a: unknown[]) => noteUpdate(...a),
    },
    $transaction: (fn: (tx: unknown) => unknown) => txn(fn),
  },
}));
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));
vi.mock('@/services/review/FlagAnalyzer', () => ({
  FlagAnalyzer: class {
    analyzeSection(...a: unknown[]) {
      return analyzeSection(...a);
    }
  },
}));
vi.mock('@/lib/notes/projections', () => ({
  projectPatientForPrompt: (p: unknown) => p,
}));

import { handleAnalyzeFlags } from '@/workers/ai-generation/analyze-flags-handler';

const S1_CONTENT = 'Patient reports intermittent headaches for two weeks, worse in the morning.';
const S2_CONTENT = 'Assessment: tension-type headache, likely stress-related. Plan: hydrate, follow up.';

const hashOf = (s: string) => createHash('sha256').update(s).digest('hex');

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note_1',
    orgId: 'org_1',
    status: 'REVIEWING',
    division: 'PRIMARY_CARE',
    template: {
      id: 'tpl_1',
      sectionSchema: {
        sections: [
          { id: 's1', label: 'Subjective' },
          { id: 's2', label: 'Assessment' },
        ],
      },
    },
    patient: { id: 'pt_1' },
    transcriptClean: null,
    draftJson: { s1: { content: S1_CONTENT } },
    inferenceLog: null,
    ...overrides,
  };
}

function run() {
  return handleAnalyzeFlags({
    data: { noteId: 'note_1', orgId: 'org_1', type: 'analyze-flags', requestId: 'req_1' },
  } as unknown as Parameters<typeof handleAnalyzeFlags>[0]);
}

beforeEach(() => {
  noteFindFirst.mockReset();
  noteFindUnique.mockReset();
  noteUpdate.mockReset();
  reviewFlagDeleteMany.mockReset();
  reviewFlagCreate.mockReset();
  writeAuditLog.mockReset();
  analyzeSection.mockReset();
  txn.mockClear();
  reviewFlagDeleteMany.mockResolvedValue({ count: 0 });
  reviewFlagCreate.mockResolvedValue({ id: 'flag_x' });
  noteUpdate.mockResolvedValue({});
});

describe('analyze-flags handler — content-hash gate', () => {
  it('first analysis: no prior fingerprint → runs the LLM and stamps the hash', async () => {
    noteFindFirst.mockResolvedValueOnce(makeNote());
    analyzeSection.mockResolvedValueOnce({
      flags: [{ severity: 'RED', claim: 'unsupported', rationale: 'no transcript evidence' }],
    });
    noteFindUnique.mockResolvedValueOnce({ inferenceLog: null });

    const result = await run();

    expect(analyzeSection).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      sectionsAnalyzed: 1,
      sectionsSkipped: 0,
      flagsCreated: 1,
    });
    expect(noteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'note_1' },
        data: expect.objectContaining({
          inferenceLog: expect.objectContaining({
            _flagAnalysis: expect.objectContaining({
              s1: expect.objectContaining({ contentHash: hashOf(S1_CONTENT) }),
            }),
          }),
        }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FLAGS_ANALYZED',
        metadata: expect.objectContaining({ sectionsAnalyzed: 1, sectionsSkipped: 0 }),
      }),
    );
  });

  it('re-analyze, content byte-identical → skips the LLM, preserves flags, no write', async () => {
    noteFindFirst.mockResolvedValueOnce(
      makeNote({
        inferenceLog: {
          _flagAnalysis: {
            s1: { contentHash: hashOf(S1_CONTENT), analyzedAt: '2026-05-01T00:00:00.000Z' },
          },
        },
      }),
    );

    const result = await run();

    expect(analyzeSection).not.toHaveBeenCalled();
    expect(txn).not.toHaveBeenCalled();
    expect(reviewFlagDeleteMany).not.toHaveBeenCalled();
    // sectionsAnalyzed === 0 → recordFlagAnalyses never runs → no note.update.
    expect(noteUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      sectionsAnalyzed: 0,
      sectionsSkipped: 1,
      flagsCreated: 0,
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FLAGS_ANALYZED',
        metadata: expect.objectContaining({ sectionsAnalyzed: 0, sectionsSkipped: 1 }),
      }),
    );
  });

  it('re-analyze, content edited → fingerprint mismatch re-runs the LLM and re-stamps', async () => {
    noteFindFirst.mockResolvedValueOnce(
      makeNote({
        inferenceLog: {
          _flagAnalysis: {
            s1: { contentHash: 'stale-hash-from-old-text', analyzedAt: '2026-05-01T00:00:00.000Z' },
          },
        },
      }),
    );
    analyzeSection.mockResolvedValueOnce({ flags: [] });
    noteFindUnique.mockResolvedValueOnce({
      inferenceLog: {
        _flagAnalysis: {
          s1: { contentHash: 'stale-hash-from-old-text', analyzedAt: '2026-05-01T00:00:00.000Z' },
        },
      },
    });

    const result = await run();

    expect(analyzeSection).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      sectionsAnalyzed: 1,
      sectionsSkipped: 0,
      flagsCreated: 0,
    });
    expect(noteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inferenceLog: expect.objectContaining({
            _flagAnalysis: expect.objectContaining({
              s1: expect.objectContaining({ contentHash: hashOf(S1_CONTENT) }),
            }),
          }),
        }),
      }),
    );
  });

  it('mixed run: unchanged section skipped, edited section analyzed, fingerprints merged', async () => {
    noteFindFirst.mockResolvedValueOnce(
      makeNote({
        draftJson: { s1: { content: S1_CONTENT }, s2: { content: S2_CONTENT } },
        inferenceLog: {
          _flagAnalysis: {
            s1: { contentHash: hashOf(S1_CONTENT), analyzedAt: '2026-05-01T00:00:00.000Z' },
            s2: { contentHash: 'stale-hash-for-s2', analyzedAt: '2026-05-01T00:00:00.000Z' },
          },
        },
      }),
    );
    analyzeSection.mockResolvedValueOnce({
      flags: [{ severity: 'YELLOW', claim: 'thin plan', rationale: 'no follow-up interval' }],
    });
    noteFindUnique.mockResolvedValueOnce({
      inferenceLog: {
        _flagAnalysis: {
          s1: { contentHash: hashOf(S1_CONTENT), analyzedAt: '2026-05-01T00:00:00.000Z' },
          s2: { contentHash: 'stale-hash-for-s2', analyzedAt: '2026-05-01T00:00:00.000Z' },
        },
      },
    });

    const result = await run();

    // Only the edited section reaches the LLM.
    expect(analyzeSection).toHaveBeenCalledTimes(1);
    expect(analyzeSection).toHaveBeenCalledWith(
      expect.objectContaining({ sectionContent: S2_CONTENT, sectionLabel: 'Assessment' }),
    );
    expect(result).toEqual({
      ok: true,
      sectionsAnalyzed: 1,
      sectionsSkipped: 1,
      flagsCreated: 1,
    });
    // s1's fingerprint is preserved; s2's is refreshed to the current text.
    expect(noteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inferenceLog: expect.objectContaining({
            _flagAnalysis: expect.objectContaining({
              s1: expect.objectContaining({ contentHash: hashOf(S1_CONTENT) }),
              s2: expect.objectContaining({ contentHash: hashOf(S2_CONTENT) }),
            }),
          }),
        }),
      }),
    );
  });

  it('LLM failure does NOT stamp a fingerprint — the section stays retry-able', async () => {
    noteFindFirst.mockResolvedValueOnce(
      makeNote({
        inferenceLog: {
          _flagAnalysis: {
            s1: { contentHash: 'stale-hash', analyzedAt: '2026-05-01T00:00:00.000Z' },
          },
        },
      }),
    );
    analyzeSection.mockRejectedValueOnce(new Error('bedrock 500'));

    const result = await run();

    expect(result).toEqual({
      ok: true,
      sectionsAnalyzed: 0,
      sectionsSkipped: 0,
      flagsCreated: 0,
    });
    // No successful analysis → recordFlagAnalyses skipped → stale hash NOT
    // overwritten, but also not advanced: the next re-analyze still mismatches
    // (stale-hash !== hashOf(current)) and retries the section.
    expect(noteUpdate).not.toHaveBeenCalled();
  });

  it('refuses a SIGNED note (rule 3) before any analysis', async () => {
    noteFindFirst.mockResolvedValueOnce(makeNote({ status: 'SIGNED' }));

    const result = await run();

    expect(result).toEqual({ skipped: 'signed' });
    expect(analyzeSection).not.toHaveBeenCalled();
    expect(noteUpdate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
