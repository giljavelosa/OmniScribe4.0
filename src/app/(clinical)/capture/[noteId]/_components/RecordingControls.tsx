'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play, Mic, Sparkles, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCaptureControls, useRecordingState } from '../_hooks/capture-state';
import { LeaveConfirmDialog } from './LeaveConfirmDialog';

type Props = {
  noteId: string;
  /** Drafting only lands in Unit 05; until then, draftStarted is always false. */
  draftStarted?: boolean;
};

/**
 * RecordingControls — three-state button bar that honors the
 * design-critique-capture-flow.md "button polarity" P0 rule:
 *
 *   PRE-DRAFT  : Pause (outline) · **Start Drafting** (FILLED PRIMARY) · Finish (outline neutral)
 *   POST-DRAFT : Re-draft (outline)              · **Finish & Review** (FILLED PRIMARY)
 *
 * Clinicians WILL hit the loud button mid-recording — so the loud button
 * MUST be the affirmative one ("Start Drafting" / "Finish & Review"),
 * never the irreversible-ish one. Red is reserved for "Discard recording."
 *
 * Drafting wiring lands in Unit 05 (LLM abstraction + section progress);
 * for Unit 03, the "Start Drafting" button is present but inactive (greyed)
 * with a tooltip explaining it'll wake up in Unit 05.
 */
export function RecordingControls({ noteId, draftStarted = false }: Props) {
  const state = useRecordingState();
  const { start, pause, resume, finish } = useCaptureControls();
  const router = useRouter();
  const [leaveOpen, setLeaveOpen] = useState(false);

  // After finish() resolves to state.kind === 'complete', route to
  // /processing so the clinician sees the reassurance screen while the
  // transcription + ai-generation workers run.
  useEffect(() => {
    if (state.kind === 'complete') {
      router.push(`/processing/${noteId}`);
    }
  }, [state.kind, noteId, router]);

  const isIdle = state.kind === 'idle' || state.kind === 'error';
  const isRecording = state.kind === 'recording';
  const isPaused = state.kind === 'paused';
  const isBusy = state.kind === 'requesting-mic' || state.kind === 'finalizing';

  if (isIdle) {
    return (
      <div className="flex items-center gap-3">
        <Button onClick={start} className="gap-2">
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
    <div className="flex items-center gap-3">
      {/* Pause / Resume — always quiet outline */}
      {isPaused ? (
        <Button variant="outline" onClick={() => void resume()} disabled={isBusy} className="gap-2">
          <Play className="h-4 w-4" aria-hidden />
          Resume
        </Button>
      ) : (
        <Button variant="outline" onClick={pause} disabled={isBusy || !isRecording} className="gap-2">
          <Pause className="h-4 w-4" aria-hidden />
          Pause
        </Button>
      )}

      {/* Start Drafting placeholder — in Unit 05 the worker auto-drafts AFTER
          Finish & Review (no manual button). Kept disabled with an updated
          tooltip in case a clinician's muscle memory still reaches for it. */}
      {!draftStarted && (
        <Button
          disabled
          variant="ghost"
          className="gap-2"
          title="Drafting starts automatically after Finish & Review."
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          Auto-draft on finish
        </Button>
      )}

      {/* Finish & Review — the affirmative end-of-flow CTA. Since drafting
          is auto-triggered server-side (Unit 04 transcription worker enqueues
          ai-generation on TRANSCRIBING → DRAFTING), this button is the
          intentional loud action in both pre-draft and post-draft states. */}
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

      {/* Reserved for Unit 05 wiring */}
      <input type="hidden" data-note-id={noteId} />
    </div>
  );
}
