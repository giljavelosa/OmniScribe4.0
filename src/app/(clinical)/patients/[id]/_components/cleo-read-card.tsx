'use client';

import { ArrowRight, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { COPILOT_DISPLAY_NAME } from '@/services/copilot/persona';

/**
 * Sprint 0.14 — "Cleo's read" chart card.
 *
 * 30-second answer surface — mounts at the TOP of the Overview tab,
 * ABOVE the existing cockpit tiles. Sourced from the server-fetched
 * `CopilotPatientState` for the viewing clinician.
 *
 * Empty state (no state row): a minimal "I'm just learning this patient"
 * stub + an entry CTA to the Ask Sheet. The state gets lazily built on
 * first Ask interaction.
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
  // Empty state — no CopilotPatientState row yet for this clinician.
  // Lazily built on first Ask interaction (per spec decision 7).
  if (!data) {
    return (
      <Card className="border-primary/30 bg-primary/[0.02]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-primary" aria-hidden />
            {COPILOT_DISPLAY_NAME}&apos;s read · {patientFirstName}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            I&apos;m just learning this patient — open the Ask sheet to get
            started.
          </p>
          {onAskOpen && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onAskOpen}
              className="gap-1.5"
            >
              <span>Ask me a question to get started</span>
              <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          )}
        </CardContent>
      </Card>
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

  const topPatterns = data.patterns.slice(0, 4);

  return (
    <Card className="border-primary/30 bg-primary/[0.02]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden />
            {COPILOT_DISPLAY_NAME}&apos;s read · {patientFirstName}
          </span>
          {data.lastRebuiltAt && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-normal">
              Updated {formatAgo(data.lastRebuiltAt)}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {(headlineParts.length > 0 || data.cases.topCaseLabel) && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {headlineParts.length > 0 && (
              <p className="text-muted-foreground">{headlineParts.join(' · ')}</p>
            )}
            {data.cases.topCaseLabel && (
              <StatusBadge variant="success" noIcon>
                Your active case: {data.cases.topCaseLabel}
              </StatusBadge>
            )}
          </div>
        )}

        {topPatterns.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Patterns noted ({data.patterns.length})
            </p>
            <ul className="space-y-1 text-sm">
              {topPatterns.map((p, i) => (
                <li key={`${p.kind}-${i}`} className="flex items-start gap-1.5">
                  <span aria-hidden className="text-muted-foreground mt-0.5">
                    ·
                  </span>
                  <span>{p.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {topPatterns.length === 0 && headlineParts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing new to flag — chart is current.
          </p>
        )}

        {onAskOpen && (
          <div className="pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onAskOpen}
              className="gap-1.5"
            >
              <span>Ask me anything</span>
              <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          </div>
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
