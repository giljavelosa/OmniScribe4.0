'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play, Mic, ArrowRight, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/components/ui/status-banner';
import {
  useCaptureControls,
  useRecordingLimitState,
  useRecordingState,
} from '../_hooks/capture-state';
import { LeaveConfirmDialog } from './LeaveConfirmDialog';
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
import {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_MS,
  deriveWarning,
  formatTimeRemaining,
} from '@/lib/audio/recording-limits';

type Props = {
  noteId: string;
  /** When true and the note is LIVE + idle on mount, kick off a short countdown
   *  then auto-invoke `start()` so the clinician doesn't tap a second time. The
   *  countdown is cancellable. Driven by /capture/page.tsx's captureMode === LIVE. */
  autostart?: boolean;
};

/** Auto-start countdown duration (ms). Long enough for the clinician to abort
 *  if they landed here by accident; short enough that it feels like one-tap. */
const AUTOSTART_COUNTDOWN_MS = 1500;

const MAX_RECORDING_MIN = Math.floor(MAX_RECORDING_MS / 60_000);
const MAX_RECORDING_MB = Math.round(MAX_RECORDING_BYTES / (1024 * 1024));

/**
 * RecordingControls — button bar for the capture surface.
 *
 * Button polarity (design-critique-capture-flow.md):
 *   Affirmative action = FILLED PRIMARY (Finish & Review).
 *   Reversible actions = outline (Pause, Resume).
 *   Passive / destructive = ghost (Leave).
 *   Red is reserved for discard — not used here.
 *
 * On error: shows a reset + retry CTA alongside the reason so the clinician
 * has an explicit path back to 'idle' without a full page reload.
 */
export function RecordingControls({ noteId, autostart = false }: Props) {
  const state = useRecordingState();
  const { accumulatedBytes } = useRecordingLimitState();
  const { start, pause, resume, finish, reset, confirmTakeover } =
    useCaptureControls();
  const router = useRouter();
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [takeoverPending, setTakeoverPending] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [autostartMs, setAutostartMs] = useState(AUTOSTART_COUNTDOWN_MS);
  const [autostartActive, setAutostartActive] = useState(autostart);
  const autostartFiredRef = useRef(false);

  // Track elapsed time independently so we can show a max-duration warning
  // without depending on RecordingStatus (single-source rule). Tick every
  // second so the "less than 1 min remaining" countdown stays current; the
  // auto-stop guard inside CaptureStateProvider polls on the same cadence.
  useEffect(() => {
    if (state.kind !== 'recording') return;
    const startedAt = state.startedAt;
    const t = setInterval(() => setElapsedMs(Date.now() - startedAt), 1_000);
    // Initial tick — intentional immediate state set so the UI doesn't show
    // 0 for the first second after the effect runs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setElapsedMs(Date.now() - startedAt);
    return () => clearInterval(t);
  }, [state.kind, state.kind === 'recording' ? (state as { startedAt: number }).startedAt : 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.kind === 'complete') {
      router.push(`/processing/${noteId}`);
    }
  }, [state.kind, noteId, router]);

  // Auto-start countdown — only runs once when the page mounts in idle.
  // Cancels if the clinician taps Cancel or the state moves out of idle for
  // any other reason. Fires `start()` exactly once.
  useEffect(() => {
    if (!autostartActive) return;
    if (state.kind !== 'idle') return;
    if (autostartFiredRef.current) return;

    const tickMs = 100;
    const interval = setInterval(() => {
      setAutostartMs((prev) => {
        const next = prev - tickMs;
        if (next <= 0) {
          clearInterval(interval);
          if (!autostartFiredRef.current) {
            autostartFiredRef.current = true;
            setAutostartActive(false);
            void start();
          }
          return 0;
        }
        return next;
      });
    }, tickMs);

    return () => clearInterval(interval);
  }, [autostartActive, state.kind, start]);

  const isIdle = state.kind === 'idle';
  const isError = state.kind === 'error';
  const isRecording = state.kind === 'recording' || state.kind === 'reconnecting';
  const isPaused = state.kind === 'paused';
  const isBusy = state.kind === 'requesting-mic' || state.kind === 'finalizing';
  const warning =
    isRecording || isPaused
      ? deriveWarning({ elapsedMs, accumulatedBytes })
      : 'none';
  const showMaxWarning = warning !== 'none';
  const isCritical = warning === 'time_critical' || warning === 'size_critical';

  if (state.kind === 'lock-conflict') {
    // Anti-credential-sharing defense: another device on this account
    // is currently recording. Surface as a warning banner + an explicit
    // takeover AlertDialog. Rule 22: no native confirm() in clinical
    // surfaces — AlertDialog is required.
    const ageSec = Math.max(1, Math.round(state.activeLockAgeMs / 1000));
    const ageLabel =
      ageSec < 60
        ? `${ageSec} second${ageSec === 1 ? '' : 's'} ago`
        : `${Math.round(ageSec / 60)} minute${Math.round(ageSec / 60) === 1 ? '' : 's'} ago`;

    return (
      <div className="space-y-2 w-full">
        <StatusBanner variant="warning">
          Another device on this account started a recording {ageLabel} and is
          still active. Two devices can&apos;t record at once on the same
          account.
        </StatusBanner>
        <div className="flex items-center gap-3">
          <AlertDialog open={takeoverPending} onOpenChange={setTakeoverPending}>
            <Button onClick={() => setTakeoverPending(true)} className="gap-2">
              <Mic className="h-4 w-4" aria-hidden />
              Take over from this device
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Take over the recording on this device?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  The other device&apos;s active recording will be stopped
                  immediately. Any audio it has captured but not yet uploaded
                  may be lost. The clinician using that device will see a
                  &ldquo;recording was taken over&rdquo; message. Only do this
                  if you know the other recording isn&apos;t a real visit
                  in progress.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setTakeoverPending(false);
                    void confirmTakeover();
                  }}
                >
                  Take over
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button variant="outline" onClick={() => setLeaveOpen(true)}>
            Leave
          </Button>
          <LeaveConfirmDialog
            open={leaveOpen}
            onOpenChange={setLeaveOpen}
            onConfirm={() => router.push('/home')}
          />
        </div>
      </div>
    );
  }

  if (isError) {
    const reason = (state as { reason: string }).reason;
    return (
      <div className="space-y-2 w-full">
        <StatusBanner variant="danger">
          {reason}
        </StatusBanner>
        <div className="flex items-center gap-3">
          <Button onClick={() => { reset(); void start(); }} className="gap-2">
            <RotateCcw className="h-4 w-4" aria-hidden />
            Reset &amp; retry
          </Button>
          <Button variant="outline" onClick={() => setLeaveOpen(true)}>
            Leave
          </Button>
          <LeaveConfirmDialog
            open={leaveOpen}
            onOpenChange={setLeaveOpen}
            onConfirm={() => router.push('/home')}
          />
        </div>
      </div>
    );
  }

  if (isIdle) {
    if (autostartActive) {
      const remainingSec = Math.ceil(autostartMs / 1000);
      return (
        <div className="flex items-center gap-3 w-full">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Mic className="h-4 w-4 text-primary motion-safe:animate-pulse" aria-hidden />
            <span>
              Recording starts in <span className="font-mono tabular-nums text-foreground">{remainingSec}</span>…
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              autostartFiredRef.current = true; // block any in-flight tick
              setAutostartActive(false);
            }}
            className="gap-1.5"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Cancel
          </Button>
          <Button variant="ghost" onClick={() => setLeaveOpen(true)} className="ml-auto">
            Leave
          </Button>
          <LeaveConfirmDialog
            open={leaveOpen}
            onOpenChange={setLeaveOpen}
            onConfirm={() => router.push('/home')}
          />
        </div>
      );
    }

    return (
      <div className="flex items-center gap-3">
        <Button onClick={() => void start()} className="gap-2">
          <Mic className="h-4 w-4" aria-hidden />
          Start recording
        </Button>
        <Button variant="outline" onClick={() => setLeaveOpen(true)}>
          Leave
        </Button>
        <LeaveConfirmDialog
          open={leaveOpen}
          onOpenChange={setLeaveOpen}
          onConfirm={() => router.push('/home')}
        />
      </div>
    );
  }

  return (
    <div className="w-full space-y-2">
      {showMaxWarning && (
        <StatusBanner variant={isCritical ? 'danger' : 'warning'}>
          {warningMessage(warning, elapsedMs, accumulatedBytes)}
        </StatusBanner>
      )}

      <div className="flex items-center gap-3">
        {isPaused ? (
          <Button variant="outline" onClick={() => void resume()} disabled={isBusy} className="gap-2">
            <Play className="h-4 w-4" aria-hidden />
            Resume
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={pause}
            disabled={isBusy || state.kind === 'reconnecting'}
            className="gap-2"
          >
            <Pause className="h-4 w-4" aria-hidden />
            Pause
          </Button>
        )}

        <Button
          variant="default"
          onClick={() => void finish()}
          disabled={isBusy}
          className="gap-2"
        >
          Finish &amp; Review
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>

        <Button variant="ghost" onClick={() => setLeaveOpen(true)} className="ml-auto">
          Leave
        </Button>

        <LeaveConfirmDialog
          open={leaveOpen}
          onOpenChange={setLeaveOpen}
          onConfirm={() => router.push('/home')}
        />
      </div>
    </div>
  );
}

function warningMessage(
  level: 'time_warning' | 'time_critical' | 'size_warning' | 'size_critical' | 'none',
  elapsedMs: number,
  accumulatedBytes: number,
): string {
  if (level === 'time_critical') {
    return `Recording will auto-stop in ${formatTimeRemaining(elapsedMs)} — tap Finish & Review now.`;
  }
  if (level === 'time_warning') {
    return `Recording will auto-stop at the ${MAX_RECORDING_MIN}-minute limit (${formatTimeRemaining(elapsedMs)} left). Finish soon.`;
  }
  if (level === 'size_critical') {
    const mb = Math.round(accumulatedBytes / (1024 * 1024));
    return `Recording is approaching the ${MAX_RECORDING_MB} MB upload limit (${mb} MB used) — tap Finish & Review now.`;
  }
  if (level === 'size_warning') {
    const mb = Math.round(accumulatedBytes / (1024 * 1024));
    return `Recording will auto-stop at ${MAX_RECORDING_MB} MB (${mb} MB used). Finish soon.`;
  }
  return '';
}
