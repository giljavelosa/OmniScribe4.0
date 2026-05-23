import Link from 'next/link';
import { Sparkles } from 'lucide-react';

import { StatusBadge } from '@/components/ui/status-badge';
import { Card } from '@/components/ui/card';
import type { VisitHistoryRow } from '@/components/patients/visit-history-list';

/**
 * AwaitingRoutingBanner — surfaces signed notes whose case is still in
 * `PENDING_ROUTER` so they don't silently disappear from the chart.
 *
 * Per Sprint 0.13 Decision 3, case linkage is supposed to lock at review
 * before sign — but until that invariant is enforced server-side, a few
 * notes slip through with a still-pending case. CasesPanel deliberately
 * excludes PENDING_ROUTER from its list (so the chart isn't polluted by
 * half-formed cases), which means those visits had no surface at all
 * until now. This banner is the dedicated surface.
 *
 * Renders nothing when there's nothing pending — zero visual weight in
 * the happy path. When work is pending, the clinician sees a single
 * amber chip with a one-tap "Resume" link per note.
 */
export function AwaitingRoutingBanner({ visits }: { visits: VisitHistoryRow[] }) {
  const pending = visits.filter((v) => v.caseManagementStatus === 'PENDING_ROUTER');
  if (pending.length === 0) return null;

  return (
    <Card className="border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]/30 p-3">
      <div className="flex items-start gap-3 flex-wrap">
        <Sparkles
          className="size-4 mt-0.5 text-[var(--status-warning-fg)] shrink-0"
          aria-hidden
        />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="font-medium text-[var(--status-warning-fg)]">
              {pending.length === 1
                ? "Miss Cleo is still routing 1 signed visit."
                : `Miss Cleo is still routing ${pending.length} signed visits.`}
            </span>
            <StatusBadge variant="warning" noIcon>
              Awaiting routing
            </StatusBadge>
          </div>
          <ul className="space-y-1 text-sm">
            {pending.map((v) => (
              <li key={v.id} className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground">
                  {v.dateOfService
                    ? new Date(v.dateOfService).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })
                    : 'unsigned'}
                  {' · '}
                  {v.clinicianName}
                </span>
                <Link
                  href={`/review/${v.id}`}
                  className="text-[var(--status-warning-fg)] underline underline-offset-2 hover:no-underline"
                >
                  Resume in review →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
