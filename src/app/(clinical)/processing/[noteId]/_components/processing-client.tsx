'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ProcessingIndicator } from '@/components/ui/processing-indicator';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';

type Props = {
  noteId: string;
  initialStatus: string;
  /** PHI-safe display name (first name + last initial) so the clinician can
   *  confirm at a glance they're waiting for the right note. */
  patientDisplayName?: string;
};

/** ms before we surface the "worker fleet may be offline" hint. */
const STUCK_THRESHOLD_MS = 60_000;

/**
 * Subscribes to the SSE stream from Unit 04 and renders the
 * <ProcessingIndicator> + escalating empathy copy keyed to elapsed time.
 *
 * Auto-routes to /review/[noteId] the moment the note exits the active
 * pipeline (DRAFT or REVIEWING or SIGNED). The SSE default mode closes after
 * that transition; we close the EventSource locally just to be tidy.
 *
 * New in recording-module-deficiencies polish:
 *   - Real "Retry" button for INTERRUPTED notes (POST /retry-transcription).
 *   - Stuck-worker hint: if status stays in TRANSCRIBING/DRAFTING for >60s
 *     without a transition, surface a hint that the worker fleet may be down.
 */
export function ProcessingClient({ noteId, initialStatus, patientDisplayName }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState<{ at?: string; message?: string } | null>(null);
  const [retryPending, startRetry] = useTransition();
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retried, setRetried] = useState(false);

  // Track how long the status has been stuck in the active pipeline.
  // useRef's initializer evaluates once per instance — equivalent to a
  // lazy initializer for capturing mount time.
  // eslint-disable-next-line react-hooks/purity
  const lastStatusChangeRef = useRef(Date.now());
  const [stuckMs, setStuckMs] = useState(0);

  // Elapsed-time tick.
  useEffect(() => {
    const t = setInterval(() => {
      setElapsedMs((e) => e + 1000);
      setStuckMs(Date.now() - lastStatusChangeRef.current);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // SSE subscription. Default mode (no ?include=sections) closes on note
  // exit from TRANSCRIBING/DRAFTING — exactly what we want here.
  useEffect(() => {
    const src = new EventSource(`/api/notes/${noteId}/stream`);
    src.addEventListener('STATUS', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as {
          status: string;
          interruptedAt?: string;
          lastWorkerError?: string;
        };
        setStatus((prev) => {
          if (data.status !== prev) lastStatusChangeRef.current = Date.now();
          return data.status;
        });
        if (data.status === 'INTERRUPTED') {
          setInterrupted({ at: data.interruptedAt, message: data.lastWorkerError });
        }
      } catch {
        // ignore malformed event
      }
    });
    src.addEventListener('NOT_FOUND', () => {
      setError('Note no longer exists.');
      src.close();
    });
    src.addEventListener('TIMEOUT', () => {
      setError('Processing taking longer than expected. Refresh to retry.');
      src.close();
    });
    src.onerror = () => {
      // Browser auto-reconnect handles transient drops.
    };
    return () => src.close();
  }, [noteId]);

  // Auto-route when the note exits the active pipeline.
  useEffect(() => {
    if (status === 'DRAFT' || status === 'REVIEWING' || status === 'SIGNED') {
      router.push(`/review/${noteId}`);
    }
  }, [status, noteId, router]);

  function handleRetry() {
    setRetryError(null);
    startRetry(async () => {
      const res = await fetch(`/api/notes/${noteId}/retry-transcription`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setRetryError(body?.error?.message ?? 'Retry failed — please try again.');
        return;
      }
      setRetried(true);
      setInterrupted(null);
      setStatus('TRANSCRIBING');
      lastStatusChangeRef.current = Date.now();
    });
  }

  const copy = empathyCopy(status, elapsedMs, patientDisplayName);
  const isActivelyProcessing = status === 'TRANSCRIBING' || status === 'DRAFTING';
  const showStuckHint = isActivelyProcessing && stuckMs >= STUCK_THRESHOLD_MS;
  const statusVariant = statusBadgeVariant(status);

  return (
    <div className="mx-auto max-w-md px-6 py-16 flex flex-col items-center gap-6">
      <ProcessingIndicator size="lg" label={copy.label} />
      <div className="text-center space-y-2">
        <p className="text-md font-medium">{copy.headline}</p>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <StatusBadge variant={statusVariant} noIcon>
          {status}
        </StatusBadge>
        <span className="font-mono tabular-nums">{formatElapsed(elapsedMs)}</span>
      </div>

      {retried && !interrupted && (
        <StatusBanner variant="info">
          Retry queued — the note will continue processing.
        </StatusBanner>
      )}

      {interrupted && (
        <StatusBanner variant="danger" title="Processing interrupted">
          {interrupted.message ?? 'A worker failure stopped the pipeline.'}
          {retryError && (
            <p className="mt-1 text-xs text-[var(--status-danger-fg)]">{retryError}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={handleRetry}
              disabled={retryPending}
            >
              {retryPending ? 'Retrying…' : 'Retry processing'}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/review/${noteId}`}>Open note anyway</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/home">Back to home</Link>
            </Button>
          </div>
        </StatusBanner>
      )}

      {showStuckHint && !interrupted && (
        <StatusBanner variant="warning" title="Taking longer than expected">
          The note is still in the queue. If this persists, the worker process
          may not be running — contact your administrator. You can also leave
          this page; the note will continue when workers come back online.
          <div className="mt-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/home">Back to home</Link>
            </Button>
          </div>
        </StatusBanner>
      )}

      {error && (
        <StatusBanner variant="warning" title="Stream issue">
          {error}
        </StatusBanner>
      )}
    </div>
  );
}

function empathyCopy(status: string, elapsedMs: number, patientName?: string) {
  // "for {name}" suffix anchors the reassurance copy to the right note, so a
  // clinician who tabbed away and came back knows immediately what's processing.
  const forPatient = patientName ? ` for ${patientName}` : '';

  if (status === 'INTERRUPTED') {
    return {
      label: 'Processing interrupted',
      headline: `We hit a snag${forPatient}.`,
      body: 'Tap Retry to re-queue the note, or open it now and add sections manually.',
    };
  }
  if (status === 'TRANSCRIBING') {
    return {
      label: 'Transcribing',
      headline: `Transcribing the visit${forPatient}…`,
      body: 'Cleaning the transcript + tagging speakers.',
    };
  }
  if (status === 'DRAFTING') {
    if (elapsedMs < 15_000) {
      return {
        label: 'Drafting',
        headline: `Drafting the note${forPatient}…`,
        body: 'Sections will appear on the review screen as they finish.',
      };
    }
    if (elapsedMs < 45_000) {
      return {
        label: 'Drafting',
        headline: 'Working through each section.',
        body: 'Longer transcripts take a moment longer.',
      };
    }
    if (elapsedMs < 90_000) {
      return {
        label: 'Drafting',
        headline: 'Almost done with the draft.',
        body: 'Sticking with it — the model is finishing the last section.',
      };
    }
    return {
      label: 'Drafting',
      headline: 'Taking longer than usual.',
      body: "You can leave this page; we'll keep working. Check Drafts on Home for the note when ready.",
    };
  }
  return {
    label: 'Working',
    headline: `Working on the note${forPatient}…`,
    body: 'The review screen opens automatically.',
  };
}

/** Maps note status to the StatusBadge color cue so TRANSCRIBING vs DRAFTING
 *  vs INTERRUPTED reads at a glance instead of as monospace text. */
function statusBadgeVariant(
  status: string,
): 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'violet' {
  if (status === 'INTERRUPTED') return 'danger';
  if (status === 'TRANSCRIBING') return 'info';
  if (status === 'DRAFTING') return 'violet';
  if (status === 'DRAFT' || status === 'REVIEWING' || status === 'SIGNED') return 'success';
  return 'neutral';
}

function formatElapsed(ms: number) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
