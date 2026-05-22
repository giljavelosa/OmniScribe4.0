'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mic, MicOff, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * LiveCaptureButton — /prepare "Start recording" CTA with mic preflight.
 *
 * Before navigating to /capture, probes navigator.mediaDevices.getUserMedia
 * so the clinician learns about a blocked / missing mic BEFORE leaving the
 * prepare surface (not 3 taps later inside /capture).
 *
 * Happy path: permission already granted or granted on probe → navigate.
 * Error path: permission denied or no device → show AlertDialog with
 *   actionable copy; clinician stays on /prepare.
 *
 * The probe acquires the stream and immediately stops all tracks so no
 * recording starts until the clinician deliberately hits "Start recording"
 * inside /capture.
 *
 * `hero` variant renders a taller button with stronger label for the
 * top-of-page hero card on /prepare.
 *
 * Once /capture loads, the LIVE-mode autostart kicks in (1.5s countdown)
 * so this preflight + the capture page combine into a near-instant
 * "click → recording" experience.
 */
export function LiveCaptureButton({
  noteId,
  disabled,
  hero = false,
}: {
  noteId: string;
  disabled?: boolean;
  hero?: boolean;
}) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [micErrorOpen, setMicErrorOpen] = useState(false);
  const [micErrorReason, setMicErrorReason] = useState('');

  async function handleClick() {
    if (disabled || checking) return;

    // Skip preflight if the browser doesn't support mediaDevices (e.g. HTTP).
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      router.push(`/capture/${noteId}`);
      return;
    }

    setChecking(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Permission granted — stop all tracks immediately (actual recording
      // starts fresh inside /capture's CaptureStateProvider.start()).
      stream.getTracks().forEach((t) => t.stop());
      router.push(`/capture/${noteId}`);
    } catch (err) {
      setChecking(false);
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setMicErrorReason(
          "Microphone access was denied. Open your browser's site settings, allow the mic, then try again.",
        );
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setMicErrorReason(
          'No microphone was found. Connect a mic and reload, or use Upload audio / Paste transcript instead.',
        );
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setMicErrorReason(
          'The microphone is in use by another app. Close the other app and try again.',
        );
      } else {
        setMicErrorReason(
          `Couldn't access the microphone (${name || 'unknown error'}). Check your device and browser settings.`,
        );
      }
      setMicErrorOpen(true);
    }
  }

  return (
    <>
      <Button
        onClick={() => void handleClick()}
        disabled={disabled || checking}
        size={hero ? 'lg' : 'default'}
        className={hero ? 'w-full gap-2 text-base' : 'w-full gap-2'}
      >
        <Mic className={`${hero ? 'h-5 w-5' : 'h-4 w-4'} ${checking ? 'animate-pulse' : ''}`} aria-hidden />
        {checking ? 'Checking mic…' : hero ? 'Start recording' : 'Start recording'}
        {!checking && <ArrowRight className={hero ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden />}
      </Button>

      {/* Mic error — Rule 22: no native alert(). */}
      <AlertDialog open={micErrorOpen} onOpenChange={setMicErrorOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <MicOff className="h-5 w-5 text-[var(--status-danger-fg)]" aria-hidden />
              Microphone unavailable
            </AlertDialogTitle>
            <AlertDialogDescription>{micErrorReason}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setMicErrorOpen(false)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
