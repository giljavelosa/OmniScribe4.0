import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TranscriptClean } from '@/services/transcription';

/**
 * Empty-transcript helper tests.
 *
 * Background
 * ----------
 * Reported 2026-05-25: a clinician hit "Finish" on a 4-second recording
 * with no speech. The pipeline accepted the audio, transcription returned
 * 0 words, the AI worker short-circuited to placeholder text, and the
 * clinician landed on /review staring at six identical paragraphs that
 * looked like a system bug.
 *
 * The helper module centralizes:
 *   - the "is this transcript usable?" predicate (so worker, complete-
 *     stream, and any future surface agree on the threshold)
 *   - the readonly meta accessor for /review's <EmptyTranscriptBanner>
 *   - the writer the worker calls in the no-transcript short-circuit
 */

const noteFindUnique = vi.fn();
const noteUpdate = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: {
      findUnique: (...a: unknown[]) => noteFindUnique(...a),
      update: (...a: unknown[]) => noteUpdate(...a),
    },
  },
}));

import {
  isEmptyTranscript,
  readEmptyTranscriptMeta,
  markNoteEmptyTranscript,
  inferEmptyTranscriptFromDraft,
  detectEmptyTranscript,
  EMPTY_TRANSCRIPT_PLACEHOLDER_PREFIX,
} from '@/lib/notes/empty-transcript';

beforeEach(() => {
  noteFindUnique.mockReset();
  noteUpdate.mockReset();
});

describe('isEmptyTranscript', () => {
  function tc(over: Partial<TranscriptClean> = {}): TranscriptClean {
    return {
      plaintext: '',
      structured: [],
      durationMs: 0,
      wordCount: 0,
      speakerCount: 0,
      source: 'realtime',
      ...over,
    };
  }

  it('null transcript → empty', () => {
    expect(isEmptyTranscript(null)).toBe(true);
  });

  it('wordCount=0 → empty regardless of plaintext content', () => {
    // Defensive: if Soniox reports words=0 we treat as empty even when
    // some downstream cleaner sneaks plaintext into the row.
    expect(isEmptyTranscript(tc({ wordCount: 0, plaintext: 'um' }))).toBe(true);
  });

  it('wordCount=1 → not empty', () => {
    expect(isEmptyTranscript(tc({ wordCount: 1, plaintext: 'hi' }))).toBe(false);
  });

  it('high wordCount → not empty', () => {
    expect(isEmptyTranscript(tc({ wordCount: 1234 }))).toBe(false);
  });
});

describe('readEmptyTranscriptMeta', () => {
  it('returns null when inferenceLog is missing', () => {
    expect(readEmptyTranscriptMeta(null)).toBeNull();
    expect(readEmptyTranscriptMeta(undefined)).toBeNull();
  });

  it('returns null when _meta is absent', () => {
    expect(readEmptyTranscriptMeta({ _sectionStatus: {} })).toBeNull();
  });

  it('returns null when _meta exists but emptyTranscript is unset/false', () => {
    expect(readEmptyTranscriptMeta({ _meta: {} })).toBeNull();
    expect(readEmptyTranscriptMeta({ _meta: { emptyTranscript: false } })).toBeNull();
  });

  it('returns marker fields when emptyTranscript is true', () => {
    const meta = readEmptyTranscriptMeta({
      _meta: {
        emptyTranscript: true,
        emptyTranscriptDurationMs: 4312,
        emptyTranscriptByteSize: 138028,
        emptyTranscriptDetectedAt: '2026-05-25T23:19:19.055Z',
      },
    });
    expect(meta).toEqual({
      durationMs: 4312,
      byteSize: 138028,
      detectedAt: '2026-05-25T23:19:19.055Z',
    });
  });

  it('defaults missing duration/byteSize to 0 (transcript-only dev path)', () => {
    const meta = readEmptyTranscriptMeta({ _meta: { emptyTranscript: true } });
    expect(meta).toEqual({ durationMs: 0, byteSize: 0, detectedAt: null });
  });
});

describe('markNoteEmptyTranscript', () => {
  it('writes _meta.emptyTranscript=true with marker fields', async () => {
    noteFindUnique.mockResolvedValueOnce({ inferenceLog: null });
    await markNoteEmptyTranscript('note_1', { durationMs: 4312, byteSize: 138028 });
    expect(noteUpdate).toHaveBeenCalledTimes(1);
    const data = (noteUpdate.mock.calls[0]![0] as { data: { inferenceLog: any } }).data;
    expect(data.inferenceLog._meta.emptyTranscript).toBe(true);
    expect(data.inferenceLog._meta.emptyTranscriptDurationMs).toBe(4312);
    expect(data.inferenceLog._meta.emptyTranscriptByteSize).toBe(138028);
    expect(typeof data.inferenceLog._meta.emptyTranscriptDetectedAt).toBe('string');
  });

  it('preserves existing _sectionStatus when merging in _meta', async () => {
    noteFindUnique.mockResolvedValueOnce({
      inferenceLog: {
        _sectionStatus: {
          plan: { status: 'populated', lastGeneratedAt: '2026-05-25T00:00:00Z' },
        },
      },
    });
    await markNoteEmptyTranscript('note_1', { durationMs: 0, byteSize: 0 });
    const data = (noteUpdate.mock.calls[0]![0] as { data: { inferenceLog: any } }).data;
    expect(data.inferenceLog._sectionStatus.plan.status).toBe('populated');
    expect(data.inferenceLog._meta.emptyTranscript).toBe(true);
  });

  it('preserves any prior _meta keys (forward-compatibility)', async () => {
    noteFindUnique.mockResolvedValueOnce({
      inferenceLog: { _meta: { someFutureFlag: 'preserve-me' } },
    });
    await markNoteEmptyTranscript('note_1', { durationMs: 100, byteSize: 200 });
    const data = (noteUpdate.mock.calls[0]![0] as { data: { inferenceLog: any } }).data;
    expect(data.inferenceLog._meta.someFutureFlag).toBe('preserve-me');
    expect(data.inferenceLog._meta.emptyTranscript).toBe(true);
  });

  it('throws when the note does not exist', async () => {
    noteFindUnique.mockResolvedValueOnce(null);
    await expect(
      markNoteEmptyTranscript('missing', { durationMs: 0, byteSize: 0 }),
    ).rejects.toThrow(/not found/);
  });
});

describe('inferEmptyTranscriptFromDraft (legacy fallback)', () => {
  function tc(over: Partial<TranscriptClean> = {}): TranscriptClean {
    return {
      plaintext: '',
      structured: [],
      durationMs: 0,
      wordCount: 0,
      speakerCount: 0,
      source: 'realtime',
      ...over,
    };
  }
  const placeholder = `${EMPTY_TRANSCRIPT_PLACEHOLDER_PREFIX} This section cannot be drafted from source material. Re-record or paste a transcript, then regenerate this section.`;

  it('true when transcript empty AND every section is placeholder text', () => {
    expect(
      inferEmptyTranscriptFromDraft({
        transcriptClean: tc(),
        draftJson: {
          plan: { content: placeholder },
          subjective: { content: placeholder },
        },
      }),
    ).toBe(true);
  });

  it('false when transcript has words even if draft happens to mention "no transcript captured"', () => {
    // Defensive: the worker only writes the placeholder on the
    // empty-transcript path. If somehow a real transcript also
    // contains the prefix in a section, we should NOT hide a real
    // recording behind the banner.
    expect(
      inferEmptyTranscriptFromDraft({
        transcriptClean: tc({ wordCount: 5, plaintext: 'real visit' }),
        draftJson: { plan: { content: placeholder } },
      }),
    ).toBe(false);
  });

  it('false when at least one section has real (non-placeholder) content', () => {
    // Partial recovery scenario: clinician edited one section to add
    // their manual notes. We treat the draft as no-longer-empty.
    expect(
      inferEmptyTranscriptFromDraft({
        transcriptClean: tc(),
        draftJson: {
          plan: { content: placeholder },
          subjective: { content: 'Patient reports new symptoms.' },
        },
      }),
    ).toBe(false);
  });

  it('false when draftJson is null (worker never ran)', () => {
    expect(
      inferEmptyTranscriptFromDraft({
        transcriptClean: tc(),
        draftJson: null,
      }),
    ).toBe(false);
  });

  it('false when draftJson is empty object', () => {
    expect(
      inferEmptyTranscriptFromDraft({
        transcriptClean: tc(),
        draftJson: {},
      }),
    ).toBe(false);
  });
});

describe('detectEmptyTranscript (combined detector)', () => {
  function tc(over: Partial<TranscriptClean> = {}): TranscriptClean {
    return {
      plaintext: '',
      structured: [],
      durationMs: 0,
      wordCount: 0,
      speakerCount: 0,
      source: 'realtime',
      ...over,
    };
  }
  const placeholder = `${EMPTY_TRANSCRIPT_PLACEHOLDER_PREFIX} The rest of the placeholder.`;

  it('explicit _meta wins over the legacy heuristic', () => {
    const detected = detectEmptyTranscript({
      inferenceLog: {
        _meta: {
          emptyTranscript: true,
          emptyTranscriptDurationMs: 4312,
          emptyTranscriptByteSize: 138028,
          emptyTranscriptDetectedAt: '2026-05-25T23:19:19.055Z',
        },
      },
      transcriptClean: tc(),
      draftJson: { plan: { content: 'edited content' } },
    });
    expect(detected).toEqual({
      durationMs: 4312,
      byteSize: 138028,
      detectedAt: '2026-05-25T23:19:19.055Z',
    });
  });

  it('falls back to legacy heuristic when _meta is unset (pre-fix notes)', () => {
    const detected = detectEmptyTranscript({
      inferenceLog: { _sectionStatus: { plan: { status: 'populated' } } },
      transcriptClean: tc(),
      draftJson: {
        plan: { content: placeholder },
        subjective: { content: placeholder },
      },
    });
    expect(detected).toEqual({ durationMs: 0, byteSize: 0, detectedAt: null });
  });

  it('returns null when neither signal nor heuristic matches', () => {
    expect(
      detectEmptyTranscript({
        inferenceLog: {},
        transcriptClean: tc({ wordCount: 100 }),
        draftJson: { plan: { content: 'real content' } },
      }),
    ).toBeNull();
  });

  it('returns null when transcript has words even if a STALE _meta marker is set', () => {
    // Stale-marker invariant: if a prior empty-transcript run wrote
    // _meta but the note was later re-driven with a real transcript
    // (paste-transcript + regenerate), `detectEmptyTranscript` MUST
    // honor the current transcript state, not the historical marker.
    // Otherwise reset-recording would destroy a real recording.
    expect(
      detectEmptyTranscript({
        inferenceLog: {
          _meta: {
            emptyTranscript: true,
            emptyTranscriptDurationMs: 4312,
            emptyTranscriptByteSize: 138028,
          },
        },
        transcriptClean: tc({ wordCount: 42, plaintext: 'real visit' }),
        draftJson: { plan: { content: 'Patient reports new symptoms.' } },
      }),
    ).toBeNull();
  });
});
