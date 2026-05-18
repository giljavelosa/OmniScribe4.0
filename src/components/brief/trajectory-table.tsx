import { SourcePill } from './source-pill';
import type { ObjectiveMeasure, TrajectoryDirection } from '@/types/brief';

/**
 * TrajectoryTable — rows per objective measure, with prior values, latest
 * value, trend arrow, and a source pill linking to the most recent source.
 *
 * Color tokens (rule 23 — no hardcoded colors):
 *   improving   → text-success
 *   worsening   → text-warning   (insurance-auditor-safe; never destructive red)
 *   stable      → text-muted-foreground
 *   unknown     → text-muted-foreground
 *
 * The trailing direction summary glyph in the header is in BriefCard; this
 * component only renders rows.
 */
export function TrajectoryTable({ measures }: { measures: ObjectiveMeasure[] }) {
  if (measures.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No quantitative measures recorded in source notes.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {measures.map((m) => (
        <TrajectoryRow key={`${m.measure}-${m.sourceNoteId}`} measure={m} />
      ))}
    </div>
  );
}

function TrajectoryRow({ measure }: { measure: ObjectiveMeasure }) {
  const arrow = trendArrow(measure.trend);
  const color = trendColor(measure.trend);
  const trendLabel = trendAria(measure.trend);
  const values = [...measure.priorValues].reverse(); // oldest first for left-to-right scan
  const valueStr = values.length > 0
    ? `${values.join(' → ')} → ${measure.lastValue}`
    : `${measure.lastValue} (single visit)`;
  const unit = measure.unit ? ` ${measure.unit}` : '';
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-3 items-baseline">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{measure.measure}</span>
        <span className="text-muted-foreground">
          {valueStr}
          {unit}
        </span>
        <SourcePill noteId={measure.sourceNoteId} date="" label="source" />
      </div>
      <span className={color} aria-label={trendLabel} title={trendLabel}>
        {arrow}
      </span>
    </div>
  );
}

function trendArrow(trend: ObjectiveMeasure['trend']): string {
  switch (trend) {
    case 'improving':
      return '↗';
    case 'worsening':
      return '↘';
    case 'stable':
      return '→';
    case 'unknown':
      return '·';
  }
}

function trendColor(trend: ObjectiveMeasure['trend']): string {
  switch (trend) {
    case 'improving':
      return 'text-[var(--status-success-fg)]';
    case 'worsening':
      return 'text-[var(--status-warning-fg)]';
    case 'stable':
    case 'unknown':
    default:
      return 'text-muted-foreground';
  }
}

function trendAria(trend: ObjectiveMeasure['trend']): string {
  switch (trend) {
    case 'improving':
      return 'improving';
    case 'worsening':
      return 'worsening';
    case 'stable':
      return 'stable';
    case 'unknown':
    default:
      return 'unknown trend';
  }
}

/**
 * Direction glyph used in the section header (top-right of Trajectory).
 * Distinct from per-row arrows so a clinician can read the gestalt at a
 * glance.
 */
export function trajectoryDirectionGlyph(direction: TrajectoryDirection | null): {
  glyph: string;
  label: string;
  color: string;
} {
  switch (direction) {
    case 'improving':
      return { glyph: '↑', label: 'improving overall', color: 'text-[var(--status-success-fg)]' };
    case 'regressing':
      return { glyph: '↓', label: 'regressing overall', color: 'text-[var(--status-warning-fg)]' };
    case 'plateau':
      return { glyph: '→', label: 'plateau', color: 'text-muted-foreground' };
    case 'mixed':
      return { glyph: '⇄', label: 'mixed direction', color: 'text-muted-foreground' };
    case null:
    default:
      return { glyph: '', label: '', color: '' };
  }
}
