'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import { Mic, MicOff, CheckCircle2, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBanner } from '@/components/ui/status-banner';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { encodeWavBlob } from '@/lib/audio/wav-encoder';

type EnrollmentState =
  | { enrolled: false }
  | {
      enrolled: true;
      hasEmbedding: boolean;
      consentVersion: string;
      enrolledAt: string;
      displayName?: string;
    };

type Props = {
  currentConsentVersion: string;
  enrollment: EnrollmentState;
};

const SAMPLE_RATE = 16_000;
const MIN_DURATION_MS = 20_000; // 20 s minimum — 30 s recommended
const MAX_DURATION_MS = 90_000; // 90 s hard cap

/**
 * VoiceEnrollmentClient — voice-profile enrollment UI.
 *
 * States:
 *   not-enrolled     → shows BIPA consent card (checkbox + Record button)
 *   recording        → shows timer + level meter + Stop button
 *   review           → shows waveform summary + Submit / Re-record
 *   enrolled         → shows status card + Re-record / Revoke options
 *
 * Rule 22: no native confirm() — all destructive actions go through AlertDialog.
 */
export function VoiceEnrollmentClient({ currentConsentVersion, enrollment }: Props) {
  const [localEnrollment, setLocalEnrollment] = useState<EnrollmentState>(enrollment);
  const [phase, setPhase] = useState<'idle' | 'consent' | 'recording' | 'review' | 'submitting' | 'done'>(
    enrollment.enrolled ? 'done' : 'idle',
  );
  const [consentChecked, setConsentChecked] = useState(false);
  const [displayName, setDisplayName] = useState(
    enrollment.enrolled && 'displayName' in enrollment ? (enrollment.displayName ?? '') : '',
  );
  const [recordingMs, setRecordingMs] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [, startSubmit] = useTransition();

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioBuffersRef = useRef<Int16Array[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopRecording = useCallback(async () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    workletRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (audioContextRef.current?.state !== 'closed') {
      await audioContextRef.current?.close().catch(() => {});
    }
    workletRef.current = null;
    sourceNodeRef.current = null;
    mediaStreamRef.current = null;
    audioContextRef.current = null;

    const wav = encodeWavBlob(audioBuffersRef.current, SAMPLE_RATE);
    audioBuffersRef.current = [];
    setAudioBlob(wav);
    setPhase('review');
  }, []);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: true },
      });
      mediaStreamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = ctx;
      await ctx.audioWorklet.addModule('/audio/pcm-worklet.js');
      const source = ctx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      const worklet = new AudioWorkletNode(ctx, 'pcm-worklet');
      workletRef.current = worklet;
      worklet.port.onmessage = (e) => {
        const { samples } = e.data as { samples: Int16Array };
        audioBuffersRef.current.push(samples);
      };
      source.connect(worklet);

      audioBuffersRef.current = [];
      setRecordingMs(0);
      setPhase('recording');
      const start = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - start;
        setRecordingMs(elapsed);
        if (elapsed >= MAX_DURATION_MS) void stopRecording();
      }, 500);
    } catch (err) {
      setError(`Mic access failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleSubmit() {
    if (!audioBlob) return;
    setError(null);
    setPhase('submitting');
    startSubmit(async () => {
      // 1. Record consent.
      const consentRes = await fetch('/api/me/voice-profile/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consentVersion: currentConsentVersion, displayName: displayName.trim() || undefined }),
      });
      if (!consentRes.ok) {
        setError('Consent recording failed — please try again.');
        setPhase('review');
        return;
      }

      // 2. Upload enrollment audio.
      const form = new FormData();
      form.append('audio', audioBlob, 'enrollment.wav');
      const enrollRes = await fetch('/api/me/voice-profile/enroll', { method: 'POST', body: form });
      if (!enrollRes.ok) {
        const body = await enrollRes.json().catch(() => null);
        setError(body?.error?.message ?? 'Enrollment failed — please try again.');
        setPhase('review');
        return;
      }

      setLocalEnrollment({
        enrolled: true,
        hasEmbedding: false, // worker runs async
        consentVersion: currentConsentVersion,
        enrolledAt: new Date().toISOString(),
        displayName: displayName.trim() || undefined,
      });
      setPhase('done');
    });
  }

  async function handleRevoke() {
    setRevokeOpen(false);
    const res = await fetch('/api/me/voice-profile', { method: 'DELETE' });
    if (!res.ok) { setError('Revoke failed — please try again.'); return; }
    setLocalEnrollment({ enrolled: false });
    setPhase('idle');
    setConsentChecked(false);
    setAudioBlob(null);
    setDisplayName('');
  }

  // ---------- Render ----------

  if (phase === 'done' && localEnrollment.enrolled) {
    const e = localEnrollment as Extract<EnrollmentState, { enrolled: true }>;
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-[var(--status-success-fg)]" aria-hidden />
            <p className="font-medium">Voice profile active</p>
          </div>
          {e.displayName && <p className="text-sm text-muted-foreground">{e.displayName}</p>}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <StatusBadge variant={e.hasEmbedding ? 'success' : 'warning'} noIcon>
              {e.hasEmbedding ? 'Embedding ready' : 'Embedding processing…'}
            </StatusBadge>
            <span>Enrolled {new Date(e.enrolledAt).toLocaleDateString()}</span>
            <span>Consent {e.consentVersion}</span>
          </div>
          {!e.hasEmbedding && (
            <StatusBanner variant="info" className="text-xs">
              Voice-ID embedding is computing in the background — typically takes 1–2 minutes.
              Speaker labels will appear on the next visit&apos;s transcript.
            </StatusBanner>
          )}
        </div>
        {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setPhase('consent'); }} className="gap-2">
            <RefreshCw className="h-4 w-4" aria-hidden /> Re-record
          </Button>
          <Button variant="ghost" onClick={() => setRevokeOpen(true)} className="gap-2 text-[var(--status-danger-fg)]">
            <Trash2 className="h-4 w-4" aria-hidden /> Revoke enrollment
          </Button>
        </div>

        <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke voice enrollment?</AlertDialogTitle>
              <AlertDialogDescription>
                Your voice embedding will be deleted within 30 days per BIPA requirements.
                Speaker labels on future transcripts will revert to numeric (S1, S2).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleRevoke()} className="bg-[var(--status-danger-fg)] text-white">
                Yes, revoke
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (phase === 'recording') {
    const durationSec = Math.floor(recordingMs / 1000);
    const tooShort = recordingMs < MIN_DURATION_MS;
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-center">
          <Mic className="h-10 w-10 mx-auto text-[var(--status-danger-fg)] animate-pulse" aria-hidden />
          <p className="font-medium">Recording… {durationSec}s</p>
          <p className="text-xs text-muted-foreground">Speak naturally for 30–60 seconds.</p>
          {tooShort && (
            <p className="text-xs text-[var(--status-warning-fg)]">
              Keep going — aim for at least 20 seconds.
            </p>
          )}
        </div>
        <Button
          onClick={() => void stopRecording()}
          disabled={tooShort}
          className="w-full"
        >
          Stop recording
        </Button>
      </div>
    );
  }

  if (phase === 'review') {
    return (
      <div className="space-y-4">
        <StatusBanner variant="success">
          Recording complete ({audioBlob ? Math.round(audioBlob.size / 1024) : 0} KB).
          Submit to enroll, or re-record if you want a better sample.
        </StatusBanner>
        {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        <div className="flex gap-2">
          <Button onClick={handleSubmit} disabled={phase !== 'review'} className="flex-1">
            Submit enrollment
          </Button>
          <Button
            variant="outline"
            onClick={() => { setAudioBlob(null); setPhase('consent'); }}
          >
            Re-record
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'submitting') {
    return <StatusBanner variant="info">Submitting enrollment…</StatusBanner>;
  }

  // idle / consent
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <p className="text-sm font-medium">BIPA biometric data consent</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          OmniScribe will collect and store a biometric voice &quot;embedding&quot; — a 192-number mathematical
          representation of your voice. It is used solely for labeling transcript speakers in your
          clinical notes. The embedding is stored in our encrypted database; the original audio sample
          is retained for 7 years per HIPAA and never shared. You may revoke enrollment at any time;
          the embedding will be deleted within 30 days.
        </p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={(e) => setConsentChecked(e.target.checked)}
            className="mt-0.5"
            aria-label="I consent to biometric voice data collection"
          />
          <span className="text-sm">
            I have read and agree to the biometric data collection described above
            (consent version {currentConsentVersion}).
          </span>
        </label>
      </div>

      <div className="space-y-2">
        <Label htmlFor="display-name">Display name (optional)</Label>
        <Input
          id="display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Dr. Smith"
          maxLength={80}
        />
        <p className="text-xs text-muted-foreground">
          Shown in enrollment status — not used in transcripts.
        </p>
      </div>

      {error && <StatusBanner variant="danger">{error}</StatusBanner>}

      <Button
        onClick={() => { setPhase('consent'); void startRecording(); }}
        disabled={!consentChecked}
        className="w-full gap-2"
      >
        <Mic className="h-4 w-4" aria-hidden />
        Start recording voice sample
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        Speak naturally for 30–60 seconds — read aloud, describe a patient case, or talk about your
        day. The recording is used only to create your embedding.
      </p>
    </div>
  );
}
