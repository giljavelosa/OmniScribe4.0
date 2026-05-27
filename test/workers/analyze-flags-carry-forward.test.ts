import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

/**
 * Sprint 0 flag-analysis lockdown — analyzer worker:
 *
 *   1. Decision-memory carry-forward.
 *   2. Per-section diff-skip on CLINICIAN_RE_ANALYZE.
 *   3. flagAnalysisRunCount bump in the finally block.
 *
 * Spec: context/specs/sprint-0-flag-analysis-lockdown.md (decisions L-5, L-6).
 *
 * Companion to test/workers/analyze-flags-handler.test.ts which covers
 * sign-race + lifecycle invariants on the same worker. Kept separate so
 * the Sprint 0 behavior is greppable as a unit.
 */

const noteFindFirst = vi.fn();
const noteFindUnique = vi.fn();
const noteUpdate = vi.fn();
const reviewFlagDeleteMany = vi.fn();
const reviewFlagCreate = vi.fn();
const reviewFlagFindFirst = vi.fn();
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
      findFirst: (...a: unknown[]) => reviewFlagFindFirst(...a),
    },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        note: {
          findUnique: (...a: unknown[]) => noteFindUnique(...a),
        },
        reviewFlag: {
          deleteMany: (...a: unknown[]) => reviewFlagDeleteMany(...a),
          create: (...a: unknown[]) => reviewFlagCreate(...a),
          findFirst: (...a: unknown[]) => reviewFlagFindFirst(...a),
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

const S1_CONTENT = 'Patient reports cough x 3 days.';
const S2_CONTENT = 'Plan: rest, fluids, follow-up in 1 week.';

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

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
      s1: { content: S1_CONTENT },
      s2: { content: S2_CONTENT },
    },
    transcriptClean: null,
    flagAnalysisRunCount: 1,
    flagAnalysisSectionHashes: null,
    ...overrides,
  };
}

beforeEach(() => {
  noteFindFirst.mockReset();
  noteFindUnique.mockReset();
  noteUpdate.mockReset();
  reviewFlagDeleteMany.mockReset();
  reviewFlagCreate.mockReset();
  reviewFlagFindFirst.mockReset();
  writeAuditLog.mockReset();
  analyzeSection.mockReset();

  noteUpdate.mockResolvedValue({});
  noteFindUnique.mockResolvedValue({ status: 'DRAFT' });
  reviewFlagDeleteMany.mockResolvedValue({ count: 0 });
  reviewFlagFindFirst.mockResolvedValue(null);
  reviewFlagCreate.mockImplementation(async () => ({ id: `flag_${Math.random()}` }));
  writeAuditLog.mockResolvedValue(undefined);
});

describe('handleAnalyzeFlags — decision-memory carry-forward', () => {
  it('creates the new flag in CARRIED_FORWARD state when a prior RESOLVED row with the same signature exists', async () => {
    noteFindFirst.mockResolvedValueOnce(noteRecord());
    // s1 analyzer returns a RED flag; s2 returns nothing.
    analyzeSection
      .mockResolvedValueOnce({
        flags: [
          {
            severity: 'RED',
            claim: 'Patient denies neuro symptoms.',
            rationale: 'transcript contradicts',
            confidence: 0.9,
          },
        ],
      })
      .mockResolvedValueOnce({ flags: [] });

    // The carry-forward lookup finds a matching RESOLVED row.
    reviewFlagFindFirst.mockResolvedValueOnce({
      id: 'flag_prior_resolved',
      status: 'RESOLVED',
      resolutionAction: 'ACCEPT_EDIT',
      resolutionNote: 'Edited per transcript.',
      resolvedByOrgUserId: 'ou_prior',
      resolvedAt: new Date('2026-05-25T12:00:00Z'),
    });

    const result = await handleAnalyzeFlags(makeJob());

    expect(result).toMatchObject({
      ok: true,
      sectionsAnalyzed: 2,
      flagsCreated: 1,
      carriedForwardCount: 1,
    });
    // The new flag was written with the prior's status + CARRIED_FORWARD action.
    expect(reviewFlagCreate).toHaveBeenCalledTimes(1);
    const createArg = reviewFlagCreate.mock.calls[0]![0] as {
      data: {
        status: string;
        resolutionAction: string;
        resolvedByOrgUserId: string | null;
      };
    };
    expect(createArg.data.status).toBe('RESOLVED');
    expect(createArg.data.resolutionAction).toBe('CARRIED_FORWARD');
    expect(createArg.data.resolvedByOrgUserId).toBe('ou_prior');

    // Carry-forward audit row was written.
    const cf = writeAuditLog.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'FLAGS_CARRIED_FORWARD',
    );
    expect(cf).toBeDefined();
  });

  it('creates a fresh OPEN flag when no prior signature matches', async () => {
    noteFindFirst.mockResolvedValueOnce(noteRecord());
    analyzeSection
      .mockResolvedValueOnce({
        flags: [
          {
            severity: 'RED',
            claim: 'New finding nobody saw before.',
            rationale: 'r',
            confidence: 0.9,
          },
        ],
      })
      .mockResolvedValueOnce({ flags: [] });
    reviewFlagFindFirst.mockResolvedValue(null); // no prior decision

    const result = await handleAnalyzeFlags(makeJob());
    expect(result).toMatchObject({ ok: true, carriedForwardCount: 0, flagsCreated: 1 });

    const createArg = reviewFlagCreate.mock.calls[0]![0] as {
      data: { status: string; resolutionAction: string | null };
    };
    expect(createArg.data.status).toBe('OPEN');
    expect(createArg.data.resolutionAction).toBeNull();
  });

  it('does NOT carry-forward GREEN flags (they always auto-resolve fresh)', async () => {
    noteFindFirst.mockResolvedValueOnce(noteRecord());
    analyzeSection
      .mockResolvedValueOnce({
        flags: [{ severity: 'GREEN', claim: 'c', rationale: 'r', confidence: 0.9 }],
      })
      .mockResolvedValueOnce({ flags: [] });

    await handleAnalyzeFlags(makeJob());

    // The lookup is NEVER called for GREEN (the worker short-circuits).
    expect(reviewFlagFindFirst).not.toHaveBeenCalled();
    const createArg = reviewFlagCreate.mock.calls[0]![0] as {
      data: { status: string; resolutionAction: string };
    };
    expect(createArg.data.status).toBe('RESOLVED');
    expect(createArg.data.resolutionAction).toBe('AUTO_VERIFIED');
  });
});

describe('handleAnalyzeFlags — per-section diff-skip', () => {
  it('skips the LLM call for unchanged sections on CLINICIAN_RE_ANALYZE', async () => {
    // Prior snapshot matches s1 content exactly; s2 differs from snapshot.
    noteFindFirst.mockResolvedValueOnce(
      noteRecord({
        flagAnalysisSectionHashes: {
          s1: hash(S1_CONTENT),
          s2: hash('stale content from prior run'),
        },
      }),
    );
    analyzeSection.mockResolvedValue({ flags: [] });

    const result = await handleAnalyzeFlags(makeJob());

    expect(result).toMatchObject({
      ok: true,
      sectionsAnalyzed: 1, // only s2
      sectionsSkippedUnchanged: 1, // s1
    });
    expect(analyzeSection).toHaveBeenCalledTimes(1);

    // Skipped section gets its own audit row.
    const skipRow = writeAuditLog.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'FLAGS_SECTION_SKIPPED_UNCHANGED',
    );
    expect(skipRow).toBeDefined();
    expect((skipRow![0] as { metadata: Record<string, unknown> }).metadata.sectionId).toBe('s1');
  });

  it('stamps a fresh section-hash snapshot at the end of the run', async () => {
    noteFindFirst.mockResolvedValueOnce(noteRecord());
    analyzeSection.mockResolvedValue({ flags: [] });

    await handleAnalyzeFlags(makeJob());

    const stampCall = noteUpdate.mock.calls.find((c) => {
      const arg = c[0] as { data?: { flagAnalysisSectionHashes?: unknown } };
      return arg.data?.flagAnalysisSectionHashes !== undefined;
    });
    expect(stampCall).toBeDefined();
    const snapshot = (stampCall![0] as { data: { flagAnalysisSectionHashes: Record<string, string> } })
      .data.flagAnalysisSectionHashes;
    expect(snapshot.s1).toBe(hash(S1_CONTENT));
    expect(snapshot.s2).toBe(hash(S2_CONTENT));
  });
});

describe('handleAnalyzeFlags — runCount + cap', () => {
  it('bumps flagAnalysisRunCount by 1 in the finally on a normal run', async () => {
    noteFindFirst.mockResolvedValueOnce(noteRecord({ flagAnalysisRunCount: 1 }));
    analyzeSection.mockResolvedValue({ flags: [] });

    await handleAnalyzeFlags(makeJob());

    const bumpCall = noteUpdate.mock.calls.find((c) => {
      const arg = c[0] as { data?: { flagAnalysisRunCount?: unknown } };
      return arg.data?.flagAnalysisRunCount !== undefined;
    });
    expect(bumpCall).toBeDefined();
    expect(
      (bumpCall![0] as { data: { flagAnalysisRunCount: { increment: number } } })
        .data.flagAnalysisRunCount.increment,
    ).toBe(1);
  });

  it('refuses (skipped: cap_reached) and does NOT bump runCount when already at cap', async () => {
    noteFindFirst.mockResolvedValueOnce(noteRecord({ flagAnalysisRunCount: 2 }));

    const result = await handleAnalyzeFlags(makeJob());
    expect(result).toEqual({ skipped: 'cap_reached', runCount: 2 });

    // No LLM call, no flag mutations.
    expect(analyzeSection).not.toHaveBeenCalled();
    expect(reviewFlagCreate).not.toHaveBeenCalled();

    // Finally still stamps completedAt (lifecycle invariant) but does
    // NOT bump runCount past the cap.
    const finalyCall = noteUpdate.mock.calls.find((c) => {
      const arg = c[0] as { data?: { flagAnalysisCompletedAt?: Date; flagAnalysisRunCount?: unknown } };
      return arg.data?.flagAnalysisCompletedAt instanceof Date;
    });
    expect(finalyCall).toBeDefined();
    const data = (finalyCall![0] as { data: { flagAnalysisRunCount?: unknown } }).data;
    expect(data.flagAnalysisRunCount).toBeUndefined();
  });
});
