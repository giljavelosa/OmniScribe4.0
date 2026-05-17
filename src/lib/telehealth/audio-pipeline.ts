/**
 * TelehealthAudioPipeline — Unit 16.
 *
 * Multiplex two browser audio sources (clinician's local mic + the
 * patient's inbound WebRTC track from Daily.co) into a single Soniox
 * real-time WebSocket. Soniox handles speaker diarization across the
 * merged stream; the existing /api/notes/[id]/realtime-key endpoint is
 * reused unchanged.
 *
 * Why the pipeline lives in /lib (not /app):
 *   The Unit 17 clinician room surface composes this class with a
 *   Daily.co iframe + UI. Keeping it framework-agnostic lets it be
 *   reused by the in-visit copilot (Unit 07+) if we ever decide to
 *   stream copilot transcript snippets from a second source.
 *
 * Why two WS streams instead of mixing the sources to mono in JS:
 *   Mixing loses Soniox's ability to diarize from per-source variance.
 *   Two streams to one WS costs 2× bandwidth (~64 KB/s total — still
 *   trivial) and gives noticeably better speaker labels.
 *
 * Reconnect behavior:
 *   On unexpected `close`, schedule a single reconnect after a short
 *   delay; on reopen, drain ReconnectBuffer to the new socket so the
 *   resumed Soniox session sees continuous audio. Repeated failures
 *   stop the pipeline + emit a connection-change event so the room
 *   surface can banner the clinician.
 */

import { ReconnectBuffer } from './reconnect-buffer';

export const TELEHEALTH_AUDIO_SAMPLE_RATE = 16_000;
export const TELEHEALTH_AUDIO_PCM_WORKLET_URL = '/audio/pcm-worklet.js';
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 500;

export type SourceLabel = 'clinician' | 'patient';

export type RealtimeKeyResponse = {
  apiKey: string;
  websocketUrl: string;
  config: Record<string, unknown>;
  expiresAt: string;
  stub: boolean;
  noteStatus: string;
};

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'active'
  | 'reconnecting'
  | 'stopped'
  | 'failed'
  | 'stub';

export type AudioWiringSetup = {
  /** Sample rate the pipeline locks (16 kHz to match Soniox). */
  sampleRate: number;
};

/**
 * Audio-wiring strategy — the boundary between the pipeline orchestration
 * and the browser's Web Audio API. Default implementation is built by
 * `createBrowserAudioWiring()`; tests inject a fake that pumps synthetic
 * samples so the orchestration is exercisable in happy-dom.
 */
export type AudioWiring = {
  init(setup: AudioWiringSetup): Promise<void>;
  wireSource(opts: {
    label: SourceLabel;
    track: MediaStreamTrack;
    onSamples: (samples: Int16Array, rmsLevel: number) => void;
  }): Promise<() => void>;
  teardown(): Promise<void>;
};

export type StartOptions = {
  noteId: string;
  clinicianTrack: MediaStreamTrack;
  patientTrack: MediaStreamTrack;
};

export type PipelineCallbacks = {
  onTranscript?: (segment: { text: string; isFinal: boolean; speaker: number | null }) => void;
  onConnectionChange?: (state: ConnectionState) => void;
  onReconnected?: () => void;
  onError?: (err: Error) => void;
};

export type PipelineOptions = PipelineCallbacks & {
  /** Browser WebSocket constructor; injectable for tests. */
  wsConstructor?: { new (url: string): WebSocket };
  /** fetch impl; injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Audio-wiring strategy; defaults to the Web Audio API. */
  audioWiring?: AudioWiring;
  /** ReconnectBuffer override (mostly for test seam). */
  reconnectBuffer?: ReconnectBuffer;
  /** Retain a copy of every pumped chunk for end-of-call WAV upload (Unit 17).
   *  Memory cap is ~115 MB for 30 min of two 16 kHz Int16 streams; acceptable
   *  per single call. Off by default — the in-visit copilot use case never
   *  needs to upload the bytes. */
  retainSamples?: boolean;
};

type Source = { label: SourceLabel; disconnect: () => void };

export class TelehealthAudioPipeline {
  readonly #wsCtor: { new (url: string): WebSocket };
  readonly #fetch: typeof fetch;
  readonly #audioWiring: AudioWiring;
  readonly #buffer: ReconnectBuffer;
  readonly #cb: PipelineCallbacks;

  #ws: WebSocket | null = null;
  #state: ConnectionState = 'idle';
  #lastKey: RealtimeKeyResponse | null = null;
  #sources: Source[] = [];
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectAttempts = 0;
  #stopped = false;
  readonly #retainSamples: boolean;
  #retained: Int16Array[] | null = null;

  constructor(options: PipelineOptions = {}) {
    this.#wsCtor = options.wsConstructor ?? (globalThis.WebSocket as typeof WebSocket);
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#audioWiring = options.audioWiring ?? createBrowserAudioWiring();
    this.#buffer =
      options.reconnectBuffer ?? new ReconnectBuffer({ sampleRate: TELEHEALTH_AUDIO_SAMPLE_RATE });
    this.#cb = options;
    this.#retainSamples = options.retainSamples ?? false;
    if (this.#retainSamples) this.#retained = [];
  }

  get state(): ConnectionState {
    return this.#state;
  }

  async start(opts: StartOptions): Promise<void> {
    if (this.#state !== 'idle') {
      throw new Error(`TelehealthAudioPipeline.start: already in state ${this.#state}`);
    }
    this.#stopped = false;
    this.#setState('connecting');

    try {
      // 1. Mint ephemeral Soniox key via the existing endpoint.
      const res = await this.#fetch(`/api/notes/${encodeURIComponent(opts.noteId)}/realtime-key`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `realtime-key returned ${res.status}`);
      }
      const { data } = (await res.json()) as { data: RealtimeKeyResponse };
      this.#lastKey = data;

      // Stub mode: the realtime-key endpoint hands back a fake URL that
      // would 401. Initialize the audio wiring so the worklet still spins
      // up for level-meter feedback, but skip the WS entirely. State stays
      // 'stub' until stop() is called.
      if (data.stub) {
        await this.#audioWiring.init({ sampleRate: TELEHEALTH_AUDIO_SAMPLE_RATE });
        await this.#wireBothSources(opts);
        this.#setState('stub');
        return;
      }

      await this.#audioWiring.init({ sampleRate: TELEHEALTH_AUDIO_SAMPLE_RATE });
      await this.#openWebSocket(data);
      await this.#wireBothSources(opts);
      this.#setState('active');
    } catch (err) {
      // Reset to idle on failure so callers can retry without constructing a
      // new pipeline; otherwise the 'connecting' guard makes recovery impossible.
      this.#setState('idle');
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    for (const s of this.#sources) s.disconnect();
    this.#sources = [];
    if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
      this.#ws.close();
    }
    this.#ws = null;
    await this.#audioWiring.teardown();
    this.#setState('stopped');
  }

  async #wireBothSources(opts: StartOptions): Promise<void> {
    for (const { label, track } of [
      { label: 'clinician' as const, track: opts.clinicianTrack },
      { label: 'patient' as const, track: opts.patientTrack },
    ]) {
      const disconnect = await this.#audioWiring.wireSource({
        label,
        track,
        onSamples: (samples) => this.#pump(samples),
      });
      this.#sources.push({ label, disconnect });
    }
  }

  #pump(samples: Int16Array): void {
    // Always buffer — drains on reconnect; cap is bounded so memory is safe.
    this.#buffer.push(samples);
    if (this.#retained) this.#retained.push(samples);
    if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
      this.#ws.send(samples.buffer);
    }
  }

  /** Pull every retained sample chunk and clear the internal store. Only
   *  meaningful when the pipeline was constructed with `retainSamples: true`;
   *  returns an empty array otherwise. */
  drainRetainedSamples(): Int16Array[] {
    if (!this.#retained) return [];
    const out = this.#retained;
    this.#retained = [];
    return out;
  }

  async #openWebSocket(key: RealtimeKeyResponse): Promise<void> {
    const ws = new this.#wsCtor(key.websocketUrl);
    this.#ws = ws;
    const buffer = this.#buffer;
    const cb = this.#cb;
    ws.onopen = () => {
      ws.send(JSON.stringify({ api_key: key.apiKey, ...key.config }));
      // Drain INSIDE onopen so any samples buffered between connect() and
      // open (the handshake gap) are captured too. Eager-drain before open
      // would strand mid-handshake worklet samples in the now-empty buffer.
      const pendingBuffered = buffer.drain();
      if (pendingBuffered.length > 0) {
        for (const chunk of pendingBuffered) ws.send(chunk.buffer);
        cb.onReconnected?.();
      }
      this.#reconnectAttempts = 0;
    };
    ws.onmessage = (e) => this.#handleSonioxMessage(e.data);
    ws.onerror = () => {
      cb.onError?.(new Error('telehealth audio: WS error'));
    };
    ws.onclose = () => this.#handleSocketClose();
  }

  #handleSocketClose(): void {
    if (this.#stopped) return;
    if (this.#reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.#setState('failed');
      this.#cb.onError?.(new Error('telehealth audio: reconnect attempts exhausted'));
      return;
    }
    this.#setState('reconnecting');
    this.#reconnectAttempts += 1;
    const lastKey = this.#lastKey;
    if (!lastKey) {
      this.#setState('failed');
      return;
    }
    this.#reconnectTimer = setTimeout(() => {
      void this.#openWebSocket(lastKey)
        .then(() => {
          if (!this.#stopped) this.#setState('active');
        })
        .catch((err) => {
          this.#cb.onError?.(err instanceof Error ? err : new Error(String(err)));
        });
    }, RECONNECT_DELAY_MS);
  }

  #handleSonioxMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let msg: {
      partial_transcript?: string;
      final_transcript?: string;
      tokens?: Array<{ text: string; speaker?: number; is_final?: boolean }>;
      words?: Array<{ text: string; speaker?: number; is_final?: boolean }>;
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const tokens = msg.tokens ?? msg.words ?? [];
    for (const tok of tokens) {
      this.#cb.onTranscript?.({
        text: tok.text,
        isFinal: Boolean(tok.is_final),
        speaker: tok.speaker ?? null,
      });
    }
    if (msg.partial_transcript) {
      this.#cb.onTranscript?.({
        text: msg.partial_transcript,
        isFinal: false,
        speaker: null,
      });
    }
    if (msg.final_transcript) {
      this.#cb.onTranscript?.({
        text: msg.final_transcript,
        isFinal: true,
        speaker: null,
      });
    }
  }

  #setState(next: ConnectionState): void {
    if (this.#state === next) return;
    this.#state = next;
    this.#cb.onConnectionChange?.(next);
  }
}

/**
 * Default audio-wiring strategy — the real Web Audio + AudioWorklet path.
 * Built lazily so test environments without AudioContext don't crash on
 * import.
 */
export function createBrowserAudioWiring(): AudioWiring {
  let ctx: AudioContext | null = null;
  const sourceNodes: { source: MediaStreamAudioSourceNode; worklet: AudioWorkletNode }[] = [];

  return {
    async init({ sampleRate }) {
      ctx = new AudioContext({ sampleRate });
      await ctx.audioWorklet.addModule(TELEHEALTH_AUDIO_PCM_WORKLET_URL);
    },
    async wireSource({ track, onSamples }) {
      if (!ctx) throw new Error('AudioWiring.init must be called first');
      const stream = new MediaStream([track]);
      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, 'pcm-worklet');
      worklet.port.onmessage = (e) => {
        const { samples, rmsLevel } = e.data as { samples: Int16Array; rmsLevel: number };
        onSamples(samples, rmsLevel);
      };
      source.connect(worklet);
      sourceNodes.push({ source, worklet });
      return () => {
        worklet.disconnect();
        source.disconnect();
      };
    },
    async teardown() {
      for (const { source, worklet } of sourceNodes) {
        worklet.disconnect();
        source.disconnect();
      }
      sourceNodes.length = 0;
      if (ctx && ctx.state !== 'closed') {
        await ctx.close();
      }
      ctx = null;
    },
  };
}
