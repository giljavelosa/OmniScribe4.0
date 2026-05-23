import { Sparkles } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';

/**
 * PendingRoutingReminder — non-blocking banner shown on the review screen
 * when this note's encounter is still bound to a PENDING_ROUTER case.
 *
 * Sprint 0.13 Decision 3 says case linkage must lock at review before sign.
 * Until that invariant is enforced server-side, this banner is the soft
 * nudge: it sits below Miss Cleo's case-routing panel so it's visible even
 * after the clinician scrolls past it, reminding them to confirm a routing
 * choice before signing. It never blocks the Sign button — the rare case
 * where someone signs anyway still works; we surface those on the patient
 * chart's AwaitingRoutingBanner so they don't disappear.
 */
export function PendingRoutingReminder() {
  return (
    <Card
      role="status"
      className="border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]/30 p-3"
    >
      <div className="flex items-start gap-3">
        <Sparkles
          className="size-4 mt-0.5 text-[var(--status-warning-fg)] shrink-0"
          aria-hidden
        />
        <div className="flex-1 space-y-1 text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-[var(--status-warning-fg)]">
              Confirm Miss Cleo&apos;s routing before signing.
            </span>
            <StatusBadge variant="warning" noIcon>
              Awaiting routing
            </StatusBadge>
          </div>
          <p className="text-muted-foreground">
            This visit&apos;s case is still pending. Pick an option in the
            routing panel above so the case linkage is locked at sign-time.
          </p>
        </div>
      </div>
    </Card>
  );
}
