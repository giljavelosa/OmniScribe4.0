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
  if (speaker === 0 || speaker === 1) return 'text-[var(--speaker-1)]';
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
          : 'Tap Start recording to begin.';
  return (
    <div className="grid place-items-center h-full text-sm text-muted-foreground">
      {copy}
    </div>
  );
}
