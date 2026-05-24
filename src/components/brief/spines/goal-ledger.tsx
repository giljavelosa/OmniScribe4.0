import { CheckCircle2, Circle, CircleDashed, MinusCircle, PauseCircle, XCircle } from 'lucide-react';

import { BriefSection } from '../brief-section';
import { SourcePill } from '../source-pill';
import type { GoalLedgerEntry } from '@/types/brief-intent-shapes';

/**
 * Unit 48 PR3 — full goal ledger for the REHAB Progress Note spine.
 *
 * Distinct from `<GoalsSnapshot>` (cap-3 active goals): a Progress
 * Report MUST address every goal in the POC. This component renders
 * every entry with its status icon, optional delta, and source pill.
 *
 * Source rule (Rule 20): every goal carries `sourceNoteId` for
 * provenance — the source pill anchors the status assertion to the
 * note that established it.
 *
 * Graceful empty: when ledger is empty, the component renders a small
 * banner ("Goal ledger unavailable — open last note") instead of
 * crashing. This matches the spec's "spine sections degrade gracefully
 * when their data is missing" requirement.
 */
export function GoalLedger({ entries }: { entries: GoalLedgerEntry[] }) {
  if (!entries || entries.length === 0) {
    return (
      <BriefSection label="Goal ledger">
        <p className="text-sm text-muted-foreground">
          Goal ledger unavailable — open the last Progress Note for goal context.
        </p>
      </BriefSection>
    );
  }
  return (
    <BriefSection label="Goal ledger" count={entries.length}>
      <ul className="space-y-2" data-testid="goal-ledger">
        {entries.map((entry, idx) => (
          <li
            key={`${entry.goalText.slice(0, 20)}:${idx}`}
            className="flex items-start gap-2"
            data-testid="goal-ledger-row"
            data-goal-type={entry.goalType}
            data-goal-status={entry.status}
          >
            <GoalStatusIcon status={entry.status} />
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mr-1">
                  {entry.goalType}
                </span>
                {entry.goalText}
              </p>
              {entry.delta && (
                <p className="text-xs text-muted-foreground">
                  Δ {entry.delta}
                </p>
              )}
              {/* Date isn't in the GoalLedgerEntry schema (the spine
                  doesn't ask the LLM to emit it — adds noise per row).
                  Use the label override on SourcePill to still link to
                  the source note. */}
              <SourcePill noteId={entry.sourceNoteId} date="" label="source" />
            </div>
          </li>
        ))}
      </ul>
    </BriefSection>
  );
}

function GoalStatusIcon({ status }: { status: GoalLedgerEntry['status'] }) {
  switch (status) {
    case 'MET':
      return (
        <CheckCircle2
          className="size-4 mt-0.5 text-[var(--status-success-fg)]"
          aria-label="Met"
        />
      );
    case 'PARTIALLY_MET':
      return (
        <Circle
          className="size-4 mt-0.5 text-[var(--status-info-fg)]"
          aria-label="Partially met"
        />
      );
    case 'NOT_MET':
      return (
        <XCircle
          className="size-4 mt-0.5 text-[var(--status-danger-fg)]"
          aria-label="Not met"
        />
      );
    case 'MODIFIED':
      return (
        <MinusCircle
          className="size-4 mt-0.5 text-[var(--status-warning-fg)]"
          aria-label="Modified"
        />
      );
    case 'DEFERRED':
      return (
        <PauseCircle
          className="size-4 mt-0.5 text-muted-foreground"
          aria-label="Deferred"
        />
      );
    case 'ACTIVE':
    default:
      return (
        <CircleDashed
          className="size-4 mt-0.5 text-muted-foreground"
          aria-label="Active"
        />
      );
  }
}
