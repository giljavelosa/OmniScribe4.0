import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * analyze-flags worker — sign-race protection (Unit 14 regression).
 *
 * Reported 2026-05-25: a clinician kicked off flag analysis, navigated
 * to /sign almost immediately, and signed before the worker finished.
 * Flags then surfaced on the now-SIGNED note (rule 3 violation:
 * `finalJson` is immutable; signed-note compliance posture must be
 * whatever was decided AT sign time).
 *
 * The route-side gate (sign-route-flag-analysis.test.ts) is the primary
 * defense — it now refuses 409 `flag_analysis_pending` while the
 * analyzer is in flight. This worker test pins down the defense in
 * depth: even if a sign somehow lands during a long analysis run, the
 * worker MUST NOT write flags onto a SIGNED note. The status check is
 * inside the per-section write tx so the read+write is atomic.
 *
 * Lifecycle invariant: `flagAnalysisCompletedAt` is stamped in a
 * finally block — the gate self-clears regardless of skip / mid-run /
 * error / success. Without that, a sign would stay blocked forever
 * after a worker crash.
 */

const noteFindFirst = vi.fn();
const noteFindUnique = vi.fn();
const noteUpdate = vi.fn();
const reviewFlagDeleteMany = vi.fn();
const reviewFlagCreate = vi.fn();
const writeAuditLog = vi.fn();
const analyzeSection = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: {
      findFirst: (...a: unknown[]) => noteFindFirst(...a),
      findUnique: (...a: unknown[]) => noteFindUnique(...a),
      update: (...a: unknown[]) => noteUpdate(...a),
    },
    reviewFlag: {
      deleteMany: (...a: unknown[]) => reviewFlagDeleteMany(...a),
      create: (...a: unknown[]) => reviewFlagCreate(...a),
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        note: {
          findUnique: (...a: unknown[]) => noteFindUnique(...a),
        },
        reviewFlag: {
          deleteMany: (...a: unknown[]) => reviewFlagDeleteMany(...a),
          create: (...a: unknown[]) => reviewFlagCreate(...a),
        },
      }),
  },
}));

vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

vi.mock('@/services/review/FlagAnalyzer', () => ({
  FlagAnalyzer: class {
    async analyzeSection(...a: unknown[]) {
      return analyzeSection(...a);
    }
  },
}));

vi.mock('@/lib/notes/projections', () => ({
  projectPatientForPrompt: (p: unknown) => p,
}));

import { handleAnalyzeFlags } from '@/workers/ai-generation/analyze-flags-handler';

const SECTIONS = [
  { id: 's1', label: 'Section 1' },
  { id: 's2', label: 'Section 2' },
];

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      noteId: 'note_1',
      orgId: 'org_1',
      type: 'analyze-flags',
      requestId: 'req_xyz',
      ...overrides,
    },
    attemptsMade: 0,
  } as never;
}

function noteRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note_1',
    orgId: 'org_1',
    division: 'MEDICAL',
    status: 'DRAFT',
    template: { sectionSchema: { sections: SECTIONS } },
    patient: { id: 'pat_1' },
    draftJson: {
      s1: { content: 'Patient reports cough x 3 days.' },
      s2: { content: 'Plan: rest, fluids.' },
    },
    transcriptClean: null,
    ...overrides,
  };
}

beforeEach(() => {
  noteFindFirst.mockReset();
  noteFindUnique.mockReset();
  noteUpdate.mockReset();
  reviewFlagDeleteMany.mockReset();
  reviewFlagCreate.mockReset();
  writeAuditLog.mockReset();
  analyzeSection.mockReset();

  reviewFlagDeleteMany.mockResolvedValue({ count: 0 });
  reviewFlagCreate.mockImplementation(async () => ({ id: `flag_${Math.random()}` }));
  noteUpdate.mockResolvedValue({});
});

describe('handleAnalyzeFlags — sign-race protection', () => {
  it('aborts mid-run when the note becomes SIGNED between sections', async () => {
    noteFindFirst.mockResolvedValueOnce(noteRecord());
    // First section's tx sees DRAFT (writes proceed); second section's
    // tx sees SIGNED (must abort + roll back, NOT write to a signed note).
    noteFindUnique
      .mockResolvedValueOnce({ status: 'DRAFT' })
      .mockResolvedValueOnce({ status: 'SIGNED' });
    analyzeSection
      .mockResolvedValueOnce({
        flags: [
          {
            severity: 'BLUE',
            claim: 'c',
            rationale: 'r',
            confidence: 0.9,
          },
        ],
      })
      .mockResolvedValueOnce({
        flags: [
          {
            severity: 'RED',
            claim: 'must-not-write',
            rationale: 'late arrival',
            confidence: 0.9,
          },
        ],
      });

    const result = await handleAnalyzeFlags(makeJob());

    expect(result).toMatchObject({ ok: true, abortedBySign: true });
    // First section: deleteMany + create both ran (DRAFT at write-time).
    expect(reviewFlagDeleteMany).toHaveBeenCalledTimes(1);
    expect(reviewFlagDeleteMany).toHaveBeenCalledWith({
      where: { noteId: 'note_1', sectionId: 's1', status: 'OPEN' },
    });
    expect(reviewFlagCreate).toHaveBeenCalledTimes(1);
    // Second section's create must NOT have happened.
    const createdSectionIds = reviewFlagCreate.mock.calls.map(
      (call) => (call[0] as { data: { sectionId: string } }).data.sectionId,
    );
    expect(createdSectionIds).not.toContain('s2');
    // Audit row reflects the abort.
    const flagsAnalyzedCall = writeAuditLog.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'FLAGS_ANALYZED',
    );
    expect(flagsAnalyzedCall).toBeDefined();
    expect(
      (flagsAnalyzedCall![0] as { metadata: Record<string, unknown> }).metadata
        .abortedBySign,
    ).toBe(true);
  });

  it('skips the run entirely if the note is already SIGNED at outer guard', async () => {
    noteFindFirst.mockResolvedValueOnce(noteRecord({ status: 'SIGNED' }));

    const result = await handleAnalyzeFlags(makeJob());
    expect(result).toMatchObject({ skipped: 'signed' });
    expect(analyzeSection).not.toHaveBeenCalled();
    expect(reviewFlagCreate).not.toHaveBeenCalled();
  });

  it('writes flags normally when no sign occurs during the run', async () => {
    noteFindFirst.mockResolvedValueOnce(noteRecord());
    noteFindUnique
      .mockResolvedValueOnce({ status: 'DRAFT' })
      .mockResolvedValueOnce({ status: 'DRAFT' });
    analyzeSection
      .mockResolvedValueOnce({
        flags: [
          { severity: 'BLUE', claim: 'c1', rationale: 'r1', confidence: 0.8 },
        ],
      })
      .mockResolvedValueOnce({
        flags: [
          { severity: 'YELLOW', claim: 'c2', rationale: 'r2', confidence: 0.7 },
        ],
      });

    const result = await handleAnalyzeFlags(makeJob());
    expect(result).toMatchObject({
      ok: true,
      sectionsAnalyzed: 2,
      flagsCreated: 2,
      abortedBySign: false,
    });
    expect(reviewFlagCreate).toHaveBeenCalledTimes(2);
  });
});

describe('handleAnalyzeFlags — lifecycle (flagAnalysisCompletedAt)', () => {
  it('stamps flagAnalysisCompletedAt on the happy path', async () => {
    noteFindFirst.mockResolvedValueOnce(noteRecord());
    noteFindUnique.mockResolvedValue({ status: 'DRAFT' });
    analyzeSection.mockResolvedValue({ flags: [] });

    await handleAnalyzeFlags(makeJob());

    const updateCall = noteUpdate.mock.calls.find((c) => {
      const arg = c[0] as { data?: { flagAnalysisCompletedAt?: Date } };
      return arg.data?.flagAnalysisCompletedAt instanceof Date;
    });
    expect(updateCall).toBeDefined();
  });

  it('stamps flagAnalysisCompletedAt even when the note is already SIGNED', async () => {
    // The outer guard returns early, but the finally MUST still clear
    // the gate — otherwise a re-analyze couldn't unblock sign once a
    // legacy "started but never finished" row hangs around.
    noteFindFirst.mockResolvedValueOnce(noteRecord({ status: 'SIGNED' }));

    await handleAnalyzeFlags(makeJob());

    expect(noteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'note_1' },
        data: expect.objectContaining({
          flagAnalysisCompletedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('stamps flagAnalysisCompletedAt even when the analyzer throws', async () => {
    // Worker errors propagate to BullMQ for retry, but the finally
    // still runs first so the gate clears.
    noteFindFirst.mockResolvedValueOnce(noteRecord());
    noteFindUnique.mockResolvedValue({ status: 'DRAFT' });
    analyzeSection.mockRejectedValue(new Error('LLM failed'));

    // analyzer errors are caught per-section in the handler; the
    // handler completes "successfully" with 0 flags created. The
    // finally still stamps completedAt — verify that.
    await handleAnalyzeFlags(makeJob());
    expect(noteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          flagAnalysisCompletedAt: expect.any(Date),
        }),
      }),
    );
  });
});
