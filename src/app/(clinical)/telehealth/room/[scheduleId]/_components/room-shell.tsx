'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mic, MicOff, PhoneOff, RotateCw, Video } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { encodeWavBlob } from '@/lib/audio/wav-encoder';
import {
  TELEHEALTH_AUDIO_SAMPLE_RATE,
  TelehealthAudioPipeline,
  type ConnectionState,
} from '@/lib/telehealth/audio-pipeline';
import type { PriorContextBriefContent } from '@/types/brief';

type Stage = 'idle' | 'requesting-mic' | 'live' | 'ending' | 'ended' | 'error';

type TranscriptSegment = {
  id: string;
  text: string;
  speaker: number | null;
  isFinal: boolean;
};

type Props = {
  noteId: string;
  scheduleId: string;
  sessionId: string;
  roomUrl: string;
  patient: { id: string; firstName: string; lastName: string; mrn: string | null };
  brief: PriorContextBriefContent | null;
};

/**
 * Clinician-side telehealth room.
 *
 * Unit 18 polish on top of Unit 17 base:
 *   - Inline reconnecting banner during transient WS drops.
 *   - Failed banner + "Retry connection" button after auto-retries exhaust.
 *   - Rejoin banner on page reload mid-call (sessionStorage flag) so the
 *     clinician knows audio from the prior tab wasn't recovered.
 *   - Call quality metrics packaged into the /end POST so the auditor
 *     lens can see sample count, reconnect count, duration, transcript
 *     length per session.
 */
export function TelehealthRoomShell({ noteId, scheduleId, sessionId, roomUrl, patient, brief }: Props) {
  void scheduleId;
  void brief;
  const router = useRouter();

  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [partial, setPartial] = useState('');
  const [muted, setMuted] = useState(false);
  const [connState, setConnState] = useState<ConnectionState>('idle');
  const [rejoining, setRejoining] = useState(false);

  const pipelineRef = useRef<TelehealthAudioPipeline | null>(null);
  const clinicianStreamRef = useRef<MediaStream | null>(null);
  const clinicianTrackRef = useRef<MediaStreamTrack | null>(null);
  // Cache the encoded WAV so an end-call retry replays it instead of
  // re-draining the (already-empty) pipeline buffer.
  const encodedWavRef = useRef<Blob | null>(null);
  const startedAtMsRef = useRef<number | null>(null);
  // Cancellation flag for the mount-time startPipeline so a fast unmount
  // (e.g., user navigates away during the getUserMedia permission prompt)
  // doesn't leak a mic + WebSocket when the promise eventually resolves.
  const cancelledRef = useRef(false);
  // Accumulate quality metrics across manual-retry pipelines so the
  // pre-retry sample/reconnect counts don't get lost when a new pipeline
  // instance replaces the old one with zeroed counters.
  const accumulatedMetricsRef = useRef<{ sampleChunksProcessed: number; reconnectCount: number }>(
    { sampleChunksProcessed: 0, reconnectCount: 0 },
  );
  const sessionStorageKey = `telehealth-room-${sessionId}`;

  const handleTranscript = useCallback((seg: { text: string; isFinal: boolean; speaker: number | null }) => {
    if (seg.isFinal) {
      setTranscript((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text: seg.text,
          speaker: seg.speaker,
          isFinal: true,
        },
      ]);
      setPartial('');
    } else {
      setPartial(seg.text);
    }
  }, []);

  const handleReconnected = useCallback(() => {
    void fetch('/api/audit/copilot-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'TELEHEALTH_AUDIO_RECONNECTED',
        surface: 'telehealth-room',
        noteId,
      }),
    }).catch(() => {});
  }, [noteId]);

  /** Tear down any existing pipeline + start a fresh one. Used by both
   *  the initial mount effect and the manual "Retry connection" button
   *  that appears after the pipeline's 3-attempt auto reconnect gives up. */
  const startPipeline = useCallback(async (): Promise<void> => {
    // Fold the soon-to-be-replaced pipeline's metrics into the accumulator
    // so manual retries don't reset the cumulative quality numbers to zero.
    const prev = pipelineRef.current;
    if (prev) {
      const m = prev.getQualityMetrics();
      accumulatedMetricsRef.current.sampleChunksProcessed += m.sampleChunksProcessed;
      accumulatedMetricsRef.current.reconnectCount += m.reconnectCount;
    }
    // Stop + release whatever's lingering.
    await prev?.stop();
    pipelineRef.current = null;
    clinicianStreamRef.current?.getTracks().forEach((t) => t.stop());
    clinicianStreamRef.current = null;
    clinicianTrackRef.current = null;

    setStage('requesting-mic');
    setError(null);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: TELEHEALTH_AUDIO_SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    // If the component unmounted while getUserMedia was pending, release the
    // stream immediately — the cleanup function already ran and would otherwise
    // leak the mic + WebSocket forever.
    if (cancelledRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    clinicianStreamRef.current = stream;
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('Mic returned no audio track');
    clinicianTrackRef.current = track;

    const pipeline = new TelehealthAudioPipeline({
      retainSamples: true,
      onTranscript: handleTranscript,
      onConnectionChange: setConnState,
      onReconnected: handleReconnected,
      onError: (e) => setError(e.message),
    });
    pipelineRef.current = pipeline;
    await pipeline.start({
      noteId,
      clinicianTrack: track,
      patientTrack: null,
    });
    if (cancelledRef.current) {
      await pipeline.stop();
      pipelineRef.current = null;
      stream.getTracks().forEach((t) => t.stop());
      clinicianStreamRef.current = null;
      clinicianTrackRef.current = null;
      return;
    }
    startedAtMsRef.current ??= Date.now();
    setMuted(false);
    setStage('live');
  }, [handleTranscript, handleReconnected, noteId]);

  // Initial mount: detect re-entry via sessionStorage + boot the pipeline.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.sessionStorage.getItem(sessionStorageKey)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRejoining(true);
    }
    try {
      window.sessionStorage.setItem(sessionStorageKey, Date.now().toString());
    } catch {
      // sessionStorage may be unavailable in restricted contexts; silently skip.
    }
    cancelledRef.current = false;
    void startPipeline().catch((e: unknown) => {
      if (cancelledRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setStage('error');
    });
    return () => {
      cancelledRef.current = true;
      const pipeline = pipelineRef.current;
      const stream = clinicianStreamRef.current;
      pipelineRef.current = null;
      clinicianStreamRef.current = null;
      clinicianTrackRef.current = null;
      void pipeline?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [sessionStorageKey, startPipeline]);

  function toggleMute() {
    const track = clinicianTrackRef.current;
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }

  async function endCall() {
    if (stage === 'ending' || stage === 'ended') return;
    setStage('ending');
    setError(null);
    const pipeline = pipelineRef.current;
    try {
      if (!pipeline) throw new Error('audio pipeline missing');

      const currentMetrics = pipeline.getQualityMetrics();
      const qualityMetrics = {
        ...currentMetrics,
        sampleChunksProcessed:
          accumulatedMetricsRef.current.sampleChunksProcessed + currentMetrics.sampleChunksProcessed,
        reconnectCount:
          accumulatedMetricsRef.current.reconnectCount + currentMetrics.reconnectCount,
      };
      const callDurationMs =
        startedAtMsRef.current != null ? Date.now() - startedAtMsRef.current : 0;

      // stop() is idempotent so a retry after a complete-stream failure is safe.
      await pipeline.stop();

      // drainRetainedSamples destroys the internal buffer on first call, so
      // cache the encoded blob on the ref and replay it on retry — otherwise
      // a complete-stream failure followed by a retry would submit a 44-byte
      // header-only WAV, silently losing the entire visit's recording.
      let wav = encodedWavRef.current;
      if (!wav) {
        const chunks = pipeline.drainRetainedSamples();
        wav = encodeWavBlob(chunks, TELEHEALTH_AUDIO_SAMPLE_RATE);
        encodedWavRef.current = wav;
      }

      const form = new FormData();
      form.append('audio', wav, 'telehealth.wav');
      form.append('finalTranscript', JSON.stringify({ segments: transcript, partial }));
      const completeRes = await fetch(`/api/notes/${noteId}/complete-stream`, {
        method: 'POST',
        body: form,
      });
      if (!completeRes.ok) {
        throw new Error(
          `Saving the visit audio failed (${completeRes.status}). Please try ending the call again.`,
        );
      }

      const endRes = await fetch(`/api/admin/telehealth/sessions/${sessionId}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'clinician_ended',
          qualityMetrics: {
            ...qualityMetrics,
            callDurationMs,
            transcriptSegmentCount: transcript.length,
          },
        }),
      });
      if (!endRes.ok) {
        console.warn(`telehealth: end-session returned ${endRes.status}`);
      }

      // Clear the rejoin flag — the session ended cleanly.
      try {
        window.sessionStorage.removeItem(sessionStorageKey);
      } catch {
        /* ignore */
      }

      setStage('ended');
      router.push(`/processing/${noteId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('error');
    }
  }

  function retryConnection() {
    setConnState('idle');
    void startPipeline().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setStage('error');
    });
  }

  return (
    <div className="h-[calc(100vh-3.25rem)] flex flex-col">
      <header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-md font-semibold truncate">
            {patient.lastName}, {patient.firstName}
          </h1>
          {patient.mrn && <p className="text-xs text-muted-foreground font-mono">{patient.mrn}</p>}
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge variant="info" noIcon>
              <Video className="h-3 w-3 mr-1" aria-hidden />
              Telehealth
            </StatusBadge>
            <ConnectionChip state={connState} stage={stage} />
          </div>
        </div>
      </header>

      {rejoining && stage !== 'ended' && (
        <div className="px-6 pt-3">
          <StatusBanner variant="warning" title="Resuming session">
            We couldn&apos;t recover audio from the previous tab. The transcript will continue from
            now.
          </StatusBanner>
        </div>
      )}

      <div className="flex-1 grid lg:grid-cols-2 min-h-0">
        <section className="bg-black/90 flex flex-col p-2 gap-2">
          <iframe
            title="Telehealth video call"
            src={roomUrl}
            allow="camera; microphone; autoplay; display-capture"
            className="w-full flex-1 rounded-md border-0"
          />
        </section>
        <aside className="border-l border-border flex flex-col min-h-0">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Live transcript
            </p>
          </div>
          {connState === 'reconnecting' && (
            <div className="border-b border-border px-4 py-2 flex items-center gap-2 text-xs text-[var(--status-warning-fg)]">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Connection lost — reconnecting…
            </div>
          )}
          {connState === 'failed' && (
            <div className="border-b border-border p-3 space-y-2">
              <StatusBanner variant="danger" title="Audio disconnected">
                We couldn&apos;t reconnect after several attempts. The video call is still running;
                tap below to retry the audio link.
              </StatusBanner>
              <Button variant="outline" size="sm" onClick={retryConnection} className="gap-1">
                <RotateCw className="h-3 w-3" aria-hidden />
                Retry connection
              </Button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-sm">
            {transcript.length === 0 && partial === '' && stage !== 'error' && (
              <p className="text-muted-foreground italic">
                {stage === 'requesting-mic'
                  ? 'Requesting mic access…'
                  : 'Waiting for the first transcript chunk…'}
              </p>
            )}
            {transcript.map((seg) => (
              <p key={seg.id}>
                {seg.speaker !== null && (
                  <span className="text-[var(--status-info-fg)] mr-2">[S{seg.speaker}]</span>
                )}
                {seg.text}
              </p>
            ))}
            {partial && <p className="text-muted-foreground italic">{partial}</p>}
          </div>
          {error && (
            <div className="border-t border-border p-3">
              <StatusBanner variant="danger">{error}</StatusBanner>
            </div>
          )}
        </aside>
      </div>

      <footer className="border-t border-border bg-card px-6 py-3 flex items-center justify-between gap-4">
        <Button variant="outline" size="sm" onClick={toggleMute} disabled={stage !== 'live'} className="gap-1">
          {muted ? <MicOff className="h-3 w-3" aria-hidden /> : <Mic className="h-3 w-3" aria-hidden />}
          {muted ? 'Unmute' : 'Mute'}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={endCall}
          disabled={stage === 'ending' || stage === 'ended'}
          className="gap-1"
        >
          {stage === 'ending' ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <PhoneOff className="h-3 w-3" aria-hidden />
          )}
          {stage === 'ending' ? 'Ending…' : 'End call'}
        </Button>
      </footer>
    </div>
  );
}

function ConnectionChip({ state, stage }: { state: ConnectionState; stage: Stage }) {
  if (stage === 'ending' || stage === 'ended') {
    return <StatusBadge variant="neutral" noIcon>Ended</StatusBadge>;
  }
  if (state === 'active') return <StatusBadge variant="success" noIcon>Connected</StatusBadge>;
  if (state === 'stub') return <StatusBadge variant="warning" noIcon>Stub mode</StatusBadge>;
  if (state === 'reconnecting') return <StatusBadge variant="warning" noIcon>Reconnecting…</StatusBadge>;
  if (state === 'failed') return <StatusBadge variant="danger" noIcon>Disconnected</StatusBadge>;
  return <StatusBadge variant="neutral" noIcon>{state}</StatusBadge>;
}
