'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import type { CleoNudgeKind, CleoNudgePriority } from '@prisma/client';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { COPILOT_DISPLAY_NAME } from '@/services/copilot/persona';
import { NudgeDismissMenu } from './nudge-dismiss-menu';

/**
 * Sprint 0.18 — single proactive nudge card.
 *
 * Renders one Cleo-surfaced nudge with its priority chip, cited
 * evidence, and a single contextual affordance. Used by both the
 * chart pill stack (compact) and the visit-prepare block (expanded).
 *
 * Anti-regression rules:
 *  - Rule 23: priority chip uses `<StatusBadge>` variants
 *    (HIGH→warning, MEDIUM→info, LOW→neutral) — no hardcoded colors.
 *  - Rule 22: dismiss + snooze are one-tap menu actions; no native
 *    confirm.
 *  - Rule 24: affordance is a NAVIGATION (router.push); the clinician
 *    decides on the destination screen. The agent never decides.
 *  - Decision 5: `CLEO_NUDGE_SHOWN` audit fires on FIRST mount via a
 *    `useRef` guard; remounts (navigate away + back) do NOT re-fire.
 *    The endpoint is also server-side idempotent via the `shownAt`
 *    null-guard — defense in depth.
 *  - Decision 7: each kind has a categorical `affordanceSlug` recorded
 *    on `_ACTED` so the auditor can answer "which path did the
 *    clinician take" without scanning labels.
 *  - Decision 9: PHI-bearing label / subtitle never leak into the
 *    audit log (the server route receives nudge metadata only).
 */

export type NudgeCardData = {
  id: string;
  kind: CleoNudgeKind;
  priority: CleoNudgePriority;
  affordanceSlug:
    | 'open-reconcile-flow'
    | 'start-recert-visit'
    | 'open-plan-editor'
    | 'review-failed-writeback'
    | 'reevaluate-goal'
    | (string & {});
  /** PHI-bearing — clinical surface only. */
  label: string;
  /** PHI-bearing optional second line — cited evidence. */
  subtitle?: string | null;
  /** Pre-rendered server-side from sourcePatternSnapshotJson — the
   *  href the affordance navigates to (e.g. `/review/<noteId>` for
   *  a reconcile flow, `/patients/<id>/episodes/<id>` for a recert
   *  start). The page-loader builds this; the card just navigates. */
  affordanceHref?: string;
};

export type NudgeCardSurface = 'CHART' | 'VISIT_PREPARE';

export type NudgeCardProps = {
  nudge: NudgeCardData;
  surface: NudgeCardSurface;
  /** Compact rendering omits the subtitle line + uses smaller padding.
   *  Used by the chart stack; the visit-prepare block defaults to
   *  expanded. */
  density?: 'compact' | 'expanded';
  /** Page-level callback fired after a successful state transition
   *  so the parent can drop the card / collapse the stack. */
  onResolved?: () => void;
};

const AFFORDANCE_LABELS: Record<string, string> = {
  'open-reconcile-flow': 'Resolve drift',
  'start-recert-visit': 'Start recert visit',
  'open-plan-editor': "Open today's plan",
  'review-failed-writeback': 'Review failed write',
  'reevaluate-goal': 'Re-evaluate goal',
};

function priorityToVariant(priority: CleoNudgePriority):
  | 'warning'
  | 'info'
  | 'neutral' {
  if (priority === 'HIGH') return 'warning';
  if (priority === 'MEDIUM') return 'info';
  return 'neutral';
}

function priorityLabel(priority: CleoNudgePriority): string {
  return priority === 'HIGH' ? 'High' : priority === 'MEDIUM' ? 'Medium' : 'Low';
}

export function NudgeCard({
  nudge,
  surface,
  density = 'expanded',
  onResolved,
}: NudgeCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [resolved, setResolved] = useState(false);
  // Decision 5 — fire SHOWN audit only once per logical mount, even if
  // the component re-renders. The server endpoint is also idempotent
  // via the `shownAt IS NOT NULL` guard.
  const shownFiredRef = useRef(false);

  useEffect(() => {
    if (shownFiredRef.current) return;
    if (nudge.id.startsWith('pending:')) return; // selector-synthesized row; no DB id yet
    shownFiredRef.current = true;
    void fetch(`/api/nudges/${nudge.id}/shown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface }),
    }).catch(() => {
      // Best-effort — failure to record SHOWN must not break the
      // render. The audit log will simply lack this row; the
      // worker's PROPOSED audit + the dismiss/act audits still give
      // a meaningful chain.
    });
  }, [nudge.id, surface]);

  function handleAct() {
    if (nudge.id.startsWith('pending:')) {
      // Race: synthesized row from the selector; the worker hasn't
      // upserted yet. Best path is to just navigate; the next
      // rebuild will materialize the row + the read will surface
      // the persisted state.
      if (nudge.affordanceHref) router.push(nudge.affordanceHref);
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/nudges/${nudge.id}/act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ affordanceSlug: nudge.affordanceSlug }),
      });
      if (!res.ok) return; // surface state is the source of truth
      setResolved(true);
      onResolved?.();
      if (nudge.affordanceHref) router.push(nudge.affordanceHref);
    });
  }

  function handleDismiss() {
    if (nudge.id.startsWith('pending:')) {
      setResolved(true);
      onResolved?.();
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/nudges/${nudge.id}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface }),
      });
      if (!res.ok) return;
      setResolved(true);
      onResolved?.();
    });
  }

  function handleSnooze(until: Date) {
    if (nudge.id.startsWith('pending:')) {
      setResolved(true);
      onResolved?.();
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/nudges/${nudge.id}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ until: until.toISOString(), surface }),
      });
      if (!res.ok) return;
      setResolved(true);
      onResolved?.();
    });
  }

  if (resolved) return null;

  return (
    <div
      className={`rounded-md border border-border bg-card ${density === 'compact' ? 'p-2.5' : 'p-3'} space-y-2`}
      data-nudge-kind={nudge.kind}
      data-nudge-surface={surface}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Sparkles
            className="size-3.5 mt-0.5 shrink-0 text-primary"
            aria-hidden
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge variant={priorityToVariant(nudge.priority)} noIcon>
                {priorityLabel(nudge.priority)}
              </StatusBadge>
              <p className="text-sm font-medium">{nudge.label}</p>
            </div>
            {density === 'expanded' && nudge.subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {nudge.subtitle}
              </p>
            )}
          </div>
        </div>
        <NudgeDismissMenu
          onDismiss={handleDismiss}
          onSnooze={handleSnooze}
          disabled={pending}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          From {COPILOT_DISPLAY_NAME}
        </span>
        <Button size="sm" onClick={handleAct} disabled={pending}>
          {AFFORDANCE_LABELS[nudge.affordanceSlug] ?? 'Open'}
        </Button>
      </div>
    </div>
  );
}
