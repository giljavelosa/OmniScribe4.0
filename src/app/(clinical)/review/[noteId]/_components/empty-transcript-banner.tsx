'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MicOff, RotateCw, FileText } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/components/ui/status-banner';
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

type Props = {
  noteId: string;
  /** Audio captured (in ms) — derived from AudioSegment rows by the
   *  ai-generation worker and persisted in inferenceLog._meta. */
  durationMs: number;
  /** Bytes captured. 0 for transcript-only paths (dev). */
  byteSize: number;
  /** True after sign — banner stays visible (the empty draft is now
   *  immutable) but actions go away. */
  isSigned?: boolean;
};

/**
 * EmptyTranscriptBanner — surfaces when the AI-generation worker
 * short-circuited to placeholder text because the cleaned transcript
 * had zero words (mic muted, silence, dead Soniox stream, or the
 * clinician hit Finish too soon).
 *
 * Without this banner, a clinician landing on /review sees six
 * identical "No transcript captured…" paragraphs and concludes the
 * system is broken. The banner names the situation explicitly, shows
 * what was actually captured (e.g. "4 s of audio, 138 KB"), and gives
 * the clinician the two natural recoveries:
 *
 *   - Re-record — POSTs /reset-recording (which discards the
 *     placeholder draft + soft-deletes the silent audio + flips the
 *     note back to PREPARING) then navigates to /prepare/[noteId].
 *     Without the reset call, /prepare's recording CTA is disabled
 *     because the note is already DRAFT.
 *   - Paste transcript — sends the clinician to /prepare's paste
 *     surface (anchor link). Paste itself ALSO needs a PREPARING
 *     note, so we route it through the same reset call.
 *
 * The clinician can also just edit the placeholder paragraphs in
 * place if they want to chart manually — the banner doesn't block;
 * it just orients. AlertDialog confirms the destructive reset
 * because audio gets soft-deleted in the process (rule 22 — no
 * native confirm() in clinical surfaces).
 */
export function EmptyTranscriptBanner({
  noteId,
  durationMs,
  byteSize,
  isSigned = false,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pasteAfterReset, setPasteAfterReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openReset(opts: { goToPaste: boolean }) {
    setPasteAfterReset(opts.goToPaste);
    setError(null);
    setConfirmOpen(true);
  }

  function confirmReset() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/notes/${noteId}/reset-recording`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: { message?: string; code?: string } }
            | null;
          setError(
            body?.error?.message ??
              `Couldn't reset recording (${res.status}). Try again.`,
          );
          return;
        }
        // Hard nav — /prepare is a server component and we want fresh
        // data after the status flip.
        const url = pasteAfterReset
          ? `/prepare/${noteId}#paste-transcript`
          : `/prepare/${noteId}`;
        router.push(url);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error.');
      }
    });
  }

  return (
    <>
      <Card className="border-[var(--status-warning-border)]">
        <CardHeader>
          <CardTitle className="text-md flex items-center gap-2">
            <MicOff
              className="size-4 text-[var(--status-warning-fg)]"
              aria-hidden="true"
            />
            We didn&apos;t capture any speech in this recording
          </CardTitle>
          <CardDescription>
            {summary(durationMs, byteSize)} The AI couldn&apos;t draft from
            this, so every section below is filler text. Re-record the visit,
            paste the transcript, or write the note manually.
          </CardDescription>
        </CardHeader>
        {!isSigned && (
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => openReset({ goToPaste: false })}
                disabled={pending}
                className="gap-1"
              >
                <RotateCw
                  className={`size-3 ${pending ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                Re-record
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openReset({ goToPaste: true })}
                disabled={pending}
                className="gap-1"
              >
                <FileText className="size-3" aria-hidden="true" />
                Paste transcript
              </Button>
            </div>
            {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          </CardContent>
        )}
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this draft and start over?</AlertDialogTitle>
            <AlertDialogDescription>
              The current placeholder draft will be cleared and the existing
              audio (which captured no speech) will be removed from this note.
              The audio file is preserved in the system of record per HIPAA —
              it just won&apos;t be associated with this note anymore. You
              can&apos;t undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReset} disabled={pending}>
              {pending
                ? 'Resetting…'
                : pasteAfterReset
                  ? 'Discard + paste transcript'
                  : 'Discard + re-record'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** "We captured 4 s of audio (138 KB)." Falls back to byte-only or
 *  empty-only when one of the dimensions is zero so the banner stays
 *  truthful for the dev transcript-only path. */
function summary(durationMs: number, byteSize: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  if (durationMs > 0 && byteSize > 0) {
    return `We captured ${formatSeconds(seconds)} of audio (${formatBytes(byteSize)}) but no recognizable speech.`;
  }
  if (durationMs > 0) {
    return `We captured ${formatSeconds(seconds)} of audio but no recognizable speech.`;
  }
  if (byteSize > 0) {
    return `We received ${formatBytes(byteSize)} of audio but no recognizable speech.`;
  }
  return 'No audio reached the transcription pipeline for this encounter.';
}

function formatSeconds(seconds: number): string {
  if (seconds === 0) return '< 1 s';
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
