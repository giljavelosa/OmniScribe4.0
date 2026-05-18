'use client';

import { useEffect, useState } from 'react';
import { Circle, Mic, MicOff, Loader2, CheckCircle2, AlertCircle, Pause } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useRecordingState } from '../_hooks/capture-state';

/**
 * RecordingStatus — THE single source of truth for capture-state UI per
 * design-critique-capture-flow.md. No other surface (transcript empty state,
 * mobile setup pill, live-note panel header) renders its own status. They
 * subscribe to useRecordingState() if they need to know.
 */
export function RecordingStatus() {
  const state = useRecordingState();
  const elapsed = useElapsedMs(state.kind === 'recording' ? state.startedAt : null);

  const visual = computeVisual(state);
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm">
      <visual.Icon className={cn('h-4 w-4', visual.iconClass)} aria-hidden />
      <span className="font-medium">{visual.label}</span>
      {state.kind === 'recording' && (
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {formatElapsed(elapsed)}
        </span>
      )}
      {visual.secondary && (
        <span className="text-xs text-muted-foreground">{visual.secondary}</span>
      )}
    </div>
  );
}

function computeVisual(state: ReturnType<typeof useRecordingState>) {
  switch (state.kind) {
    case 'idle':
      return { Icon: Circle, label: 'Idle', secondary: null, iconClass: 'text-muted-foreground' };
    case 'requesting-mic':
      return { Icon: Mic, label: 'Requesting mic…', secondary: null, iconClass: 'text-[var(--status-info-fg)] animate-pulse' };
    case 'recording':
      return {
        Icon: Mic,
        label: 'Recording',
        secondary: state.isStub ? 'Soniox stub — transcript disabled' : null,
        iconClass: 'text-[var(--status-success-fg)] motion-safe:animate-pulse',
      };
    case 'paused':
      return { Icon: Pause, label: 'Paused', secondary: null, iconClass: 'text-[var(--status-warning-fg)]' };
    case 'finalizing':
      return { Icon: Loader2, label: 'Finalizing…', secondary: null, iconClass: 'animate-spin text-muted-foreground' };
    case 'drafting':
      return { Icon: Loader2, label: 'Drafting…', secondary: 'AI is writing', iconClass: 'animate-spin text-[var(--status-info-fg)]' };
    case 'complete':
      return { Icon: CheckCircle2, label: 'Complete', secondary: null, iconClass: 'text-[var(--status-success-fg)]' };
    case 'error':
      return { Icon: AlertCircle, label: 'Error', secondary: state.reason, iconClass: 'text-[var(--status-danger-fg)]' };
    default: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _exhaustive: never = state;
      return { Icon: MicOff, label: 'Unknown', secondary: null, iconClass: 'text-muted-foreground' };
    }
  }
}

function useElapsedMs(startedAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    // Reset now to current time on each startedAt change to avoid the
    // initial-render lag producing a negative elapsed value before the first tick.
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (startedAt == null) return 0;
  // Clamp to zero — a future startedAt (clock skew / re-render race) must not
  // produce negative output that formats as "-1:-30".
  return Math.max(0, now - startedAt);
}

function formatElapsed(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
