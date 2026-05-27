import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * ai-generation worker — empty-transcript short-circuit lifecycle.
 *
 * Background
 * ----------
 * Reported 2026-05-25: a clinician hit "Finish" on a 4-second recording
 * with no speech. The worker's existing rule-1 attestation guard
 * correctly refused to fabricate clinical content from zero source
 * material and wrote placeholder text into every section. But because
 * the empty-transcript path looked indistinguishable from a normal
 * draft on /review, the clinician thought the recording itself was
 * broken.
 *
 * The fix stamps `inferenceLog._meta.emptyTranscript = true` (with
 * duration + byte-size for the banner copy) so /review can render
 * <EmptyTranscriptBanner> and offer the natural recoveries (re-record
 * / paste transcript / write manually).
 *
 * This test pins the worker contract:
 *   - placeholder text still written into every section (rule 1)
 *   - inferenceLog._meta written with the marker
 *   - NOTE_GENERATION_COMPLETED audit row carries the new
 *     emptyTranscript* dimensions for the auditor lens
 */

const noteFindFirst = vi.fn();
const noteUpdate = vi.fn();
const audioSegmentFindMany = vi.fn();
const writeAuditLog = vi.fn();
const enqueueCaseRouterJob = vi.fn();
const enqueueCleoStateRefresh = vi.fn();
const mergeSectionIntoDraft = vi.fn();
const markSectionStatus = vi.fn();
const markNoteEmptyTranscript = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: {
      findFirst: (...a: unknown[]) => noteFindFirst(...a),
      update: (...a: unknown[]) => noteUpdate(...a),
    },
    audioSegment: {
      findMany: (...a: unknown[]) => audioSegmentFindMany(...a),
    },
    noteTemplate: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

vi.mock('@/lib/queue', () => ({
  enqueueCaseRouterJob: (...a: unknown[]) => enqueueCaseRouterJob(...a),
  enqueueCleoStateRefresh: (...a: unknown[]) => enqueueCleoStateRefresh(...a),
}));

vi.mock('@/services/llm', () => ({
  getLLMService: () => ({ generate: vi.fn() }),
}));

vi.mock('@/lib/notes/section-status', () => ({
  markSectionStatus: (...a: unknown[]) => markSectionStatus(...a),
  appendRegeneration: vi.fn(),
  mergeSectionIntoDraft: (...a: unknown[]) => mergeSectionIntoDraft(...a),
  recordSectionAttempt: vi.fn(),
  readInferenceLog: () => ({}),
}));

vi.mock('@/lib/notes/empty-transcript', () => ({
  markNoteEmptyTranscript: (...a: unknown[]) => markNoteEmptyTranscript(...a),
}));

vi.mock('@/lib/notes/build-prompt', () => ({
  buildMasterPrompt: () => 'master',
  buildSectionPrompt: () => 'section',
}));

vi.mock('@/lib/notes/projections', () => ({
  projectPatientForPrompt: (p: unknown) => p,
  projectEpisodeForPrompt: (e: unknown) => e,
}));

vi.mock('@/services/copilot/persona', () => ({
  PERSONA_VERSION: 'test-persona',
}));

import { handle } from '@/workers/ai-generation/handler';

const TEMPLATE_SECTIONS = [
  { id: 'subjective', label: 'Subjective', required: true },
  { id: 'plan', label: 'Plan', required: true },
];

function makeJob() {
  return {
    data: {
      noteId: 'note_empty',
      orgId: 'org_1',
      type: 'generate-note',
      requestId: 'req_xyz',
    },
    attemptsMade: 0,
  } as never;
}

function noteRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note_empty',
    orgId: 'org_1',
    division: 'REHAB',
    status: 'DRAFTING',
    noteStyle: 'HYBRID',
    patientId: 'pat_1',
    clinicianOrgUserId: 'ou_1',
    template: {
      id: 'tpl_1',
      name: 'PT Progress',
      version: 1,
      division: 'REHAB',
      sectionSchema: { sections: TEMPLATE_SECTIONS },
      promptHints: null,
    },
    patient: { id: 'pat_1', firstName: 'A', lastName: 'B' },
    encounter: { episode: null },
    transcriptClean: { wordCount: 0, plaintext: '', durationMs: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  noteFindFirst.mockReset();
  noteUpdate.mockReset();
  audioSegmentFindMany.mockReset();
  writeAuditLog.mockReset();
  enqueueCaseRouterJob.mockReset();
  enqueueCleoStateRefresh.mockReset();
  mergeSectionIntoDraft.mockReset();
  markSectionStatus.mockReset();
  markNoteEmptyTranscript.mockReset();

  noteUpdate.mockResolvedValue({});
  audioSegmentFindMany.mockResolvedValue([]);
  enqueueCaseRouterJob.mockResolvedValue(undefined);
  enqueueCleoStateRefresh.mockResolvedValue(undefined);
});

describe('ai-generation worker — empty-transcript short-circuit', () => {
  it('writes placeholder text into every template section (rule 1 guard)', async () => {
    noteFindFirst.mockResolvedValueOnce(noteRecord());

    await handle(makeJob());

    expect(mergeSectionIntoDraft).toHaveBeenCalledTimes(TEMPLATE_SECTIONS.length);
    const sectionIds = mergeSectionIntoDraft.mock.calls.map((c) => c[1]);
    expect(sectionIds.sort()).toEqual(['plan', 'subjective']);
    // Placeholder content is identical and points the user at the recovery
    // (re-record / paste transcript / regenerate).
    for (const call of mergeSectionIntoDraft.mock.calls) {
      expect(call[2]).toMatch(/no transcript captured/i);
      expect(call[2]).toMatch(/re-record or paste a transcript/i);
    }
  });

  it('stamps inferenceLog._meta via markNoteEmptyTranscript with audio dims', async () => {
    noteFindFirst.mockResolvedValueOnce(noteRecord());
    audioSegmentFindMany.mockResolvedValueOnce([
      { durationMs: 4000, byteSize: 130000 },
      { durationMs: 312, byteSize: 8028 },
    ]);

    await handle(makeJob());

    expect(markNoteEmptyTranscript).toHaveBeenCalledTimes(1);
    expect(markNoteEmptyTranscript).toHaveBeenCalledWith('note_empty', {
      durationMs: 4312,
      byteSize: 138028,
    });
  });

  it('passes 0/0 when the dev transcript-only path has no AudioSegment rows', async () => {
    noteFindFirst.mockResolvedValueOnce(noteRecord());
    audioSegmentFindMany.mockResolvedValueOnce([]);

    await handle(makeJob());

    expect(markNoteEmptyTranscript).toHaveBeenCalledWith('note_empty', {
      durationMs: 0,
      byteSize: 0,
    });
  });

  it('NOTE_GENERATION_COMPLETED audit carries skipped + empty dimensions', async () => {
    noteFindFirst.mockResolvedValueOnce(noteRecord());
    audioSegmentFindMany.mockResolvedValueOnce([
      { durationMs: 4312, byteSize: 138028 },
    ]);

    await handle(makeJob());

    const completed = writeAuditLog.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'NOTE_GENERATION_COMPLETED',
    );
    expect(completed).toBeDefined();
    const meta = (completed![0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta.skipped).toBe('no_transcript');
    expect(meta.emptyTranscriptDurationMs).toBe(4312);
    expect(meta.emptyTranscriptByteSize).toBe(138028);
    expect(meta.failedCount).toBe(0);
  });

  it('flips the note to DRAFT after the empty-transcript short-circuit', async () => {
    noteFindFirst.mockResolvedValueOnce(noteRecord());

    await handle(makeJob());

    const draftFlip = noteUpdate.mock.calls.find((c) => {
      const arg = c[0] as { data?: { status?: string } };
      return arg.data?.status === 'DRAFT';
    });
    expect(draftFlip).toBeDefined();
  });

  it('does NOT short-circuit when the transcript has words', async () => {
    // Sanity check: confirm the helper isn't called on a real transcript
    // (otherwise normal recordings would also be flagged).
    noteFindFirst.mockResolvedValueOnce(
      noteRecord({
        transcriptClean: { wordCount: 42, plaintext: 'hello', durationMs: 30000 },
      }),
    );

    // The full happy path requires the LLM mock; we just want to assert
    // the empty-transcript branch is skipped. Force the LLM mock to throw
    // so the test exits early without exercising the success loop, but
    // crucially AFTER the empty-transcript gate.
    try {
      await handle(makeJob());
    } catch {
      // Expected: LLM mock isn't wired for the success path.
    }

    expect(markNoteEmptyTranscript).not.toHaveBeenCalled();
    expect(mergeSectionIntoDraft).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringMatching(/no transcript captured/i),
    );
  });
});
