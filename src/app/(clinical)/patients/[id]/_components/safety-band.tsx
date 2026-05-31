'use client';

import { AlertTriangle } from 'lucide-react';

import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/cn';
import type { VerifiedAllergyFact } from '@/lib/external-context/verified-chart-facts';

const MAX_VISIBLE_PROBLEMS = 2;
const MAX_LABEL_CHARS = 42;

export type ProblemRow = {
  id: string;
  label: string; // "Diagnosis (body part)" or just "Diagnosis"
  sourceKind?: 'active_case' | 'signed_visit' | 'verified_uploaded_record' | 'clinician_entered';
  sourceLabel?: string | null;
  sourceDate?: string | null;
  pageNumber?: number | null;
};

type Props = {
  /** Active + RECERT_DUE episode problems, pre-derived by the parent. */
  activeProblems: ProblemRow[];
  /** Clinician-verified uploaded document allergy facts. */
  verifiedAllergies?: VerifiedAllergyFact[];
  /** Called when the clinician taps the "+N more" overflow button. */
  onOpenProblems: () => void;
};

function truncateLabel(label: string): string {
  if (label.length <= MAX_LABEL_CHARS) return label;
  return `${label.slice(0, MAX_LABEL_CHARS - 1)}…`;
}

/**
 * SafetyBand — Tier-1 safety strip rendered inside the sticky patient
 * mini-header (Sprint 0.9).  Persists across all four chart tabs.
 *
 * - Allergies: verified uploaded records can satisfy the safety banner
 *   before an EHR is linked. The absence of data stays visible.
 * - Active problems: episode-derived diagnoses plus verified uploaded
 *   document diagnoses.
 *   Truncated to 2 with "+N more" that opens the ProblemsSheet.
 *
 * One compact row on desktop; wraps gracefully on mobile.
 */
export function SafetyBand({
  activeProblems,
  verifiedAllergies = [],
  onOpenProblems,
}: Props) {
  const visible = activeProblems.slice(0, MAX_VISIBLE_PROBLEMS);
  const overflow = activeProblems.length - MAX_VISIBLE_PROBLEMS;
  const visibleAllergyNames = verifiedAllergies.slice(0, 3).map((allergy) => allergy.substance);
  const allergyOverflow = Math.max(0, verifiedAllergies.length - visibleAllergyNames.length);
  const allergyLabel = visibleAllergyNames.length > 0
    ? `${visibleAllergyNames.join(' · ')}${allergyOverflow > 0 ? ` +${allergyOverflow} more` : ''}`
    : 'Allergies not recorded';
  const allergyTitle = verifiedAllergies.length > 0
    ? verifiedAllergies
        .map((allergy) => {
          const reaction = allergy.reaction ? `: ${allergy.reaction}` : '';
          const severity = allergy.severity ? ` (${allergy.severity})` : '';
          return `${allergy.substance}${reaction}${severity} — ${allergy.sourceLabel ?? allergy.documentType}, page ${allergy.sourcePage}`;
        })
        .join('\n')
    : undefined;

  return (
    <div
      data-testid="safety-band"
      className={cn(
        'mt-2 rounded-lg border px-3 py-2',
        'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]/40',
      )}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <AlertTriangle
          className="size-3.5 shrink-0 mt-0.5 text-[var(--status-warning-fg)]"
          aria-hidden
        />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground font-medium">
            Safety
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-snug">
            <StatusBadge
              variant={verifiedAllergies.length > 0 ? 'success' : 'warning'}
              className="text-2xs shrink-0"
              title={allergyTitle}
            >
              {allergyLabel}
            </StatusBadge>

            {activeProblems.length > 0 ? (
              <>
                <span className="text-muted-foreground/60 hidden sm:inline" aria-hidden>
                  |
                </span>
                {visible.map((p) => (
                  <span
                    key={p.id}
                    className="text-foreground/90 truncate max-w-[min(100%,20rem)]"
                    title={p.label}
                  >
                    {truncateLabel(p.label)}
                  </span>
                ))}
                {overflow > 0 && (
                  <button
                    type="button"
                    onClick={onOpenProblems}
                    className="text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm shrink-0"
                  >
                    +{overflow} more
                  </button>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">No active problems on file</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
