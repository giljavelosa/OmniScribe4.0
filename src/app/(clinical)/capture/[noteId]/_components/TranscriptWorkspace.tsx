'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import { useRecordingState, useTranscript } from '../_hooks/capture-state';

/**
 * Speaker-colored diarized transcript pane. Auto-scrolls to keep the latest
 * line visible while recording (only when the user hasn't manually scrolled
 * up).
 *
 * Speaker colors come from --speaker-1 (blue) and --speaker-2 (purple) per
 * ui-context.md "Specialized tokens." Speaker 0 (unknown) renders in
 * --foreground.
 */
export function TranscriptWorkspace({ className }: { className?: string }) {
  const state = useRecordingState();
  const { segments, partial } = useTranscript();
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  useEffect(() => {
    function onScroll() {
      if (!scrollRef.current) return;
      const el = scrollRef.current;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      userScrolledRef.current = !atBottom;
    }
    const el = scrollRef.current;
    el?.addEventListener('scroll', onScroll);
    return () => el?.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (userScrolledRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [segments, partial]);

  const isEmpty = segments.length === 0 && !partial;

  return (
    <div
      ref={scrollRef}
      className={cn(
        'flex-1 overflow-y-auto rounded-lg border border-border bg-card text-sm leading-relaxed p-4',
        className,
      )}
    >
      {isEmpty ? (
        <EmptyState state={state.kind} />
      ) : (
        <div className="space-y-2">
          {segments.map((seg) => (
            <p key={seg.id} className={cn(speakerColor(seg.speaker))}>
              <span className="font-mono text-xs text-muted-foreground mr-2">
                {seg.speaker == null ? '—' : `S${seg.speaker}`}
              </span>
              {seg.text}
            </p>
          ))}
          {partial && (
            <p className="text-muted-foreground italic" aria-live="polite">
              <span className="font-mono text-xs text-muted-foreground mr-2">…</span>
              {partial}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function speakerColor(speaker: number | null) {
  // null = partial/unknown — render in muted foreground, not a speaker color.
  // 0    = Soniox "unassigned" — distinct from speaker 1 so clinicians notice.
  // 1    = first diarized speaker (typically the clinician).
  // 2    = second diarized speaker (typically the patient).
  if (speaker === null) return 'text-muted-foreground';
  if (speaker === 0) return 'text-muted-foreground italic';
  if (speaker === 1) return 'text-[var(--speaker-1)]';
  if (speaker === 2) return 'text-[var(--speaker-2)]';
  return 'text-foreground';
}

function EmptyState({ state }: { state: ReturnType<typeof useRecordingState>['kind'] }) {
  // Per the design-critique rule: no separate "Listening for speech" status
  // string here — defer to <RecordingStatus>. This empty state just acks the
  // current phase without competing with the header.
  const copy =
    state === 'recording' || state === 'paused'
      ? 'Speech will appear here as Soniox finalizes it.'
      : state === 'finalizing'
        ? 'Finalizing the recording…'
        : state === 'complete'
          ? 'Capture complete.'
          : 'Recording will start in a moment.';
  // Animate the waveform while we're actively listening or warming up; keep
  // it static for finalize/complete so the pane reads as "done", not "live".
  const animate =
    state === 'idle' || state === 'requesting-mic' || state === 'recording' || state === 'paused';
  return (
    <div className="grid place-items-center h-full">
      <div className="flex flex-col items-center gap-4 px-4 text-center">
        <WaveformGlyph animate={animate} />
        <p className="text-sm text-muted-foreground max-w-xs">{copy}</p>
      </div>
    </div>
  );
}

/**
 * Subtle 4-wave SVG. Stays in `text-muted-foreground/30` so it never competes
 * with the live transcript that replaces it, but gives the pane visual
 * intentionality (vs. a blank bordered box that looks like an error state).
 */
function WaveformGlyph({ animate }: { animate: boolean }) {
  return (
    <svg
      width="120"
      height="48"
      viewBox="0 0 120 48"
      fill="none"
      aria-hidden="true"
      className="text-muted-foreground/40"
    >
      <path
        d="M0 24 Q 10 8, 20 24 T 40 24 T 60 24 T 80 24 T 100 24 T 120 24"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        className={animate ? 'motion-safe:animate-pulse' : undefined}
      />
      <path
        d="M0 24 Q 10 16, 20 24 T 40 24 T 60 24 T 80 24 T 100 24 T 120 24"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M0 24 Q 10 36, 20 24 T 40 24 T 60 24 T 80 24 T 100 24 T 120 24"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}
