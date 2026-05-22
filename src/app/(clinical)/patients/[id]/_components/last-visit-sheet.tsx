'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import type { VisitHistoryRow } from '@/components/patients/visit-history-list';
import { ChartDetailSheet } from './chart-detail-sheet';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visit: VisitHistoryRow | null;
};

const DIVISION_LABEL: Record<string, string> = {
  MEDICAL: 'Medical',
  REHAB: 'Rehab',
  BEHAVIORAL_HEALTH: 'Behavioral Health',
};

/**
 * LastVisitSheet — drill-down for the "Last visit" cockpit tile.
 * Shows a summary of the most-recent signed visit and provides an
 * "Open full visit" link to the visit viewer (/visits/[noteId]).
 *
 * Read-only, Phase 1 (Sprint 0.9).
 */
export function LastVisitSheet({ open, onOpenChange, visit }: Props) {
  return (
    <ChartDetailSheet open={open} onOpenChange={onOpenChange} title="Last visit">
      {visit == null ? (
        <p className="text-sm text-muted-foreground">No signed visits yet.</p>
      ) : (
        <LastVisitDetail visit={visit} />
      )}
    </ChartDetailSheet>
  );
}

function LastVisitDetail({ visit }: { visit: VisitHistoryRow }) {
  const dateLabel = (visit.signedAt ?? visit.dateOfService ?? '').slice(0, 10);
  const divisionLabel = DIVISION_LABEL[visit.division] ?? visit.division;

  return (
    <div className="space-y-4">
      {/* Identity row */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          {dateLabel && (
            <span className="text-sm font-medium">{dateLabel}</span>
          )}
          <StatusBadge variant="neutral" noIcon className="text-xs">
            {divisionLabel}
          </StatusBadge>
          {visit.isLateEntry && (
            <StatusBadge variant="warning" noIcon className="text-xs">
              Late entry
            </StatusBadge>
          )}
        </div>
        {visit.templateName && (
          <p className="text-sm text-muted-foreground">{visit.templateName}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {visit.clinicianName}
          {visit.clinicianProfessionLabel ? ` · ${visit.clinicianProfessionLabel}` : ''}
        </p>
      </div>

      {/* Assessment snippet */}
      {visit.assessmentSnippet && (
        <div className="rounded-md border border-border bg-muted/40 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
            Assessment
          </p>
          <p className="text-sm text-foreground leading-relaxed">{visit.assessmentSnippet}</p>
        </div>
      )}

      {/* Episode context */}
      {visit.episodeDiagnosis && (
        <p className="text-xs text-muted-foreground">
          Episode: {visit.episodeDiagnosis}
        </p>
      )}

      {/* Open full visit CTA */}
      <Button asChild className="w-full">
        <Link href={`/visits/${visit.id}`}>Open full visit</Link>
      </Button>
    </div>
  );
}
