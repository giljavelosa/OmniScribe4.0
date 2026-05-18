/**
 * Shared transcript shapes between the browser realtime path (Unit 03),
 * the cleaning pipeline (Unit 04), and the LLM prompt builders (Unit 05).
 *
 * Keep speaker labels stable — Unit 04 cleans Soniox's integer speaker IDs
 * into the role enum; Unit 05 prompts read role directly; voice-id refines
 * roles after the fact.
 */

export type SpeakerRole = 'CLINICIAN' | 'PATIENT' | 'OTHER';

export type TranscriptSegmentClean = {
  text: string;
  speaker: SpeakerRole;
  /** Original Soniox speaker integer (1, 2, 3, …) before role mapping */
  originalSpeaker: number | null;
  /** Milliseconds from start of recording; optional (batch path may omit) */
  startMs?: number;
  endMs?: number;
};

export type TranscriptClean = {
  plaintext: string;
  structured: TranscriptSegmentClean[];
  durationMs: number;
  wordCount: number;
  speakerCount: number;
  source: 'realtime' | 'batch' | 'pasted';
};

/** Shape Unit 03's CaptureStateProvider posts to /complete-stream. */
export type RealtimePostedTranscript = {
  segments: Array<{
    id: string;
    text: string;
    speaker: number | null;
    isFinal: boolean;
  }>;
  partial?: string;
};

/** Shape Unit 03's PASTED capture mode writes to Note.transcriptClean. */
export type PastedTranscript = {
  source: 'pasted';
  text: string;
};

/** Shape a Soniox batch transcribe call returns. Tier-dependent; we only
 * read the bits we need. */
export type SonioxBatchTranscript = {
  tokens?: Array<{
    text: string;
    speaker?: number;
    start_ms?: number;
    end_ms?: number;
    is_final?: boolean;
  }>;
  /** Optional metadata Soniox returns on the async-job-complete payload. */
  duration_ms?: number;
  language?: string;
};
