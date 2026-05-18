import type {
  RealtimePostedTranscript,
  SonioxBatchTranscript,
  PastedTranscript,
  TranscriptClean,
  TranscriptSegmentClean,
  SpeakerRole,
} from './types';

/**
 * Transcript cleaner (spec §D). Pure + deterministic so it can be tested
 * without a Redis or Soniox.
 *
 * Responsibilities:
 *   1. Dedupe — drop is_final: false partials (final tokens replace them).
 *   2. Coalesce same-speaker runs into single segments + normalize whitespace.
 *   3. Map Soniox integer speakers → role enum (speaker 1 = CLINICIAN by
 *      default; speaker 2 = PATIENT; any other speaker = OTHER). Voice-id
 *      worker (skeleton) refines this later.
 *   4. Compute plaintext + word count + speaker count + duration.
 *
 * Defers (later units):
 *   - Vocabulary swaps from Note.template.vocabulary  — Unit 13 (templates editor)
 *   - PHI redaction passes                            — out of scope
 */

const ROLE_FOR_SPEAKER: Record<number, SpeakerRole> = {
  1: 'CLINICIAN',
  2: 'PATIENT',
};

function roleFor(speaker: number | null | undefined): SpeakerRole {
  if (speaker == null) return 'OTHER';
  return ROLE_FOR_SPEAKER[speaker] ?? 'OTHER';
}

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function countWords(s: string): number {
  if (!s) return 0;
  return s.split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Realtime path — cleans the segments the browser posted to /complete-stream
// ---------------------------------------------------------------------------
export function cleanRealtimeTranscript(input: RealtimePostedTranscript): TranscriptClean {
  // Drop partials; only finals make it into the cleaned output.
  const finals = (input.segments ?? []).filter((s) => s.isFinal);
  const structured = coalesceSegments(
    finals.map((s) => ({
      text: s.text,
      originalSpeaker: s.speaker,
      role: roleFor(s.speaker),
    })),
  );
  return summarize(structured, 'realtime');
}

// ---------------------------------------------------------------------------
// Batch path — cleans a Soniox async-transcribe payload
// ---------------------------------------------------------------------------
export function cleanBatchTranscript(input: SonioxBatchTranscript): TranscriptClean {
  const finals = (input.tokens ?? []).filter((t) => t.is_final !== false);
  const items = finals.map((t) => ({
    text: t.text,
    originalSpeaker: t.speaker ?? null,
    role: roleFor(t.speaker ?? null),
    startMs: t.start_ms,
    endMs: t.end_ms,
  }));
  const structured = coalesceSegments(items);
  const clean = summarize(structured, 'batch');
  if (typeof input.duration_ms === 'number') clean.durationMs = input.duration_ms;
  return clean;
}

// ---------------------------------------------------------------------------
// Pasted path — treats the whole pasted text as one speaker (no diarization).
// ---------------------------------------------------------------------------
export function cleanPastedTranscript(input: PastedTranscript): TranscriptClean {
  const text = normalizeWs(input.text);
  const segment: TranscriptSegmentClean = {
    text,
    speaker: 'OTHER',
    originalSpeaker: null,
  };
  return {
    plaintext: text,
    structured: text ? [segment] : [],
    durationMs: 0,
    wordCount: countWords(text),
    speakerCount: text ? 1 : 0,
    source: 'pasted',
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------
type RawSegment = {
  text: string;
  role: SpeakerRole;
  originalSpeaker: number | null;
  startMs?: number;
  endMs?: number;
};

function coalesceSegments(items: RawSegment[]): TranscriptSegmentClean[] {
  const out: TranscriptSegmentClean[] = [];
  for (const item of items) {
    const text = normalizeWs(item.text);
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.speaker === item.role && last.originalSpeaker === item.originalSpeaker) {
      // Same speaker run — append. Keep the original startMs, extend endMs if available.
      last.text = `${last.text} ${text}`.trim();
      if (item.endMs != null) last.endMs = item.endMs;
    } else {
      out.push({
        text,
        speaker: item.role,
        originalSpeaker: item.originalSpeaker,
        startMs: item.startMs,
        endMs: item.endMs,
      });
    }
  }
  return out;
}

function summarize(structured: TranscriptSegmentClean[], source: 'realtime' | 'batch'): TranscriptClean {
  const plaintext = structured
    .map((s) => `${s.speaker}: ${s.text}`)
    .join('\n');
  const wordCount = structured.reduce((acc, s) => acc + countWords(s.text), 0);
  const speakerCount = new Set(structured.map((s) => s.speaker)).size;
  const durationMs = structured.reduce((max, s) => Math.max(max, s.endMs ?? 0), 0);
  return { plaintext, structured, wordCount, speakerCount, durationMs, source };
}
