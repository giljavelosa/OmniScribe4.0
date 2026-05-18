'use client';

import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

type TranscriptLine = { speaker: string; text: string };
type TranscriptClean = { structured?: TranscriptLine[]; flatText?: string };

type Props = {
  noteId: string;
};

export function TranscriptSheet({ noteId }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptClean | null>(null);
  const [captureMode, setCaptureMode] = useState<string | null>(null);

  async function loadIfNeeded(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen || transcript) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${noteId}/transcript`);
      if (!res.ok) {
        setError(`Failed to load transcript (${res.status})`);
        return;
      }
      const body = await res.json();
      setTranscript(body.data?.transcriptClean ?? null);
      setCaptureMode(body.data?.captureMode ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={loadIfNeeded}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1">
          <FileText className="h-3 w-3" aria-hidden />
          View transcript
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Source transcript</SheetTitle>
          <SheetDescription>
            Diarized capture used to draft this note. Reference only — not editable.
            {captureMode && ` Capture mode: ${captureMode}.`}
          </SheetDescription>
        </SheetHeader>

        <div className="p-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading transcript…
            </div>
          )}
          {error && <p className="text-sm text-[var(--status-danger-fg)]">{error}</p>}
          {!loading && !error && transcript && (
            <TranscriptBody transcript={transcript} />
          )}
          {!loading && !error && !transcript && (
            <p className="text-sm text-muted-foreground italic">
              No transcript stored for this note.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TranscriptBody({ transcript }: { transcript: TranscriptClean }) {
  if (transcript.structured && transcript.structured.length > 0) {
    return (
      <div className="space-y-3 text-sm leading-relaxed">
        {transcript.structured.map((line, i) => (
          <div key={i} className="flex gap-3">
            <SpeakerBadge speaker={line.speaker} />
            <p className="flex-1 whitespace-pre-wrap">{line.text}</p>
          </div>
        ))}
      </div>
    );
  }
  if (transcript.flatText) {
    return (
      <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">
        {transcript.flatText}
      </pre>
    );
  }
  return (
    <p className="text-sm text-muted-foreground italic">
      Transcript is empty.
    </p>
  );
}

function SpeakerBadge({ speaker }: { speaker: string }) {
  const tone =
    speaker === 'CLINICIAN'
      ? 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)]'
      : speaker === 'PATIENT'
        ? 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
        : 'bg-muted text-muted-foreground';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide h-fit',
        tone,
      )}
    >
      {speaker}
    </span>
  );
}
