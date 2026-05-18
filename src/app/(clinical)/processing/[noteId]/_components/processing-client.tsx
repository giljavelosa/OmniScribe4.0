'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ProcessingIndicator } from '@/components/ui/processing-indicator';
import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/components/ui/status-banner';

type Props = {
  noteId: string;
  initialStatus: string;
};

/**
 * Subscribes to the SSE stream from Unit 04 and renders the
 * <ProcessingIndicator> + escalating empathy copy keyed to elapsed time.
 *
 * Auto-routes to /review/[noteId] the moment the note exits the active
 * pipeline (DRAFT or DRAFT/INTERRUPTED). The SSE default mode closes after
 * that transition; we close the EventSource locally just to be tidy.
 */
export function ProcessingClient({ noteId, initialStatus }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState<{ at?: string; message?: string } | null>(null);

  // Elapsed-time tick.
  useEffect(() => {
    const t = setInterval(() => setElapsedMs((e) => e + 1000), 1000);
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
        setStatus(data.status);
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
      // Browser auto-reconnect handles transient drops. Only surface a
      // persistent error if we're in a clearly broken state.
    };
    return () => src.close();
  }, [noteId]);

  // Auto-route when the note exits the active pipeline.
  useEffect(() => {
    if (status === 'DRAFT' || status === 'REVIEWING' || status === 'SIGNED') {
      router.push(`/review/${noteId}`);
    }
  }, [status, noteId, router]);

  const copy = empathyCopy(status, elapsedMs);

  return (
    <div className="mx-auto max-w-md px-6 py-16 flex flex-col items-center gap-6">
      <ProcessingIndicator size="lg" label={copy.label} />
      <div className="text-center space-y-2">
        <p className="text-md font-medium">{copy.headline}</p>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
      </div>
      <p className="text-xs text-muted-foreground font-mono">
        status: {status} · {formatElapsed(elapsedMs)}
      </p>

      {interrupted && (
        <StatusBanner variant="danger" title="Processing interrupted">
          {interrupted.message ?? 'A worker failure stopped the pipeline.'} You can manually
          retry from the review screen once the underlying issue is resolved.
          <div className="mt-3 flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/review/${noteId}`}>Open the note anyway</Link>
            </Button>
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

function empathyCopy(status: string, elapsedMs: number) {
  if (status === 'INTERRUPTED') {
    return {
      label: 'Processing interrupted',
      headline: 'We hit a snag.',
      body: 'A retry will pick up where we left off. You can also open the note now.',
    };
  }
  if (status === 'TRANSCRIBING') {
    return {
      label: 'Transcribing',
      headline: 'Transcribing the visit…',
      body: 'Cleaning the transcript + tagging speakers.',
    };
  }
  if (status === 'DRAFTING') {
    if (elapsedMs < 15_000) {
      return {
        label: 'Drafting',
        headline: 'Drafting the note…',
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
      body: 'You can leave this page; we’ll keep working. Check Drafts on Home for the note when ready.',
    };
  }
  return {
    label: 'Working',
    headline: 'Working on the note…',
    body: 'The review screen opens automatically.',
  };
}

function formatElapsed(ms: number) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
