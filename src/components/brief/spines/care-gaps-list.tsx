import { CheckCircle2, Circle, Clock } from 'lucide-react';

import { BriefSection } from '../brief-section';
import { SourcePill } from '../source-pill';
import type {
  CareGap,
  DueStatus,
  ImmunizationDue,
  PriorAwvItem,
} from '@/types/brief-intent-shapes';

/**
 * Unit 48 PR4 — MEDICAL Annual Wellness Visit spine component.
 *
 * Four sub-sections:
 *   1. Care gaps (general preventive-care misses)
 *   2. Screenings due (USPSTF-graded screening services)
 *   3. Immunizations due (vaccines)
 *   4. Prior AWV plan items (last AWV's plan, with resolved status)
 *
 * Each item shows a due-status badge (overdue / due_now / due_soon) +
 * the last-completed date + source pill. Prior AWV items show a
 * resolved/unresolved indicator.
 *
 * Graceful empty: any sub-section with zero items is omitted from the
 * render (vs. crashing or showing "no data").
 */
export function CareGapsList({
  careGaps,
  screeningsDue,
  immunizationsDue,
  priorAwvItems,
}: {
  careGaps: CareGap[];
  screeningsDue: CareGap[];
  immunizationsDue: ImmunizationDue[];
  priorAwvItems: PriorAwvItem[];
}) {
  const allEmpty =
    (!careGaps || careGaps.length === 0) &&
    (!screeningsDue || screeningsDue.length === 0) &&
    (!immunizationsDue || immunizationsDue.length === 0) &&
    (!priorAwvItems || priorAwvItems.length === 0);
  if (allEmpty) {
    return (
      <BriefSection label="Annual Wellness Visit prep">
        <p className="text-sm text-muted-foreground">
          Care gaps / screenings / immunizations data unavailable — verify
          against the patient's EHR record before today's AWV.
        </p>
      </BriefSection>
    );
  }
  return (
    <div className="space-y-5" data-testid="awv-spine">
      {careGaps.length > 0 && (
        <BriefSection label="Care gaps" count={careGaps.length}>
          <CareGapRows rows={careGaps} testid="care-gaps" />
        </BriefSection>
      )}
      {screeningsDue.length > 0 && (
        <BriefSection label="Screenings due" count={screeningsDue.length}>
          <CareGapRows rows={screeningsDue} testid="screenings-due" />
        </BriefSection>
      )}
      {immunizationsDue.length > 0 && (
        <BriefSection label="Immunizations due" count={immunizationsDue.length}>
          <ul className="space-y-2" data-testid="immunizations-due">
            {immunizationsDue.map((v, idx) => (
              <li
                key={`${v.vaccine}:${idx}`}
                className="flex items-start gap-2"
                data-testid="immunization-row"
                data-due-status={v.dueStatus}
              >
                <DueStatusBadge status={v.dueStatus} />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm">{v.vaccine}</p>
                  <p className="text-xs text-muted-foreground">
                    last: {v.lastAdministeredDate ?? 'never on file'}
                  </p>
                  <SourcePill noteId={v.source.noteId} date={v.source.date} />
                </div>
              </li>
            ))}
          </ul>
        </BriefSection>
      )}
      {priorAwvItems.length > 0 && (
        <BriefSection label="Prior AWV plan items" count={priorAwvItems.length}>
          <ul className="space-y-2" data-testid="prior-awv-items">
            {priorAwvItems.map((item, idx) => (
              <li
                key={`${item.text.slice(0, 20)}:${idx}`}
                className="flex items-start gap-2"
                data-testid="prior-awv-item-row"
                data-resolved={String(item.resolved)}
              >
                <ResolvedIcon resolved={item.resolved} />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm">{item.text}</p>
                  <SourcePill
                    noteId={item.sourceNoteId}
                    date=""
                    label="prior AWV"
                  />
                </div>
              </li>
            ))}
          </ul>
        </BriefSection>
      )}
    </div>
  );
}

function CareGapRows({ rows, testid }: { rows: CareGap[]; testid: string }) {
  return (
    <ul className="space-y-2" data-testid={testid}>
      {rows.map((row, idx) => (
        <li
          key={`${row.label}:${idx}`}
          className="flex items-start gap-2"
          data-testid="care-gap-row"
          data-due-status={row.dueStatus}
        >
          <DueStatusBadge status={row.dueStatus} />
          <div className="flex-1 min-w-0 space-y-0.5">
            <p className="text-sm">{row.label}</p>
            <p className="text-xs text-muted-foreground">
              last: {row.lastCompletedDate ?? 'never on file'}
            </p>
            <SourcePill noteId={row.source.noteId} date={row.source.date} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function DueStatusBadge({ status }: { status: DueStatus }) {
  const map = {
    overdue: {
      className: 'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]',
      label: 'Overdue',
    },
    due_now: {
      className: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
      label: 'Due now',
    },
    due_soon: {
      className: 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
      label: 'Due soon',
    },
  } as const;
  const { className, label } = map[status];
  return (
    <span
      className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${className}`}
      aria-label={label}
    >
      {label}
    </span>
  );
}

function ResolvedIcon({ resolved }: { resolved: boolean | null }) {
  if (resolved === true) {
    return (
      <CheckCircle2
        className="size-4 mt-0.5 text-[var(--status-success-fg)]"
        aria-label="Resolved since prior AWV"
      />
    );
  }
  if (resolved === false) {
    return (
      <Circle
        className="size-4 mt-0.5 text-[var(--status-warning-fg)]"
        aria-label="Not yet resolved"
      />
    );
  }
  return <Clock className="size-4 mt-0.5 text-muted-foreground" aria-label="Status unknown" />;
}
