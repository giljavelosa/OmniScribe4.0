'use client';

import { useState } from 'react';
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

      {/* Pre-draft: Start Drafting is the LOUD primary CTA. */}
      {!draftStarted && (
        <Button
          disabled
          className="gap-2"
          title="Start Drafting wakes up in Unit 05 (LLM abstraction + division prompts)."
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          Start Drafting
        </Button>
      )}

      {/* Finish & Review:
            - pre-draft: outlined neutral (QUIET so the clinician doesn't hit
              it before drafting starts — design-critique-capture-flow.md
              identifies this as the #1 prior-prototype friction)
            - post-draft: filled primary teal (the affirmative end-of-flow) */}
      <Button
        variant={draftStarted ? 'default' : 'outline'}
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
