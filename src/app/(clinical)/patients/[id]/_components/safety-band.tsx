'use client';

import { StatusBadge } from '@/components/ui/status-badge';

const MAX_VISIBLE_PROBLEMS = 3;

export type ProblemRow = {
  id: string;
  label: string; // "Diagnosis (body part)" or just "Diagnosis"
};

type Props = {
  /** Active + RECERT_DUE episode problems, pre-derived by the parent. */
  activeProblems: ProblemRow[];
  /** Called when the clinician taps the "+N more" overflow button. */
  onOpenProblems: () => void;
};

/**
 * SafetyBand — Tier-1 safety strip rendered inside the sticky patient
 * mini-header (Sprint 0.9).  Persists across all four chart tabs.
 *
 * - Allergies: Phase 1 always renders as "Allergies not recorded" (warning).
 *   The absence of data must be visible — silent omission is a patient-safety
 *   risk. FHIR wire-up in Phase 2.
 * - Active problems: episode-derived diagnoses (ACTIVE + RECERT_DUE).
 *   Truncated to 3 with "+N more" that opens the ProblemsSheet.
 *
 * One line on desktop; wraps gracefully on mobile. Kept visually quiet
 * (small text, no heavy borders) so it never competes with content.
 */
export function SafetyBand({ activeProblems, onOpenProblems }: Props) {
  const visible = activeProblems.slice(0, MAX_VISIBLE_PROBLEMS);
  const overflow = activeProblems.length - MAX_VISIBLE_PROBLEMS;

  return (
    <div className="flex items-center gap-1.5 flex-wrap py-1.5">
      {/* Allergies — Phase 1: always "not recorded" */}
      <StatusBadge variant="warning" className="text-xs">
        Allergies not recorded
      </StatusBadge>

      {activeProblems.length > 0 && (
        <span className="text-xs text-muted-foreground" aria-hidden="true">
          ·
        </span>
      )}

      {/* Active problems — episode-derived */}
      {visible.map((p) => (
        <StatusBadge key={p.id} variant="neutral" noIcon className="text-xs">
          {p.label}
        </StatusBadge>
      ))}

      {overflow > 0 && (
        <button
          type="button"
          onClick={onOpenProblems}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          +{overflow} more
        </button>
      )}

      {activeProblems.length === 0 && (
        <StatusBadge variant="neutral" noIcon className="text-xs">
          No active problems
        </StatusBadge>
      )}
    </div>
  );
}
