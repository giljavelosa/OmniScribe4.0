'use client';

import { StatusBadge } from '@/components/ui/status-badge';
import { ChartDetailSheet } from './chart-detail-sheet';

export type GoalProgressEntryRow = {
  id: string;
  measureValue: string | null;
  statusAtEntry: string | null;
  deltaNote: string | null;
  recordedAt: string; // ISO
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goalText: string;
  goalType: 'STG' | 'LTG';
  currentMeasure: string | null;
  targetMeasure: string | null;
  progressEntries: GoalProgressEntryRow[];
};

function formatRelativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'ACTIVE': return 'success';
    case 'MET': return 'success';
    case 'PARTIALLY_MET': return 'warning';
    case 'MODIFIED': return 'warning';
    case 'NOT_MET': return 'danger';
    case 'DISCONTINUED': return 'danger';
    default: return 'neutral';
  }
}

/**
 * GoalDetailSheet — right-side drill-down for a single EpisodeGoal.
 * Shows the full GoalProgressEntry trail as a dated timeline: measure
 * value, status snapshot, and optional clinician delta note per entry.
 *
 * Opened from the "History (N)" button on each GoalRow in EpisodesPanel.
 * Read-only. Sprint 0.10.
 */
export function GoalDetailSheet({
  open,
  onOpenChange,
  goalText,
  goalType,
  currentMeasure,
  targetMeasure,
  progressEntries,
}: Props) {
  return (
    <ChartDetailSheet open={open} onOpenChange={onOpenChange} title="Goal progression">
      {/* Goal identity */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge variant="neutral" noIcon>{goalType}</StatusBadge>
        </div>
        <p className="text-sm text-foreground leading-snug">{goalText}</p>
        {(currentMeasure || targetMeasure) && (
          <p className="text-xs text-muted-foreground">
            Current:{' '}
            <span className="font-medium text-foreground">{currentMeasure ?? '—'}</span>
            {'  →  '}
            Target: <span className="text-foreground">{targetMeasure ?? '—'}</span>
          </p>
        )}
      </div>

      <div className="border-t border-border pt-4 space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Progression trail</p>
        <p className="text-xs text-muted-foreground">
          {progressEntries.length === 0
            ? 'No progression entries yet — entries are created each time status or measure is updated.'
            : `${progressEntries.length} ${progressEntries.length === 1 ? 'entry' : 'entries'}, newest first`}
        </p>
      </div>

      {progressEntries.length > 0 && (
        <ol className="relative border-l border-border space-y-5 ml-2">
          {progressEntries.map((pe) => (
            <li key={pe.id} className="pl-5 relative">
              {/* Timeline dot */}
              <span
                className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-border bg-background"
                aria-hidden="true"
              />

              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeDate(pe.recordedAt)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(pe.recordedAt).toLocaleDateString(undefined, {
                      month: 'short', day: 'numeric',
                    })}
                  </span>
                  {pe.statusAtEntry && (
                    <StatusBadge variant={statusVariant(pe.statusAtEntry)} noIcon className="text-xs">
                      {pe.statusAtEntry}
                    </StatusBadge>
                  )}
                </div>

                {pe.measureValue && (
                  <p className="text-sm font-medium text-foreground">{pe.measureValue}</p>
                )}

                {pe.deltaNote && (
                  <p className="text-xs text-muted-foreground italic leading-relaxed">
                    {pe.deltaNote}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </ChartDetailSheet>
  );
}
