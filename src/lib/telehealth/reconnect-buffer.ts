/**
 * Rolling 30-second buffer of Int16 PCM samples for the telehealth audio
 * pipeline (Unit 16). When the Soniox WebSocket drops mid-call (the most
 * common failure on a residential WiFi network), the pipeline keeps
 * pumping the worklet output into this buffer. On WS reopen the buffer
 * drains in order so the resumed Soniox session sees a continuous audio
 * stream and the transcript doesn't lose the last few seconds.
 *
 * Pure data structure — no DOM, no React, no audio API references. All
 * timing assumptions live in the constructor's `sampleRate` arg (the
 * pipeline locks 16 kHz to match Soniox's STT config). Tested in
 * isolation in test/lib/reconnect-buffer.test.ts.
 *
 * Eviction strategy: drop oldest CHUNK (not oldest sample) when over
 * cap. Chunks come from the worklet at ~50 ms grain (800 samples at
 * 16 kHz) so granular sample-level eviction would buy us at most one
 * worklet tick of precision at the cost of much more bookkeeping.
 */

export type ReconnectBufferOptions = {
  /** Sample rate of the audio stream. Pipeline locks 16_000 to match Soniox. */
  sampleRate: number;
  /** Window size in seconds. Default 30 — covers the typical residential WiFi
   *  reconnect window without ballooning memory (30 s @ 16 kHz Int16 ≈ 940 KB). */
  windowSeconds?: number;
};

export class ReconnectBuffer {
  private readonly capSamples: number;
  private chunks: Int16Array[] = [];
  private totalSamples = 0;

  constructor(options: ReconnectBufferOptions) {
    const windowSeconds = options.windowSeconds ?? 30;
    if (options.sampleRate <= 0) throw new Error('ReconnectBuffer: sampleRate must be positive');
    if (windowSeconds <= 0) throw new Error('ReconnectBuffer: windowSeconds must be positive');
    this.capSamples = Math.floor(options.sampleRate * windowSeconds);
  }

  /** Append a worklet-tick chunk. Drops the oldest chunks if over cap. */
  push(samples: Int16Array): void {
    if (samples.length === 0) return;
    this.chunks.push(samples);
    this.totalSamples += samples.length;
    while (this.totalSamples > this.capSamples && this.chunks.length > 1) {
      const dropped = this.chunks.shift();
      if (dropped) this.totalSamples -= dropped.length;
    }
  }

  /** Return all buffered samples in arrival order and clear the buffer. */
  drain(): Int16Array[] {
    const out = this.chunks;
    this.chunks = [];
    this.totalSamples = 0;
    return out;
  }

  /** Current buffered sample count — useful for tests + telemetry. */
  get size(): number {
    return this.totalSamples;
  }

  /** Configured cap in samples. Stable for the lifetime of the buffer. */
  get capacity(): number {
    return this.capSamples;
  }
}
