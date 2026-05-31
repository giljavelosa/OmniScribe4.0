'use client';

import { Mic } from 'lucide-react';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { SectionLabel } from '@/components/ui/section-label';
import { MeterBar } from '@/components/ui/meter-bar';
import type { CasePanelData } from './cases-panel';

const DAY_MS = 86_400_000;

function recertDaysRemaining(dueAtIso: string | null): number | null {
  if (!dueAtIso) return null;
  const due = new Date(dueAtIso).getTime();
  if (Number.isNaN(due)) return null;
  return Math.ceil((due - Date.now()) / DAY_MS);
}

type Props = {
  caseRow: CasePanelData;
  canEdit: boolean;
  onContinueCase?: (caseId: string) => void;
};

/**
 * CaseSpotlightCard — a read-only Overview echo of the active-case hero.
 * Surfaces the primary diagnosis + recert/visit-cap meters at a glance so
 * the clinician sees the active problem without leaving Overview. Only
 * rendered when there's an active case (the parent guards). The Continue
 * affordance reuses the existing onContinueCase → StartVisitDialog flow.
 */
export function CaseSpotlightCard({ caseRow, canEdit, onContinueCase }: Props) {
  const episode =
    caseRow.rehabEpisodes.find((e) => e.status === 'ACTIVE' || e.status === 'RECERT_DUE') ??
    caseRow.rehabEpisodes[0] ??
    null;

  const daysRemaining = episode ? recertDaysRemaining(episode.recertDueAt) : null;
  const recertWarning = daysRemaining !== null && daysRemaining <= 14;

  const showVisits =
    !!episode && episode.visitsAuthorized !== null && episode.visitsAuthorized > 0;
  const visitsRemaining = showVisits
    ? episode!.visitsAuthorized! - episode!.visitsCompleted
    : null;
  const visitsWarning = visitsRemaining !== null && visitsRemaining <= 2;

  const canContinue = canEdit && !!onContinueCase && caseRow.status === 'ACTIVE';

  return (
    <Card variant="elevated" className="gap-0 py-0 overflow-hidden">
      <CardHeader className="px-5 pt-4 pb-0 flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SectionLabel>Active case</SectionLabel>
          <StatusBadge variant="success" noIcon className="text-2xs">
            Active
          </StatusBadge>
        </div>
      </CardHeader>
      <CardContent className="px-5 pt-2.5 pb-4 space-y-3">
        <div className="space-y-1">
          <p className="text-base font-semibold leading-snug text-foreground">
            {caseRow.primaryIcdLabel}
          </p>
          {caseRow.primaryIcd ? (
            <p className="text-xs font-mono text-muted-foreground">{caseRow.primaryIcd}</p>
          ) : (
            <StatusBadge variant="warning" noIcon className="text-2xs">
              Needs coding
            </StatusBadge>
          )}
        </div>

        {(daysRemaining !== null || showVisits) && (
          <div className="space-y-2.5 pt-0.5">
            {daysRemaining !== null && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xs uppercase tracking-wide text-muted-foreground">
                    Recert window
                  </span>
                  <StatusBadge
                    variant={recertWarning ? 'warning' : 'neutral'}
                    noIcon
                    className="text-2xs"
                  >
                    {daysRemaining <= 0 ? 'Recert due' : `${daysRemaining}d left`}
                  </StatusBadge>
                </div>
                <MeterBar
                  value={Math.max(0, episode!.recertIntervalDays - Math.max(0, daysRemaining))}
                  max={episode!.recertIntervalDays}
                  variant={recertWarning ? 'warning' : 'primary'}
                  aria-label={`Recert window, ${daysRemaining} days remaining`}
                />
              </div>
            )}

            {showVisits && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xs uppercase tracking-wide text-muted-foreground">
                    Visits used
                  </span>
                  <StatusBadge
                    variant={visitsWarning ? 'warning' : 'neutral'}
                    noIcon
                    className="text-2xs"
                  >
                    {episode!.visitsCompleted}/{episode!.visitsAuthorized} visits
                  </StatusBadge>
                </div>
                <MeterBar
                  value={episode!.visitsCompleted}
                  max={episode!.visitsAuthorized!}
                  variant={visitsWarning ? 'warning' : 'primary'}
                  aria-label={`${episode!.visitsCompleted} of ${episode!.visitsAuthorized} authorized visits used`}
                />
              </div>
            )}
          </div>
        )}

        {canContinue && (
          <Button
            type="button"
            size="sm"
            className="gap-1.5 w-full"
            onClick={() => onContinueCase!(caseRow.id)}
          >
            <Mic className="size-3.5" aria-hidden />
            Continue this case in a new visit
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
