'use client';

import { StatusBadge } from '@/components/ui/status-badge';
import { ChartDetailSheet } from './chart-detail-sheet';
import type { ProblemRow } from './safety-band';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  problems: ProblemRow[];
};

/**
 * ProblemsSheet — full active-problems list, opened from the SafetyBand
 * "+N more" overflow button (Sprint 0.9).
 *
 * Phase 1: episode-derived diagnoses only (ACTIVE + RECERT_DUE).
 * FHIR problem-list integration is Phase 2.
 */
export function ProblemsSheet({ open, onOpenChange, problems }: Props) {
  return (
    <ChartDetailSheet open={open} onOpenChange={onOpenChange} title="Active problems">
      {problems.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active problems on record.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Active cases and clinician-verified uploaded record diagnoses are shown separately by source.
          </p>
          <ul className="space-y-2">
            {problems.map((p) => (
              <li key={p.id} className="rounded-md border border-border bg-background px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge variant={p.sourceKind === 'verified_uploaded_record' ? 'info' : 'neutral'} noIcon>
                    {p.sourceKind === 'verified_uploaded_record' ? 'Verified uploaded record' : 'Active case'}
                  </StatusBadge>
                  <p className="min-w-0 flex-1 text-sm font-medium text-foreground">{p.label}</p>
                </div>
                {(p.sourceLabel || p.pageNumber || p.sourceDate) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.sourceLabel ?? 'Chart source'}
                    {p.pageNumber ? ` · page ${p.pageNumber}` : ''}
                    {p.sourceDate ? ` · ${p.sourceDate.slice(0, 10)}` : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </ChartDetailSheet>
  );
}
