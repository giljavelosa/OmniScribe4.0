import { describe, expect, it } from 'vitest';

import {
  CRITICAL_BYTES,
  CRITICAL_TIME_MS,
  MAX_RECORDING_BYTES,
  MAX_RECORDING_MS,
  WARN_BYTES,
  WARN_TIME_MS,
  WAV_HEADER_BYTES,
  deriveWarning,
  estimateAccumulatedWavBytes,
  formatTimeRemaining,
  shouldAutoStop,
} from '@/lib/audio/recording-limits';

/**
 * Recording-limit helpers — runaway-recording guard.
 *
 * Reported 2026-05-25: a clinician asked for an automatic stop on
 * forgotten/long recordings (1.5 h or > 200 MB). The helpers here are
 * the single source of truth used by:
 *   - the live capture state machine (auto-stop trigger)
 *   - RecordingControls (warning banners + countdown copy)
 *   - the /complete-stream server cap (defense in depth)
 *
 * Pinning thresholds + boundary semantics here means a future tweak
 * (e.g. tightening to 60 min for non-rehab divisions) breaks tests
 * everywhere it should.
 */

describe('recording-limits constants', () => {
  it('time cap is exactly 90 minutes', () => {
    expect(MAX_RECORDING_MS).toBe(90 * 60 * 1000);
  });

  it('size cap is exactly 200 MB', () => {
    expect(MAX_RECORDING_BYTES).toBe(200 * 1024 * 1024);
  });

  it('warning thresholds sit before their respective caps', () => {
    expect(WARN_TIME_MS).toBeLessThan(CRITICAL_TIME_MS);
    expect(CRITICAL_TIME_MS).toBeLessThan(MAX_RECORDING_MS);
    expect(WARN_BYTES).toBeLessThan(CRITICAL_BYTES);
    expect(CRITICAL_BYTES).toBeLessThan(MAX_RECORDING_BYTES);
  });
});

describe('shouldAutoStop', () => {
  it('returns null when both metrics are well under their caps', () => {
    expect(
      shouldAutoStop({ elapsedMs: 30 * 60 * 1000, accumulatedBytes: 50 * 1024 * 1024 }),
    ).toBeNull();
  });

  it('returns null exactly one ms before each cap', () => {
    expect(
      shouldAutoStop({
        elapsedMs: MAX_RECORDING_MS - 1,
        accumulatedBytes: MAX_RECORDING_BYTES - 1,
      }),
    ).toBeNull();
  });

  it('returns time_limit when elapsedMs reaches the cap', () => {
    expect(
      shouldAutoStop({ elapsedMs: MAX_RECORDING_MS, accumulatedBytes: 0 }),
    ).toBe('time_limit');
  });

  it('returns size_limit when accumulatedBytes reaches the cap', () => {
    expect(
      shouldAutoStop({ elapsedMs: 0, accumulatedBytes: MAX_RECORDING_BYTES }),
    ).toBe('size_limit');
  });

  it('time_limit wins when both caps trip on the same tick', () => {
    // Documented precedence: at 16 kHz / 16-bit mono PCM, time
    // reaches its cap first under normal conditions. We pin the
    // tiebreaker so audit dashboards split runs deterministically.
    expect(
      shouldAutoStop({
        elapsedMs: MAX_RECORDING_MS,
        accumulatedBytes: MAX_RECORDING_BYTES,
      }),
    ).toBe('time_limit');
  });
});

describe('deriveWarning', () => {
  it('returns none when both metrics are below their warning thresholds', () => {
    expect(
      deriveWarning({ elapsedMs: 30 * 60 * 1000, accumulatedBytes: 50 * 1024 * 1024 }),
    ).toBe('none');
  });

  it('returns time_warning at exactly WARN_TIME_MS', () => {
    expect(
      deriveWarning({ elapsedMs: WARN_TIME_MS, accumulatedBytes: 0 }),
    ).toBe('time_warning');
  });

  it('returns time_critical at exactly CRITICAL_TIME_MS', () => {
    expect(
      deriveWarning({ elapsedMs: CRITICAL_TIME_MS, accumulatedBytes: 0 }),
    ).toBe('time_critical');
  });

  it('returns size_warning at exactly WARN_BYTES', () => {
    expect(
      deriveWarning({ elapsedMs: 0, accumulatedBytes: WARN_BYTES }),
    ).toBe('size_warning');
  });

  it('returns size_critical at exactly CRITICAL_BYTES', () => {
    expect(
      deriveWarning({ elapsedMs: 0, accumulatedBytes: CRITICAL_BYTES }),
    ).toBe('size_critical');
  });

  it('time_critical wins over size_warning', () => {
    expect(
      deriveWarning({ elapsedMs: CRITICAL_TIME_MS, accumulatedBytes: WARN_BYTES }),
    ).toBe('time_critical');
  });

  it('size_critical wins over time_warning', () => {
    expect(
      deriveWarning({ elapsedMs: WARN_TIME_MS, accumulatedBytes: CRITICAL_BYTES }),
    ).toBe('size_critical');
  });
});

describe('estimateAccumulatedWavBytes', () => {
  it('returns just the WAV header for an empty buffer list', () => {
    expect(estimateAccumulatedWavBytes([])).toBe(WAV_HEADER_BYTES);
  });

  it('counts 2 bytes per sample at 16-bit PCM', () => {
    expect(
      estimateAccumulatedWavBytes([{ length: 1000 }, { length: 2000 }]),
    ).toBe(WAV_HEADER_BYTES + 3000 * 2);
  });

  it('matches the cap when 100 chunks of 1 MB each accumulate', () => {
    // 1 MB-per-chunk shape isn't realistic for 16 kHz audio (one sec
    // ≈ 32 KB), but the math should still hold.
    const chunks = Array.from({ length: 100 }, () => ({ length: 524_288 }));
    const total = estimateAccumulatedWavBytes(chunks);
    expect(total).toBe(WAV_HEADER_BYTES + 100 * 524_288 * 2);
  });
});

describe('formatTimeRemaining', () => {
  it('shows minutes when more than 60 s remain', () => {
    expect(formatTimeRemaining(MAX_RECORDING_MS - 5 * 60 * 1000)).toBe('5 min');
  });

  it('rounds up to the next minute (UX bias toward "act now")', () => {
    // 4 min 1 s remaining → "5 min" so the clinician doesn't expect
    // to make it through "exactly 4 minutes" of conversation.
    expect(formatTimeRemaining(MAX_RECORDING_MS - (4 * 60 + 1) * 1000)).toBe('5 min');
  });

  it('switches to seconds in the last minute', () => {
    expect(formatTimeRemaining(MAX_RECORDING_MS - 30_000)).toBe('30 s');
  });

  it('returns an em dash when already past the cap', () => {
    expect(formatTimeRemaining(MAX_RECORDING_MS)).toBe('—');
    expect(formatTimeRemaining(MAX_RECORDING_MS + 5_000)).toBe('—');
  });
});
