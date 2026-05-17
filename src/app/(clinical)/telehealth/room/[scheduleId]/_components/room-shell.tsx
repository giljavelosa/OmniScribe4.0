'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mic, MicOff, PhoneOff, Video } from 'lucide-react';

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
 * Clinician-side telehealth room. Owns:
 *   - Daily iframe (left pane)
 *   - TelehealthAudioPipeline lifecycle (Unit 16 lib) — clinician mic on,
 *     patient track null until Daily SDK is wired in a future commit
 *   - Live transcript pane + brief panel (right pane)
 *   - Mic mute + End-call controls (bottom bar)
 *
 * End-call wiring (Commit 5) replaces handleEndCall's TODO with the real
 * complete-stream → end-session → /processing handoff. This commit just
 * lights up the live experience so the surface is reviewable in isolation
 * before the post-call flow lands.
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

  const pipelineRef = useRef<TelehealthAudioPipeline | null>(null);
  const clinicianStreamRef = useRef<MediaStream | null>(null);
  const clinicianTrackRef = useRef<MediaStreamTrack | null>(null);

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

  // Boot the pipeline on mount. The clinical layout already gated auth,
  // so this fires once per room visit.
  useEffect(() => {
    let cancelled = false;
    async function init() {
      setStage('requesting-mic');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: TELEHEALTH_AUDIO_SAMPLE_RATE,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        if (cancelled) {
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
          // v1: synthetic null. Daily SDK integration will pass the real
          // patient track when wired (one-line change at the call site;
          // the pipeline accepts it without changes).
          patientTrack: null,
        });
        if (!cancelled) setStage('live');
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setStage('error');
        }
      }
    }
    void init();
    return () => {
      cancelled = true;
      const pipeline = pipelineRef.current;
      const stream = clinicianStreamRef.current;
      pipelineRef.current = null;
      clinicianStreamRef.current = null;
      clinicianTrackRef.current = null;
      void pipeline?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [noteId, handleTranscript, handleReconnected]);

  function toggleMute() {
    const track = clinicianTrackRef.current;
    if (!track) return;
    // track.enabled === true means audio flows; we flip it.
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

      // 1. Stop pipeline first — closes WS, tears down audio, prevents
      //    new samples from being retained while we're encoding.
      await pipeline.stop();

      // 2. Encode retained samples to a WAV. Note: if the call ended
      //    before any audio flowed (mic denied, immediate end-click),
      //    the WAV is header-only (44 bytes) which is still a valid
      //    submission — complete-stream's empty-blob check is
      //    `size === 0`, and 44 > 0.
      const chunks = pipeline.drainRetainedSamples();
      const wav = encodeWavBlob(chunks, TELEHEALTH_AUDIO_SAMPLE_RATE);

      // 3. Hand the audio + transcript to the existing post-recording
      //    pipeline (same endpoint the in-person flow uses). Flips Note
      //    RECORDING → TRANSCRIBING and enqueues the transcription
      //    worker; the rest of the note-generation flow takes over.
      const form = new FormData();
      form.append('audio', wav, 'telehealth.wav');
      form.append('finalTranscript', JSON.stringify({ segments: transcript, partial }));
      const completeRes = await fetch(`/api/notes/${noteId}/complete-stream`, {
        method: 'POST',
        body: form,
      });
      if (!completeRes.ok) {
        throw new Error(`Saving the visit audio failed (${completeRes.status}). Please try ending the call again.`);
      }

      // 4. Flip the session to COMPLETED + destroy the Daily room. If
      //    this fails after a successful complete-stream, the audio is
      //    already durable — we navigate to /processing and surface a
      //    background banner instead of blocking the clinician on the
      //    end-call modal.
      const endRes = await fetch(`/api/admin/telehealth/sessions/${sessionId}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'clinician_ended' }),
      });
      if (!endRes.ok) {
        // Best-effort log; don't fail the user-facing flow.
        console.warn(`telehealth: end-session returned ${endRes.status}`);
      }

      // 5. Hand off to the standard post-call screen.
      setStage('ended');
      router.push(`/processing/${noteId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('error');
    }
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
            {partial && (
              <p className="text-muted-foreground italic">{partial}</p>
            )}
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
