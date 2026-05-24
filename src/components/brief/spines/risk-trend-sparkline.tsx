import { TrendingDown, TrendingUp, Minus, AlertTriangle } from 'lucide-react';

import { BriefSection } from '../brief-section';
import { SourcePill } from '../source-pill';
import type { RiskTrendEntry, PlanRevision } from '@/types/brief-intent-shapes';

/**
 * Unit 48 PR4 — BH Treatment Plan Review spine component.
 *
 * Two sub-sections:
 *   1. Risk trend per standardized screener (PHQ-9 / GAD-7 / C-SSRS /
 *      MOOD-RATING). Renders an inline value progression with trend
 *      glyph. C-SSRS gets a danger-tier color since elevated scores
 *      are the audit-critical signal.
 *   2. Plan revisions list (category + proposed change + source).
 *
 * Graceful empty: if both arrays are empty, the section renders a
 * "review unavailable" banner.
 */
export function RiskTrendSparkline({
  entries,
  revisions,
}: {
  entries: RiskTrendEntry[];
  revisions: PlanRevision[];
}) {
  if ((!entries || entries.length === 0) && (!revisions || revisions.length === 0)) {
    return (
      <BriefSection label="Treatment plan review">
        <p className="text-sm text-muted-foreground">
          Risk trend + plan revisions unavailable — read the prior treatment
          plan + session notes for context.
        </p>
      </BriefSection>
    );
  }
  return (
    <div className="space-y-5" data-testid="bh-tpr-spine">
      {entries.length > 0 && (
        <BriefSection label="Risk trend" count={entries.length}>
          <ul className="space-y-3" data-testid="risk-trend">
            {entries.map((entry) => (
              <li
                key={entry.tool}
                className="space-y-1"
                data-testid="risk-trend-row"
                data-tool={entry.tool}
              >
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={`text-sm font-medium ${
                      entry.tool === 'C-SSRS' ? 'text-[var(--status-danger-fg)]' : ''
                    }`}
                  >
                    {entry.tool === 'C-SSRS' && (
                      <AlertTriangle
                        className="mr-1 inline size-3.5"
                        aria-hidden
                      />
                    )}
                    {entry.tool}
                  </p>
                  <TrendIcon trend={entry.trend} isCSSRS={entry.tool === 'C-SSRS'} />
                </div>
                <ol className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {entry.values.map((v, idx) => (
                    <li key={`${entry.tool}:${idx}`} className="flex items-center gap-1">
                      <span className="font-mono">{v.score}</span>
                      <span className="opacity-60">·</span>
                      <span>{v.date}</span>
                      {idx < entry.values.length - 1 && <span className="opacity-40">→</span>}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </BriefSection>
      )}
      {revisions.length > 0 && (
        <BriefSection label="Plan revisions" count={revisions.length}>
          <ul className="space-y-2" data-testid="plan-revisions">
            {revisions.map((r, idx) => (
              <li
                key={`${r.category}:${idx}`}
                className="flex items-start gap-2"
                data-testid="plan-revision-row"
                data-category={r.category}
              >
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {r.category.replace('-', ' ')}
                </span>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm">{r.proposed}</p>
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

function TrendIcon({
  trend,
  isCSSRS,
}: {
  trend: RiskTrendEntry['trend'];
  isCSSRS: boolean;
}) {
  // For BH: improving (down on PHQ-9/GAD-7) is green; worsening (up) is red.
  // C-SSRS uses ordinals so we keep the same semantic mapping.
  if (trend === 'improving') {
    return (
      <TrendingDown
        className="size-4 text-[var(--status-success-fg)]"
        aria-label="Improving (lower scores)"
      />
    );
  }
  if (trend === 'worsening') {
    return (
      <TrendingUp
        className={`size-4 ${isCSSRS ? 'text-[var(--status-danger-fg)]' : 'text-[var(--status-warning-fg)]'}`}
        aria-label="Worsening (higher scores)"
      />
    );
  }
  if (trend === 'stable') {
    return <Minus className="size-4 text-muted-foreground" aria-label="Stable" />;
  }
  return null;
}
