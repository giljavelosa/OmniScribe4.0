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
            Derived from active episodes of care. FHIR problem-list integration in Phase 2.
          </p>
          <ul className="space-y-2">
            {problems.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <StatusBadge variant="neutral" noIcon className="text-sm">
                  {p.label}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </>
      )}
    </ChartDetailSheet>
  );
}
