'use client';

/**
 * Capture state — a single Context providing the recording state machine,
 * the AudioWorklet/WebSocket pipeline, and the controls API.
 *
 * Per the design-critique-capture-flow.md "single source of truth" rule:
 *   - <RecordingStatus> reads from useRecordingState().
 *   - <AudioLevelBars> reads from useAudioLevel().
 *   - <RecordingControls> calls useCaptureControls().
 *   - <TranscriptWorkspace> reads from useTranscript().
 *
 * No other surface renders its own recording label or empty-state status.
 *
 * State machine (discriminated union per code-standards.md):
 *   idle → requesting-mic → recording ⇄ paused → finalizing → complete
 *                                             ↘                   ↗
 *                                              error ←─────────────
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type RecordingState =
  | { kind: 'idle' }
  | { kind: 'requesting-mic' }
  | { kind: 'recording'; startedAt: number; isStub: boolean }
  | { kind: 'paused'; pausedAt: number }
  | { kind: 'finalizing' }
  | { kind: 'drafting' }
  | { kind: 'complete' }
  | { kind: 'error'; reason: string };

export type TranscriptSegment = {
  id: string;
  text: string;
  speaker: number | null;
  isFinal: boolean;
};

type CaptureStateValue = {
  state: RecordingState;
  audioLevel: number; // 0..1 (rms smoothed)
  transcript: TranscriptSegment[];
  partial: string;
  finalAudioBlob: Blob | null;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  finish: () => Promise<void>;
  reset: () => void;
  // Set once the WS opens; surfaced to the page so it can banner "Soniox stub mode".
  isStub: boolean;
};

const CaptureStateContext = createContext<CaptureStateValue | null>(null);

const SAMPLE_RATE = 16_000;

export function CaptureStateProvider({
  noteId,
  children,
}: {
  noteId: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<RecordingState>({ kind: 'idle' });
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [partial, setPartial] = useState('');
  const [finalAudioBlob, setFinalAudioBlob] = useState<Blob | null>(null);
  const [isStub, setIsStub] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isPausedRef = useRef(false);
  const audioBuffersRef = useRef<Int16Array[]>([]);
  const audioLevelRef = useRef(0);
  const audioLevelRafRef = useRef<number | null>(null);

  // Smoothing animation loop — keep AudioLevelBars at 60fps without
  // re-rendering on every worklet message.
  useEffect(() => {
    function tick() {
      setAudioLevel((prev) => prev * 0.7 + audioLevelRef.current * 0.3);
      audioLevelRafRef.current = requestAnimationFrame(tick);
    }
    audioLevelRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (audioLevelRafRef.current != null) cancelAnimationFrame(audioLevelRafRef.current);
    };
  }, []);

  const teardown = useCallback(() => {
    workletRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (audioContextRef.current?.state !== 'closed') {
      void audioContextRef.current?.close();
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.close();
    workletRef.current = null;
    sourceNodeRef.current = null;
    mediaStreamRef.current = null;
    audioContextRef.current = null;
    wsRef.current = null;
  }, []);

  // Browser cleanup on unmount.
  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    if (state.kind !== 'idle' && state.kind !== 'error') return;
    setState({ kind: 'requesting-mic' });

    try {
      // 1. Mint ephemeral key via the server (server flips Note → RECORDING).
      const keyRes = await fetch(`/api/notes/${noteId}/realtime-key`, { method: 'POST' });
      if (!keyRes.ok) {
        const body = await keyRes.json().catch(() => null);
        throw new Error(body?.error?.message ?? `realtime-key returned ${keyRes.status}`);
      }
      const { data } = (await keyRes.json()) as {
        data: { apiKey: string; websocketUrl: string; config: Record<string, unknown>; stub: boolean };
      };
      setIsStub(data.stub);

      // 2. Mic + AudioContext + worklet.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = ctx;
      await ctx.audioWorklet.addModule('/audio/pcm-worklet.js');
      const source = ctx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      const worklet = new AudioWorkletNode(ctx, 'pcm-worklet');
      workletRef.current = worklet;

      // 3. WebSocket to Soniox (skip in stub mode — fake key would 401 anyway).
      if (!data.stub) {
        const ws = new WebSocket(data.websocketUrl);
        wsRef.current = ws;
        ws.onopen = () => {
          // Init message: per Soniox protocol, send api_key + config as JSON
          // before any audio bytes.
          ws.send(JSON.stringify({ api_key: data.apiKey, ...data.config }));
        };
        ws.onmessage = (e) => parseSonioxMessage(e.data, setTranscript, setPartial);
        ws.onerror = () => {
          setState({ kind: 'error', reason: 'transcription connection failed' });
        };
        ws.onclose = () => {
          // If we're still recording, mark as error so the UI can banner.
          // Reconnect path can be added in a later commit.
          setState((s) => (s.kind === 'recording' ? { kind: 'error', reason: 'transcription disconnected' } : s));
        };
      }

      // 4. Pump worklet output → WS + collect for the final upload.
      worklet.port.onmessage = (e) => {
        const { samples, rmsLevel } = e.data as { samples: Int16Array; rmsLevel: number };
        audioLevelRef.current = rmsLevel;
        if (isPausedRef.current) return;
        audioBuffersRef.current.push(samples);
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(samples.buffer);
      };
      source.connect(worklet);

      setState({ kind: 'recording', startedAt: Date.now(), isStub: data.stub });
    } catch (e) {
      teardown();
      setState({ kind: 'error', reason: e instanceof Error ? e.message : String(e) });
    }
  }, [noteId, state.kind, teardown]);

  const pause = useCallback(() => {
    if (state.kind !== 'recording') return;
    isPausedRef.current = true;
    setState({ kind: 'paused', pausedAt: Date.now() });
    void fetch(`/api/notes/${noteId}/recording-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    }).catch(() => {});
  }, [noteId, state.kind]);

  const resume = useCallback(async () => {
    if (state.kind !== 'paused') return;
    isPausedRef.current = false;
    setState({ kind: 'recording', startedAt: Date.now(), isStub });
    void fetch(`/api/notes/${noteId}/recording-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    }).catch(() => {});
  }, [noteId, state.kind, isStub]);

  const finish = useCallback(async () => {
    if (state.kind !== 'recording' && state.kind !== 'paused') return;
    setState({ kind: 'finalizing' });
    try {
      const wavBlob = encodeWavBlob(audioBuffersRef.current, SAMPLE_RATE);
      setFinalAudioBlob(wavBlob);

      const formData = new FormData();
      formData.append(
        'finalTranscript',
        JSON.stringify({ segments: transcript, partial }),
      );
      formData.append('audio', wavBlob, 'capture.wav');

      const res = await fetch(`/api/notes/${noteId}/complete-stream`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(`complete-stream returned ${res.status}`);

      teardown();
      setState({ kind: 'complete' });
    } catch (e) {
      setState({ kind: 'error', reason: e instanceof Error ? e.message : String(e) });
    }
  }, [noteId, partial, state.kind, teardown, transcript]);

  const reset = useCallback(() => {
    teardown();
    audioBuffersRef.current = [];
    isPausedRef.current = false;
    setTranscript([]);
    setPartial('');
    setAudioLevel(0);
    audioLevelRef.current = 0;
    setFinalAudioBlob(null);
    setState({ kind: 'idle' });
  }, [teardown]);

  const value = useMemo<CaptureStateValue>(
    () => ({ state, audioLevel, transcript, partial, finalAudioBlob, start, pause, resume, finish, reset, isStub }),
    [state, audioLevel, transcript, partial, finalAudioBlob, start, pause, resume, finish, reset, isStub],
  );

  return <CaptureStateContext.Provider value={value}>{children}</CaptureStateContext.Provider>;
}

function useCapture() {
  const ctx = useContext(CaptureStateContext);
  if (!ctx) throw new Error('useCapture(): missing <CaptureStateProvider>');
  return ctx;
}

// -- granular hooks for components that want to subscribe to only part of state --

export function useRecordingState() {
  return useCapture().state;
}
export function useAudioLevel() {
  return useCapture().audioLevel;
}
export function useTranscript() {
  const c = useCapture();
  return { segments: c.transcript, partial: c.partial };
}
export function useCaptureControls() {
  const c = useCapture();
  return { start: c.start, pause: c.pause, resume: c.resume, finish: c.finish, reset: c.reset };
}
export function useStubBanner() {
  return useCapture().isStub;
}

// =============================================================================
// encodeWavBlob — concatenates the Int16 buffers and prepends a WAV header so
// the upload payload is a self-describing audio file. Server's S3 layer just
// stores the bytes; downstream Soniox batch path expects a WAV.
// =============================================================================
function encodeWavBlob(chunks: Int16Array[], sampleRate: number): Blob {
  const totalSamples = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Int16Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  const dataBytes = merged.byteLength;
  const headerBytes = 44;
  const buffer = new ArrayBuffer(headerBytes + dataBytes);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, headerBytes + dataBytes - 8, true);
  writeString(view, 8, 'WAVE');
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);        // block align
  view.setUint16(34, 16, true);       // bits per sample
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  // PCM samples
  new Int16Array(buffer, headerBytes).set(merged);

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

/**
 * Parses a raw Soniox WS message and pushes the resulting segments into the
 * provided setters. Pulled out of the provider so the eslint
 * `react-hooks/immutability` rule doesn't trip on inner function declarations.
 */
function parseSonioxMessage(
  raw: unknown,
  setTranscript: React.Dispatch<React.SetStateAction<TranscriptSegment[]>>,
  setPartial: React.Dispatch<React.SetStateAction<string>>,
) {
  if (typeof raw !== 'string') return;
  let msg: {
    partial_transcript?: string;
    final_transcript?: string;
    words?: Array<{ text: string; speaker?: number; is_final?: boolean }>;
    tokens?: Array<{ text: string; speaker?: number; is_final?: boolean }>;
  };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  const tokens = msg.tokens ?? msg.words ?? [];
  if (tokens.length) {
    const newFinal: TranscriptSegment[] = [];
    let runningPartial = '';
    for (const tok of tokens) {
      if (tok.is_final) {
        newFinal.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text: tok.text,
          speaker: tok.speaker ?? null,
          isFinal: true,
        });
      } else {
        runningPartial += tok.text;
      }
    }
    if (newFinal.length) setTranscript((prev) => [...prev, ...newFinal]);
    setPartial(runningPartial);
  }
  if (msg.partial_transcript) setPartial(msg.partial_transcript);
  if (msg.final_transcript) {
    const finalStr = msg.final_transcript;
    setTranscript((prev) => [
      ...prev,
      { id: `${Date.now()}`, text: finalStr, speaker: null, isFinal: true },
    ]);
    setPartial('');
  }
}
