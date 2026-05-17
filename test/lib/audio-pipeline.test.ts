import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TelehealthAudioPipeline,
  type AudioWiring,
  type RealtimeKeyResponse,
} from '@/lib/telehealth/audio-pipeline';

/**
 * The pipeline's orchestration logic (key fetch, init/config handshake,
 * reconnect buffering, transcript callback shape) is fully unit-testable
 * by injecting a fake WebSocket constructor + a fake AudioWiring. The
 * real Web Audio path is not exercised here — happy-dom has no
 * AudioContext, and the wiring abstraction exists precisely so this
 * orchestration tests cleanly without one.
 */

type Inbound = string | ArrayBuffer;
type FakeSocketHandlers = {
  open?: () => void;
  message?: (e: { data: unknown }) => void;
  close?: () => void;
  error?: () => void;
};

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  url: string;
  readyState = 0;
  sent: Inbound[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  send(data: Inbound): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  /** Test helper: simulate the WS opening + invoking handlers. */
  simulate(handlers: FakeSocketHandlers): void {
    if (handlers.open) {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    }
    if (handlers.message) {
      this.onmessage?.({ data: 'unused' });
    }
    if (handlers.close) {
      this.readyState = 3;
      this.onclose?.();
    }
    if (handlers.error) {
      this.onerror?.();
    }
  }
}

function mockWebSocket() {
  FakeSocket.instances = [];
  return FakeSocket as unknown as { new (url: string): WebSocket };
}

function fakeAudioWiring(): AudioWiring & { pumps: Array<(samples: Int16Array) => void>; teardownCalls: number } {
  const pumps: Array<(samples: Int16Array) => void> = [];
  let teardownCalls = 0;
  return {
    pumps,
    get teardownCalls() {
      return teardownCalls;
    },
    init: vi.fn(async () => {}),
    wireSource: vi.fn(async ({ onSamples }) => {
      pumps.push(onSamples);
      return () => {};
    }),
    teardown: vi.fn(async () => {
      teardownCalls += 1;
    }),
  } as unknown as AudioWiring & { pumps: Array<(samples: Int16Array) => void>; teardownCalls: number };
}

function fakeTracks() {
  // happy-dom doesn't implement MediaStreamTrack; the pipeline doesn't actually
  // touch it (it goes through AudioWiring), so an empty object suffices.
  return {
    clinicianTrack: {} as unknown as MediaStreamTrack,
    patientTrack: {} as unknown as MediaStreamTrack,
  };
}

function realtimeKeyResponse(overrides: Partial<RealtimeKeyResponse> = {}): RealtimeKeyResponse {
  return {
    apiKey: 'fake-key',
    websocketUrl: 'wss://fake.soniox.local/transcribe',
    config: { enable_speaker_diarization: true, audio_format: 'pcm_s16le' },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    stub: false,
    noteStatus: 'RECORDING',
    ...overrides,
  };
}

describe('TelehealthAudioPipeline', () => {
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it('fetches the realtime-key for the supplied noteId then opens a WS', async () => {
    const key = realtimeKeyResponse();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: key }), { status: 200 }),
    ) as unknown as typeof fetch;
    const wsCtor = mockWebSocket();
    const wiring = fakeAudioWiring();
    const pipeline = new TelehealthAudioPipeline({
      fetchImpl,
      wsConstructor: wsCtor,
      audioWiring: wiring,
    });

    const tracks = fakeTracks();
    await pipeline.start({ noteId: 'note-123', ...tracks });

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/notes/note-123/realtime-key',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(FakeSocket.instances.length).toBe(1);
    expect(FakeSocket.instances[0]!.url).toBe(key.websocketUrl);
    expect(pipeline.state).toBe('active');
  });

  it('sends the config init message as the first WS payload on open', async () => {
    const key = realtimeKeyResponse();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: key }), { status: 200 }),
    ) as unknown as typeof fetch;
    const pipeline = new TelehealthAudioPipeline({
      fetchImpl,
      wsConstructor: mockWebSocket(),
      audioWiring: fakeAudioWiring(),
    });
    await pipeline.start({ noteId: 'n1', ...fakeTracks() });
    const ws = FakeSocket.instances[0]!;
    ws.simulate({ open: () => {} });
    expect(ws.sent.length).toBe(1);
    const first = ws.sent[0] as string;
    const parsed = JSON.parse(first);
    expect(parsed.api_key).toBe('fake-key');
    expect(parsed.enable_speaker_diarization).toBe(true);
    expect(parsed.audio_format).toBe('pcm_s16le');
  });

  it('pumps worklet samples to the WS once open', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: realtimeKeyResponse() }), { status: 200 }),
    ) as unknown as typeof fetch;
    const wiring = fakeAudioWiring();
    const pipeline = new TelehealthAudioPipeline({
      fetchImpl,
      wsConstructor: mockWebSocket(),
      audioWiring: wiring,
    });
    await pipeline.start({ noteId: 'n1', ...fakeTracks() });
    const ws = FakeSocket.instances[0]!;
    ws.simulate({ open: () => {} });
    // Two pumps registered (clinician + patient sources).
    expect(wiring.pumps.length).toBe(2);
    wiring.pumps[0]!(new Int16Array([1, 2, 3]));
    wiring.pumps[1]!(new Int16Array([4, 5]));
    // First sent is the config; samples follow.
    expect(ws.sent.length).toBe(3);
    expect(ws.sent[1]).toBeInstanceOf(ArrayBuffer);
    expect(ws.sent[2]).toBeInstanceOf(ArrayBuffer);
  });

  it('buffers samples while WS is closed and drains on reconnect', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: realtimeKeyResponse() }), { status: 200 }),
    ) as unknown as typeof fetch;
    const wiring = fakeAudioWiring();
    const reconnected = vi.fn();
    const pipeline = new TelehealthAudioPipeline({
      fetchImpl,
      wsConstructor: mockWebSocket(),
      audioWiring: wiring,
      onReconnected: reconnected,
    });
    await pipeline.start({ noteId: 'n1', ...fakeTracks() });
    const ws1 = FakeSocket.instances[0]!;
    ws1.simulate({ open: () => {} });

    // Send a sample successfully.
    wiring.pumps[0]!(new Int16Array([100, 200]));
    expect(ws1.sent.length).toBe(2); // config + 1 sample chunk

    // WS unexpectedly closes.
    ws1.close();
    expect(pipeline.state).toBe('reconnecting');

    // Pipeline keeps accepting samples while disconnected.
    wiring.pumps[0]!(new Int16Array([7, 8, 9]));
    wiring.pumps[1]!(new Int16Array([10, 11]));

    // Reconnect fires after the delay.
    await vi.advanceTimersByTimeAsync(600);
    expect(FakeSocket.instances.length).toBe(2);
    const ws2 = FakeSocket.instances[1]!;
    ws2.simulate({ open: () => {} });

    // ws2 should have received: config + drained-buffer chunks (one from each pump call).
    expect(ws2.sent[0]).toBeTypeOf('string'); // config
    expect(ws2.sent.length).toBeGreaterThanOrEqual(3); // config + 2 buffered chunks
    expect(reconnected).toHaveBeenCalledTimes(1);
    expect(pipeline.state).toBe('active');
  });

  it('emits transcript callbacks parsed from token + final_transcript messages', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: realtimeKeyResponse() }), { status: 200 }),
    ) as unknown as typeof fetch;
    const onTranscript = vi.fn();
    const pipeline = new TelehealthAudioPipeline({
      fetchImpl,
      wsConstructor: mockWebSocket(),
      audioWiring: fakeAudioWiring(),
      onTranscript,
    });
    await pipeline.start({ noteId: 'n1', ...fakeTracks() });
    const ws = FakeSocket.instances[0]!;
    ws.simulate({ open: () => {} });
    // Soniox tokens shape.
    ws.onmessage?.({
      data: JSON.stringify({
        tokens: [
          { text: 'Hello', speaker: 1, is_final: true },
          { text: ' world', speaker: 1, is_final: false },
        ],
      }),
    });
    expect(onTranscript).toHaveBeenCalledTimes(2);
    expect(onTranscript).toHaveBeenNthCalledWith(1, { text: 'Hello', isFinal: true, speaker: 1 });
    expect(onTranscript).toHaveBeenNthCalledWith(2, { text: ' world', isFinal: false, speaker: 1 });
  });

  it('skips WebSocket entirely in stub mode but still wires the audio sources', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: realtimeKeyResponse({ stub: true }) }), { status: 200 }),
    ) as unknown as typeof fetch;
    const wiring = fakeAudioWiring();
    const pipeline = new TelehealthAudioPipeline({
      fetchImpl,
      wsConstructor: mockWebSocket(),
      audioWiring: wiring,
    });
    await pipeline.start({ noteId: 'n1', ...fakeTracks() });
    expect(FakeSocket.instances.length).toBe(0);
    expect(wiring.pumps.length).toBe(2);
    expect(pipeline.state).toBe('stub');
  });

  it('stop() closes the WS, tears down audio, and prevents further reconnects', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: realtimeKeyResponse() }), { status: 200 }),
    ) as unknown as typeof fetch;
    const wiring = fakeAudioWiring();
    const pipeline = new TelehealthAudioPipeline({
      fetchImpl,
      wsConstructor: mockWebSocket(),
      audioWiring: wiring,
    });
    await pipeline.start({ noteId: 'n1', ...fakeTracks() });
    const ws = FakeSocket.instances[0]!;
    ws.simulate({ open: () => {} });

    await pipeline.stop();
    expect(pipeline.state).toBe('stopped');
    expect(wiring.teardownCalls).toBe(1);

    // Even if the WS now reports a close after stop(), no reconnect should fire.
    ws.simulate({ close: () => {} });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSocket.instances.length).toBe(1);
  });

  it('start() twice without stop throws', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: realtimeKeyResponse() }), { status: 200 }),
    ) as unknown as typeof fetch;
    const pipeline = new TelehealthAudioPipeline({
      fetchImpl,
      wsConstructor: mockWebSocket(),
      audioWiring: fakeAudioWiring(),
    });
    await pipeline.start({ noteId: 'n1', ...fakeTracks() });
    await expect(pipeline.start({ noteId: 'n1', ...fakeTracks() })).rejects.toThrow();
  });

  it('retains pumped samples when retainSamples: true is set', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: realtimeKeyResponse() }), { status: 200 }),
    ) as unknown as typeof fetch;
    const wiring = fakeAudioWiring();
    const pipeline = new TelehealthAudioPipeline({
      fetchImpl,
      wsConstructor: mockWebSocket(),
      audioWiring: wiring,
      retainSamples: true,
    });
    await pipeline.start({ noteId: 'n1', ...fakeTracks() });
    const ws = FakeSocket.instances[0]!;
    ws.simulate({ open: () => {} });
    wiring.pumps[0]!(new Int16Array([1, 2]));
    wiring.pumps[1]!(new Int16Array([3, 4, 5]));
    const drained = pipeline.drainRetainedSamples();
    expect(drained.length).toBe(2);
    expect(Array.from(drained[0]!)).toEqual([1, 2]);
    expect(Array.from(drained[1]!)).toEqual([3, 4, 5]);
    // Second drain returns an empty array — the buffer was cleared.
    expect(pipeline.drainRetainedSamples()).toEqual([]);
  });

  it('wires only the clinician source when patientTrack is null', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: realtimeKeyResponse() }), { status: 200 }),
    ) as unknown as typeof fetch;
    const wiring = fakeAudioWiring();
    const pipeline = new TelehealthAudioPipeline({
      fetchImpl,
      wsConstructor: mockWebSocket(),
      audioWiring: wiring,
    });
    const tracks = fakeTracks();
    await pipeline.start({
      noteId: 'n1',
      clinicianTrack: tracks.clinicianTrack,
      patientTrack: null,
    });
    expect(wiring.pumps.length).toBe(1);
  });

  it('does not retain samples by default', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: realtimeKeyResponse() }), { status: 200 }),
    ) as unknown as typeof fetch;
    const wiring = fakeAudioWiring();
    const pipeline = new TelehealthAudioPipeline({
      fetchImpl,
      wsConstructor: mockWebSocket(),
      audioWiring: wiring,
    });
    await pipeline.start({ noteId: 'n1', ...fakeTracks() });
    const ws = FakeSocket.instances[0]!;
    ws.simulate({ open: () => {} });
    wiring.pumps[0]!(new Int16Array([1, 2, 3]));
    expect(pipeline.drainRetainedSamples()).toEqual([]);
  });

  it('surfaces fetch failure as a thrown error during start', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 'forbidden' } }), { status: 403 }),
    ) as unknown as typeof fetch;
    const pipeline = new TelehealthAudioPipeline({
      fetchImpl,
      wsConstructor: mockWebSocket(),
      audioWiring: fakeAudioWiring(),
    });
    await expect(pipeline.start({ noteId: 'n1', ...fakeTracks() })).rejects.toThrow(/403/);
  });
});
