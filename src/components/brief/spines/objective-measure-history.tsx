import { TrendingDown, TrendingUp, Minus } from 'lucide-react';

import { BriefSection } from '../brief-section';
import { SourcePill } from '../source-pill';
import type {
  ObjectiveMeasureHistoryEntry,
  RevisionOpportunity,
} from '@/types/brief-intent-shapes';

/**
 * Unit 48 PR4 — REHAB Re-evaluation spine component.
 *
 * Two sub-sections:
 *   1. Per-measure history table (every measure tracked across the
 *      whole episode, not just the base schema's last-3 cap)
 *   2. Revision-opportunity list (goals warranting advance / modify /
 *      retire / replace, with reason)
 *
 * Graceful empty: if either array is empty, the corresponding section
 * is omitted from the render (vs. crashing or showing "no data").
 */
export function ObjectiveMeasureHistorySection({
  entries,
  revisions,
}: {
  entries: ObjectiveMeasureHistoryEntry[];
  revisions: RevisionOpportunity[];
}) {
  if ((!entries || entries.length === 0) && (!revisions || revisions.length === 0)) {
    return (
      <BriefSection label="Re-evaluation context">
        <p className="text-sm text-muted-foreground">
          Objective history + revision opportunities unavailable — open the prior
          eval / progress notes for context.
        </p>
      </BriefSection>
    );
  }
  return (
    <div className="space-y-5" data-testid="reeval-spine">
      {entries.length > 0 && (
        <BriefSection label="Objective measure history" count={entries.length}>
          <ul className="space-y-3" data-testid="measure-history">
            {entries.map((entry) => (
              <li
                key={entry.measureKey}
                className="space-y-1"
                data-testid="measure-history-row"
                data-measure-key={entry.measureKey}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {entry.measureLabel}
                    {entry.unit && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({entry.unit})
                      </span>
                    )}
                  </p>
                  <TrendIcon trend={entry.trend} />
                </div>
                <ol className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {entry.history.map((point, idx) => (
                    <li key={`${entry.measureKey}:${idx}`} className="flex items-center gap-1">
                      <span className="font-mono">{point.value}</span>
                      <span className="opacity-60">·</span>
                      <span>{point.date}</span>
                      {idx < entry.history.length - 1 && <span className="opacity-40">→</span>}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </BriefSection>
      )}
      {revisions.length > 0 && (
        <BriefSection label="Revision opportunities" count={revisions.length}>
          <ul className="space-y-2" data-testid="revision-opportunities">
            {revisions.map((r, idx) => (
              <li
                key={`${r.goalText.slice(0, 20)}:${idx}`}
                className="flex items-start gap-2"
                data-testid="revision-opportunity-row"
                data-direction={r.direction}
              >
                <span
                  className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  aria-label={`Direction: ${r.direction}`}
                >
                  {r.direction}
                </span>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm">{r.goalText}</p>
                  <p className="text-xs text-muted-foreground">{r.reason}</p>
                  <SourcePill noteId={r.sourceNoteId} date="" label="source" />
                </div>
              </li>
            ))}
          </ul>
        </BriefSection>
      )}
    </div>
  );
}

function TrendIcon({ trend }: { trend: ObjectiveMeasureHistoryEntry['trend'] }) {
  if (trend === 'improving') {
    return (
      <TrendingUp
        className="size-4 text-[var(--status-success-fg)]"
        aria-label="Improving"
      />
    );
  }
  if (trend === 'worsening') {
    return (
      <TrendingDown
        className="size-4 text-[var(--status-danger-fg)]"
        aria-label="Worsening"
      />
    );
  }
  if (trend === 'stable') {
    return <Minus className="size-4 text-muted-foreground" aria-label="Stable" />;
  }
  return null;
}
