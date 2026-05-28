'use client';

import { ArrowRight, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { COPILOT_DISPLAY_NAME } from '@/services/copilot/persona';

/**
 * Sprint 0.14 — "Cleo's read" chart card.
 *
 * 30-second answer surface on the Overview tab. Sourced from the
 * server-fetched `CopilotPatientState` for the viewing clinician.
 *
 * Empty state: compact horizontal strip — does not dominate the cockpit.
 * Populated state: tight card with patterns + CTA.
 *
 * Rule 24: this card surfaces observed patterns + case awareness; it
 * NEVER recommends clinical action. The CTA opens the Sheet — every
 * action the clinician takes is their decision.
 */

export type ObservedPatternSummary = {
  kind: 'topic_mentioned_unaddressed' | 'measure_trend' | 'recert_due_soon' | 'goal_stalled';
  label: string;
};

export type CaseAwarenessSummary = {
  activeCaseCount: number;
  /** Most-recent case label this clinician has touched, for the
   *  one-liner up top. */
  topCaseLabel: string | null;
};

export type CleoReadCardData = {
  /** Total active cases — drives the headline stat strip. */
  cases: CaseAwarenessSummary;
  patterns: ObservedPatternSummary[];
  openFollowUpCount: number;
  lastRebuiltAt: string | null;
};

type Props = {
  patientFirstName: string;
  /** Null when no `CopilotPatientState` row exists yet for this
   *  (patient × clinician). Renders the empty-state stub. */
  data: CleoReadCardData | null;
  /**
   * Opens the copilot Sheet. CopilotShell already mounts on the chart
   * (`patients/[id]/page.tsx`) so the card calls this prop and the
   * shell handles the rest. When omitted (e.g. patients with zero
   * signed notes have no shell) the CTA is hidden — there's nothing
   * to deep-link into.
   */
  onAskOpen?: () => void;
};

export function CleoReadCard({ patientFirstName, data, onAskOpen }: Props) {
  if (!data) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-primary/15 bg-primary/[0.03] px-4 py-3">
        <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-tight">
            {COPILOT_DISPLAY_NAME}&apos;s read
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Still learning {patientFirstName}&apos;s chart — ask a question to build context.
          </p>
        </div>
        {onAskOpen && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onAskOpen}
            className="shrink-0 gap-1"
          >
            Ask
            <ArrowRight className="size-3.5" aria-hidden />
          </Button>
        )}
      </div>
    );
  }

  const headlineParts: string[] = [];
  if (data.cases.activeCaseCount > 0) {
    headlineParts.push(
      `${data.cases.activeCaseCount} active case${data.cases.activeCaseCount === 1 ? '' : 's'}`,
    );
  }
  if (data.openFollowUpCount > 0) {
    headlineParts.push(
      `${data.openFollowUpCount} open follow-up${data.openFollowUpCount === 1 ? '' : 's'}`,
    );
  }

  const topPatterns = data.patterns.slice(0, 3);

  return (
    <Card className="border-primary/15 bg-primary/[0.02] shadow-none">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <Sparkles className="size-4 shrink-0 text-primary mt-0.5" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight">
                {COPILOT_DISPLAY_NAME}&apos;s read · {patientFirstName}
              </p>
              {headlineParts.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {headlineParts.join(' · ')}
                </p>
              )}
            </div>
          </div>
          {data.lastRebuiltAt && (
            <span className="text-2xs uppercase tracking-wide text-muted-foreground shrink-0">
              {formatAgo(data.lastRebuiltAt)}
            </span>
          )}
        </div>

        {data.cases.topCaseLabel && (
          <StatusBadge variant="success" noIcon className="text-2xs">
            Your active case: {data.cases.topCaseLabel}
          </StatusBadge>
        )}

        {topPatterns.length > 0 ? (
          <ul className="space-y-1 text-sm text-foreground/90">
            {topPatterns.map((p, i) => (
              <li key={`${p.kind}-${i}`} className="flex items-start gap-2">
                <span aria-hidden className="text-muted-foreground mt-1.5 size-1 rounded-full bg-muted-foreground shrink-0" />
                <span className="leading-snug">{p.label}</span>
              </li>
            ))}
            {data.patterns.length > topPatterns.length && (
              <li className="text-xs text-muted-foreground pl-3">
                +{data.patterns.length - topPatterns.length} more pattern
                {data.patterns.length - topPatterns.length === 1 ? '' : 's'}
              </li>
            )}
          </ul>
        ) : headlineParts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing new to flag — chart is current.</p>
        ) : null}

        {onAskOpen && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onAskOpen}
            className="h-8 px-0 gap-1 text-primary hover:text-primary"
          >
            Ask me anything
            <ArrowRight className="size-3.5" aria-hidden />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function formatAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
