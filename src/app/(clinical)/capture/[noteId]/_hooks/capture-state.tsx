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
 *                             ↕                                     ↗
 *                          reconnecting → recording (on success)
 *                                       ↘ error (on exhaustion)
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

import { encodeWavBlob } from '@/lib/audio/wav-encoder';
import {
  shouldAutoStop,
  estimateAccumulatedWavBytes,
  type AutoStopReason,
} from '@/lib/audio/recording-limits';

export type RecordingState =
  | { kind: 'idle' }
  | { kind: 'requesting-mic' }
  | { kind: 'recording'; startedAt: number; isStub: boolean }
  | { kind: 'reconnecting'; startedAt: number; isStub: boolean; attempt: number }
  | { kind: 'paused'; pausedAt: number }
  | { kind: 'finalizing' }
  | { kind: 'drafting' }
  | { kind: 'complete' }
  | {
      /** Anti-credential-sharing defense — another device on this account
       *  is currently recording. The clinician must either end that
       *  recording or explicitly take it over from this device. The
       *  meta describes the active lock so the UI can show
       *  "started 47 seconds ago on note X" before the user confirms. */
      kind: 'lock-conflict';
      activeNoteId: string;
      activeClaimedAt: string;
      activeLockAgeMs: number;
    }
  | { kind: 'error'; reason: string };

export type TranscriptSegment = {
  id: string;
  text: string;
  speaker: number | null;
  isFinal: boolean;
};

type SonioxKeyData = {
  apiKey: string;
  websocketUrl: string;
  config: Record<string, unknown>;
  stub: boolean;
};

type CaptureStateValue = {
  state: RecordingState;
  audioLevel: number; // 0..1 (rms smoothed)
  transcript: TranscriptSegment[];
  partial: string;
  finalAudioBlob: Blob | null;
  /** Bytes the worklet has accumulated so far (estimated WAV size).
   *  Drives the size-cap warning + auto-stop. Reset on `reset()`. */
  accumulatedBytes: number;
  /** Set when the runaway-recording guard force-stopped the take.
   *  Drives the post-finish banner copy + is forwarded as audit
   *  metadata via /complete-stream. Cleared on `reset()`. */
  autoStopReason: AutoStopReason | null;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  finish: () => Promise<void>;
  reset: () => void;
  /** Anti-credential-sharing defense — when state.kind === 'lock-conflict',
   *  the UI surfaces an AlertDialog and calls this to displace the other
   *  device's recording lock. Internally it re-runs start() with
   *  takeover=true. */
  confirmTakeover: () => Promise<void>;
  // Set once the WS opens; surfaced to the page so it can banner "Soniox stub mode".
  isStub: boolean;
};

const CaptureStateContext = createContext<CaptureStateValue | null>(null);

const SAMPLE_RATE = 16_000;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 700;
/** ms to wait after stopping audio before closing WS so Soniox can finalize tokens. */
const WS_DRAIN_WAIT_MS = 800;

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
  const [accumulatedBytes, setAccumulatedBytes] = useState(0);
  const [autoStopReason, setAutoStopReason] = useState<AutoStopReason | null>(null);
  // Synchronous mirrors so finish()'s closure can read the latest
  // value at call time without re-rendering loops.
  const autoStopReasonRef = useRef<AutoStopReason | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Anti-credential-sharing recording lock (2026-05-25). One nonce per
  // provider mount — stable for the entire recording session including
  // pauses + reconnects. The server uses this to identify "same device
  // re-minting the key" vs "a different device on the same account".
  // Lazily initialized via useState so the random call runs exactly
  // once per mount AND satisfies React 19's render-purity rule. The
  // nonce is an opaque random string; never contains PHI.
  const [clientNonce] = useState<string>(() => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  });
  // Set when the user explicitly confirms takeover via the AlertDialog.
  // The next start() consumes + clears it. Kept in a ref so the click
  // handler doesn't have to be re-bound across renders.
  const pendingTakeoverRef = useRef(false);
  const isPausedRef = useRef(false);
  const audioBuffersRef = useRef<Int16Array[]>([]);
  const audioLevelRef = useRef(0);
  const audioLevelRafRef = useRef<number | null>(null);

  // Elapsed timer — original start + accumulated paused time.
  const recordingStartedAtRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number | null>(null);
  const accumulatedPausedMsRef = useRef(0);

  // Reconnect state
  const wsClosedByUsRef = useRef(false); // true when we intentionally close
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKeyDataRef = useRef<SonioxKeyData | null>(null);
  const isStubRef = useRef(false);
  const startedAtRef = useRef<number>(0);

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
    if (wsRef.current?.readyState === WebSocket.OPEN ||
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      wsClosedByUsRef.current = true;
      wsRef.current.close();
    }
    workletRef.current = null;
    sourceNodeRef.current = null;
    mediaStreamRef.current = null;
    audioContextRef.current = null;
    wsRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  /**
   * Post the realtime-key request with the lock-claim body. Centralized so
   * all three call sites (start, resume, reconnect) ship the nonce + takeover
   * the same way. Returns the parsed `data` on success, or a tagged
   * lock-conflict object on 409 so the caller can route to the conflict UI.
   */
  const requestRealtimeKey = useCallback(
    async (opts: { takeover?: boolean } = {}): Promise<
      | { kind: 'ok'; data: SonioxKeyData & { noteStatus: string } }
      | { kind: 'lock-conflict'; activeNoteId: string; activeClaimedAt: string; activeLockAgeMs: number }
      | { kind: 'error'; message: string }
    > => {
      const res = await fetch(`/api/notes/${noteId}/realtime-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientNonce,
          takeover: opts.takeover === true,
        }),
      });
      if (res.ok) {
        const { data } = (await res.json()) as { data: SonioxKeyData & { noteStatus: string } };
        return { kind: 'ok', data };
      }
      if (res.status === 409) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: string }; meta?: { activeNoteId?: string; activeClaimedAt?: string; activeLockAgeMs?: number } }
          | null;
        if (body?.error?.code === 'recording_locked' && body.meta?.activeNoteId) {
          return {
            kind: 'lock-conflict',
            activeNoteId: body.meta.activeNoteId,
            activeClaimedAt: body.meta.activeClaimedAt ?? new Date().toISOString(),
            activeLockAgeMs: body.meta.activeLockAgeMs ?? 0,
          };
        }
      }
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return {
        kind: 'error',
        message: body?.error?.message ?? `realtime-key returned ${res.status}`,
      };
    },
    [noteId, clientNonce],
  );

  /** Open (or reopen) a WS with the given key data. Shared by start() and
   *  resume()/reconnect(). Attaches the standard event handlers. */
  const openWebSocket = useCallback((keyData: SonioxKeyData) => {
    if (keyData.stub) return; // stub mode — no WS

    const ws = new WebSocket(keyData.websocketUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ api_key: keyData.apiKey, ...keyData.config }));
    };

    ws.onmessage = (e) => parseSonioxMessage(e.data, setTranscript, setPartial);

    ws.onerror = () => {
      // onerror is always followed by onclose — handle everything there.
    };

    ws.onclose = () => {
      // Expected close: we called teardown() or pause(). Do nothing.
      if (wsClosedByUsRef.current) {
        wsClosedByUsRef.current = false;
        return;
      }

      // Unexpected close during active recording — try to reconnect.
      setState((s) => {
        if (s.kind !== 'recording' && s.kind !== 'reconnecting') return s;
        const attempt = reconnectAttemptsRef.current + 1;
        if (attempt > MAX_RECONNECT_ATTEMPTS) {
          return { kind: 'error', reason: 'transcription disconnected' };
        }
        return { kind: 'reconnecting', startedAt: startedAtRef.current, isStub: isStubRef.current, attempt };
      });

      reconnectAttemptsRef.current += 1;
      if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) return;

      reconnectTimerRef.current = setTimeout(async () => {
        try {
          // Reconnect re-uses the same clientNonce; the server sees it as
          // a refresh and bumps `lastHeartbeatAt`. If the lock has been
          // displaced (another device took over while we were offline)
          // the server returns 410-shaped 409; we surface the conflict
          // instead of silently dropping audio.
          const result = await requestRealtimeKey();
          if (result.kind === 'lock-conflict') {
            setState({
              kind: 'lock-conflict',
              activeNoteId: result.activeNoteId,
              activeClaimedAt: result.activeClaimedAt,
              activeLockAgeMs: result.activeLockAgeMs,
            });
            return;
          }
          if (result.kind === 'error') throw new Error(result.message);
          const data = result.data;
          const freshKey: SonioxKeyData = {
            apiKey: data.apiKey,
            websocketUrl: data.websocketUrl,
            config: data.config,
            stub: data.stub,
          };
          lastKeyDataRef.current = freshKey;
          // Self-call for reconnect — noteId is stable for a WS session, so
          // the closure-captured openWebSocket is the correct binding.
          // eslint-disable-next-line react-hooks/immutability
          openWebSocket(freshKey);
          setState((s) =>
            s.kind === 'reconnecting'
              ? { kind: 'recording', startedAt: s.startedAt, isStub: s.isStub }
              : s,
          );
          reconnectAttemptsRef.current = 0;
        } catch {
          setState({ kind: 'error', reason: 'transcription reconnect failed' });
        }
      }, RECONNECT_DELAY_MS);
    };
  }, [noteId, requestRealtimeKey]);

  const start = useCallback(async () => {
    if (
      state.kind !== 'idle' &&
      state.kind !== 'error' &&
      state.kind !== 'lock-conflict'
    )
      return;
    setState({ kind: 'requesting-mic' });

    try {
      // 1. Mint ephemeral key via the server (server flips Note → RECORDING).
      // Pass takeover=true exactly once when the user has confirmed the
      // takeover AlertDialog. The flag is consumed here so a subsequent
      // organic start() doesn't accidentally displace someone else.
      const takeover = pendingTakeoverRef.current;
      pendingTakeoverRef.current = false;
      const result = await requestRealtimeKey({ takeover });
      if (result.kind === 'lock-conflict') {
        setState({
          kind: 'lock-conflict',
          activeNoteId: result.activeNoteId,
          activeClaimedAt: result.activeClaimedAt,
          activeLockAgeMs: result.activeLockAgeMs,
        });
        return;
      }
      if (result.kind === 'error') throw new Error(result.message);
      const data = result.data;
      const keyData: SonioxKeyData = {
        apiKey: data.apiKey,
        websocketUrl: data.websocketUrl,
        config: data.config,
        stub: data.stub,
      };
      lastKeyDataRef.current = keyData;
      isStubRef.current = data.stub;
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

      // 3. WebSocket to Soniox (skipped in stub mode).
      openWebSocket(keyData);

      // 4. Pump worklet output → WS + collect for the final upload.
      worklet.port.onmessage = (e) => {
        const { samples, rmsLevel } = e.data as { samples: Int16Array; rmsLevel: number };
        audioLevelRef.current = rmsLevel;
        if (isPausedRef.current) return;
        audioBuffersRef.current.push(samples);
        // Track WAV bytes incrementally — 16-bit PCM = 2 bytes per
        // sample. The `+0` against the React state lags by one tick
        // but the auto-stop interval reads the buffers directly via
        // estimateAccumulatedWavBytes, so the cap fires precisely.
        setAccumulatedBytes((prev) => prev + samples.length * 2);
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(samples.buffer);
      };
      source.connect(worklet);

      const startedAt = Date.now();
      startedAtRef.current = startedAt;
      recordingStartedAtRef.current = startedAt;
      accumulatedPausedMsRef.current = 0;
      reconnectAttemptsRef.current = 0;
      setState({ kind: 'recording', startedAt, isStub: data.stub });
    } catch (e) {
      teardown();
      setState({ kind: 'error', reason: e instanceof Error ? e.message : String(e) });
    }
  }, [noteId, state.kind, teardown, openWebSocket, requestRealtimeKey]);

  const pause = useCallback(() => {
    if (state.kind !== 'recording') return;
    isPausedRef.current = true;
    pausedAtRef.current = Date.now();

    // Close the WS intentionally so Soniox doesn't idle-timeout during a long
    // pause and trigger a spurious reconnect. We'll re-open on resume.
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)) {
      wsClosedByUsRef.current = true;
      wsRef.current.close();
      wsRef.current = null;
    }

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
    if (pausedAtRef.current != null) {
      accumulatedPausedMsRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }
    const original = recordingStartedAtRef.current ?? Date.now();
    const startedAt = original + accumulatedPausedMsRef.current;
    startedAtRef.current = startedAt;

    // Re-mint a fresh key (the previous one may have expired) and reopen WS.
    try {
      const keyRes = await fetch(`/api/notes/${noteId}/recording-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume' }),
      }).catch(() => null);
      void keyRes; // fire-and-forget for audit; we handle the WS separately

      const result = await requestRealtimeKey();
      if (result.kind === 'lock-conflict') {
        // While paused, another device claimed the lock. Don't silently
        // resume — flip into the conflict UI so the clinician chooses.
        setState({
          kind: 'lock-conflict',
          activeNoteId: result.activeNoteId,
          activeClaimedAt: result.activeClaimedAt,
          activeLockAgeMs: result.activeLockAgeMs,
        });
        return;
      }
      if (result.kind === 'ok') {
        const data = result.data;
        const freshKey: SonioxKeyData = {
          apiKey: data.apiKey,
          websocketUrl: data.websocketUrl,
          config: data.config,
          stub: data.stub,
        };
        lastKeyDataRef.current = freshKey;
        openWebSocket(freshKey);
      }
    } catch {
      // WS re-open is best-effort; audio recording continues regardless.
    }

    setState({ kind: 'recording', startedAt, isStub });
  }, [noteId, state.kind, isStub, openWebSocket, requestRealtimeKey]);

  const finish = useCallback(async () => {
    if (state.kind !== 'recording' && state.kind !== 'paused') return;
    setState({ kind: 'finalizing' });

    try {
      // Stop new audio from flowing to the WS, then wait briefly so Soniox can
      // finalize any in-flight tokens before we tear down the connection.
      isPausedRef.current = true;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        await new Promise<void>((resolve) => setTimeout(resolve, WS_DRAIN_WAIT_MS));
      }

      const chunkCount = audioBuffersRef.current.length;
      const totalSamples = audioBuffersRef.current.reduce((n, c) => n + c.length, 0);
      const wavBlob = encodeWavBlob(audioBuffersRef.current, SAMPLE_RATE);
      console.info(
        `[capture] finalize: chunks=${chunkCount} samples=${totalSamples} wavBytes=${wavBlob.size}`,
      );
      setFinalAudioBlob(wavBlob);

      const formData = new FormData();
      formData.append(
        'finalTranscript',
        JSON.stringify({ segments: transcript, partial }),
      );
      formData.append('audio', wavBlob, 'capture.wav');
      // When the runaway-recording guard fired, forward the reason so
      // RECORDING_FINALIZED audit metadata can record an auto-stop
      // distinct from a normal clinician-initiated finish.
      if (autoStopReasonRef.current) {
        formData.append('autoStopReason', autoStopReasonRef.current);
      }
      // Single-concurrent-recording lock — the server validates this
      // matches the active lock for the user before accepting the
      // upload. If the lock has been taken over we get 410 + a
      // friendly "another device took over" error.
      if (clientNonce) {
        formData.append('clientNonce', clientNonce);
      }

      const res = await fetch(`/api/notes/${noteId}/complete-stream`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: string; message?: string } }
          | null;
        const code = body?.error?.code;
        if (code === 'audio_missing') {
          throw new Error(
            'No audio was captured for this recording. Check that your microphone is connected and not muted, then record again.',
          );
        }
        if (code === 'audio_too_large') {
          // Triggered when the multipart payload exceeds
          // experimental.proxyClientMaxBodySize OR the route's own
          // MAX_AUDIO_BYTES guard. The server message is already
          // user-friendly; passing it through verbatim.
          throw new Error(
            body?.error?.message ??
              'Recording is too large to upload in one request. Stop the recording sooner.',
          );
        }
        if (code === 'recording_lock_lost') {
          // Anti-credential-sharing defense: another device on this
          // account took over while we were finishing. Surface a
          // clear, calm message — the clinician's audio is safe in
          // their browser memory; the OTHER device will end with the
          // active recording.
          throw new Error(
            body?.error?.message ??
              'This recording was taken over on another device. Use that device to finish the visit.',
          );
        }
        throw new Error(
          body?.error?.message ?? `Couldn't finalize the recording (${res.status}).`,
        );
      }

      teardown();
      setState({ kind: 'complete' });
    } catch (e) {
      setState({ kind: 'error', reason: e instanceof Error ? e.message : String(e) });
    }
  }, [noteId, partial, state.kind, teardown, transcript, clientNonce]);

  // Runaway-recording guard. While the state machine is in 'recording'
  // (paused does NOT tick — the elapsed clock is tied to state.startedAt
  // which has already been adjusted for paused time), poll once per
  // second and force-finish if either the time cap (90 min) or the
  // size cap (200 MB) has been reached. The 1 s cadence is cheap (one
  // arithmetic check) and bounds the worst-case overrun to ~1 s past
  // the cap, which the server's MAX_AUDIO_BYTES handles trivially.
  //
  // Why poll: the worklet onmessage handler sees every chunk but
  // can't call hooks. Computing in an effect keeps the auto-stop
  // logic colocated with the rest of the state machine + lets a
  // future override (e.g. an admin-configured longer cap) thread
  // through one source of truth.
  useEffect(() => {
    if (state.kind !== 'recording') return;
    const startedAt = state.startedAt;
    const tick = () => {
      const elapsedMs = Date.now() - startedAt;
      const accumulated = estimateAccumulatedWavBytes(audioBuffersRef.current);
      const reason = shouldAutoStop({
        elapsedMs,
        accumulatedBytes: accumulated,
      });
      if (!reason) return;
      // Mark the reason synchronously so the in-flight finish() can
      // forward it to the server, then trigger the stop. The state
      // machine's `if (state.kind !== 'recording' && ...)` guard in
      // finish() ensures double-fire is harmless.
      autoStopReasonRef.current = reason;
      setAutoStopReason(reason);
      void finish();
    };
    const interval = setInterval(tick, 1_000);
    return () => clearInterval(interval);
  }, [state.kind, state.kind === 'recording' ? (state as { startedAt: number }).startedAt : 0, finish]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Take over the recording lock from another device on the same account.
   * Sets the pending-takeover flag, resets the local state machine to
   * idle (so start() will accept), and triggers a fresh start. The next
   * realtime-key call ships `takeover: true` exactly once; the server
   * displaces the prior lock and audits RECORDING_LOCK_TAKEOVER.
   *
   * The displaced device's next request sees the lock has moved and
   * surfaces a "this recording was taken over on another device" UI on
   * its side.
   */
  const confirmTakeover = useCallback(async () => {
    if (state.kind !== 'lock-conflict') return;
    pendingTakeoverRef.current = true;
    // Reset local state to idle so the start() guard accepts. We don't
    // call reset() because it clears transcript + audio buffers — we
    // want to start fresh anyway, but reset() does that AND more,
    // which is correct here.
    teardown();
    audioBuffersRef.current = [];
    isPausedRef.current = false;
    setState({ kind: 'idle' });
    await start();
  }, [state.kind, teardown, start]);

  const reset = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    teardown();
    audioBuffersRef.current = [];
    isPausedRef.current = false;
    recordingStartedAtRef.current = null;
    pausedAtRef.current = null;
    accumulatedPausedMsRef.current = 0;
    reconnectAttemptsRef.current = 0;
    lastKeyDataRef.current = null;
    autoStopReasonRef.current = null;
    setAutoStopReason(null);
    setAccumulatedBytes(0);
    setTranscript([]);
    setPartial('');
    setAudioLevel(0);
    audioLevelRef.current = 0;
    setFinalAudioBlob(null);
    setState({ kind: 'idle' });
  }, [teardown]);

  const value = useMemo<CaptureStateValue>(
    () => ({
      state,
      audioLevel,
      transcript,
      partial,
      finalAudioBlob,
      accumulatedBytes,
      autoStopReason,
      start,
      pause,
      resume,
      finish,
      reset,
      confirmTakeover,
      isStub,
    }),
    [
      state,
      audioLevel,
      transcript,
      partial,
      finalAudioBlob,
      accumulatedBytes,
      autoStopReason,
      start,
      pause,
      resume,
      finish,
      reset,
      confirmTakeover,
      isStub,
    ],
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
  return {
    start: c.start,
    pause: c.pause,
    resume: c.resume,
    finish: c.finish,
    reset: c.reset,
    confirmTakeover: c.confirmTakeover,
  };
}
export function useStubBanner() {
  return useCapture().isStub;
}

/** Live limit state for the warning banner + countdown copy in
 *  RecordingControls. Subscribed separately so a component that only
 *  cares about elapsed/size doesn't re-render on transcript ticks. */
export function useRecordingLimitState() {
  const c = useCapture();
  return {
    accumulatedBytes: c.accumulatedBytes,
    autoStopReason: c.autoStopReason,
  };
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
    const finals: Array<{ text: string; speaker: number | null }> = [];
    let runningPartial = '';
    for (const tok of tokens) {
      if (tok.is_final) {
        finals.push({ text: tok.text, speaker: tok.speaker ?? null });
      } else {
        runningPartial += tok.text;
      }
    }
    if (finals.length) {
      setTranscript((prev) => {
        const next = prev.slice();
        for (const f of finals) {
          const last = next[next.length - 1];
          if (last && last.isFinal && last.speaker === f.speaker) {
            next[next.length - 1] = { ...last, text: last.text + f.text };
          } else {
            next.push({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              text: f.text,
              speaker: f.speaker,
              isFinal: true,
            });
          }
        }
        return next;
      });
    }
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
