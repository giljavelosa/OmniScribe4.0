/**
 * Live-capture recording limits — shared by:
 *   - the client state machine in capture-state.tsx (auto-stops the
 *     recording when a cap is reached so a forgotten session doesn't
 *     accumulate hours of audio)
 *   - RecordingControls.tsx (warning banners + countdown copy)
 *   - the /api/notes/[id]/complete-stream route (server-side guard)
 *   - tests pin the thresholds down so a future tweak in one place
 *     surfaces in CI everywhere it matters
 *
 * Sizing rationale (rehab clinical context, 2026-05-25 ask)
 * ---------------------------------------------------------
 * Most rehab visits run 45–75 minutes of clinician–patient
 * conversation; documentation-heavy outpatient evaluations can stretch
 * close to 90. We pick the upper bound + a beat of headroom for the
 * first cap and let the size cap shadow it for defensive parity.
 *
 *   MAX_RECORDING_MS    = 90 minutes
 *   MAX_RECORDING_BYTES = 200 MB
 *
 * 90 min × 16 kHz × 16-bit mono PCM ≈ 172.8 MB raw, plus the WAV
 * header. 200 MB matches `proxyClientMaxBodySize` (next.config.ts) and
 * `/api/notes/[id]/upload-audio` (`MAX_AUDIO_BYTES`), so any path that
 * lands on disk shares one ceiling.
 *
 * Warnings fire at:
 *   - 85 min (5 min before the time cap) — yellow banner
 *   - 89 min (last minute) — red banner + spelled-out countdown
 *   - 80 % of the size cap (160 MB) — yellow banner (size_warning)
 *   - 95 % of the size cap (190 MB) — red banner (size_critical)
 *
 * The auto-stop reason carried through to /complete-stream + the
 * NOTE_GENERATION audit so a reviewer can quantify how often
 * forgotten-recording recovery fires.
 */

/** Hard time cap. Recording auto-stops when reached. */
export const MAX_RECORDING_MS = 90 * 60 * 1000;

/** Hard size cap. Recording auto-stops when accumulated WAV bytes reach this.
 *  Matches the upstream `proxyClientMaxBodySize` (next.config.ts) and
 *  `/upload-audio` MAX_AUDIO_BYTES, so all paths share one ceiling. */
export const MAX_RECORDING_BYTES = 200 * 1024 * 1024;

/** Soft warnings: yellow banner. */
export const WARN_TIME_MS = 85 * 60 * 1000; // 5 min before time cap
export const WARN_BYTES = Math.round(0.8 * MAX_RECORDING_BYTES); // 80 %

/** Critical warnings: red banner. */
export const CRITICAL_TIME_MS = 89 * 60 * 1000; // last minute
export const CRITICAL_BYTES = Math.round(0.95 * MAX_RECORDING_BYTES); // 95 %

export type AutoStopReason = 'time_limit' | 'size_limit';

export type RecordingLimitState = {
  elapsedMs: number;
  accumulatedBytes: number;
};

/**
 * Returns the auto-stop reason if either cap is reached, otherwise null.
 * Time cap wins when both fire on the same tick — feels right because
 * size growth is bounded by elapsed time at 16 kHz × 16-bit mono PCM,
 * but if the client somehow inflates past the size limit early (e.g.
 * higher sample-rate device), size_limit takes the next tick. The
 * specific reason is recorded in the audit metadata so downstream
 * dashboards can split them. */
export function shouldAutoStop(s: RecordingLimitState): AutoStopReason | null {
  if (s.elapsedMs >= MAX_RECORDING_MS) return 'time_limit';
  if (s.accumulatedBytes >= MAX_RECORDING_BYTES) return 'size_limit';
  return null;
}

/** Discrete warning level for the banner UI. Critical wins over warning. */
export type WarningLevel =
  | 'none'
  | 'time_warning'
  | 'time_critical'
  | 'size_warning'
  | 'size_critical';

export function deriveWarning(s: RecordingLimitState): WarningLevel {
  // Critical thresholds first so a 89:30 banner doesn't flip back to
  // 'time_warning' on a tick where size also crossed the warning line.
  if (s.elapsedMs >= CRITICAL_TIME_MS) return 'time_critical';
  if (s.accumulatedBytes >= CRITICAL_BYTES) return 'size_critical';
  if (s.elapsedMs >= WARN_TIME_MS) return 'time_warning';
  if (s.accumulatedBytes >= WARN_BYTES) return 'size_warning';
  return 'none';
}

/**
 * WAV size of the buffered Int16Array chunks the AudioWorklet has
 * pushed so far. Used by capture-state to evaluate `shouldAutoStop`
 * without actually encoding the WAV every tick (cheap arithmetic vs.
 * O(N) encode). 16-bit PCM = 2 bytes per sample; the 44-byte WAV
 * header is fixed regardless of length.
 */
export const WAV_HEADER_BYTES = 44;

export function estimateAccumulatedWavBytes(
  buffers: ReadonlyArray<{ length: number }>,
): number {
  let samples = 0;
  for (const b of buffers) samples += b.length;
  return WAV_HEADER_BYTES + samples * 2;
}

/**
 * Human-readable countdown for the banner — "5 min", "29 s", "—" when
 * already past the cap.
 */
export function formatTimeRemaining(elapsedMs: number): string {
  const remainingMs = MAX_RECORDING_MS - elapsedMs;
  if (remainingMs <= 0) return '—';
  const seconds = Math.ceil(remainingMs / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} min`;
}
