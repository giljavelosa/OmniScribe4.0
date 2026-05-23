import { AlertTriangle } from 'lucide-react';

import { StatusBanner } from '@/components/ui/status-banner';

/**
 * Sprint 0.16 — reusable EHR ↔ OmniScribe drift banner.
 *
 * Used by the review-screen case-routing panel for the `reconcile`
 * action; Sprint 0.18 will mount the same banner on the Cases tab for
 * any case carrying an unresolved `CaseFhirDriftLog` row. The shape
 * stays narrow: the consumer assembles the resolution radios + the
 * confirm CTA itself; this component is JUST the framing + the
 * 1-2 sentence summary.
 *
 * UI tone (spec decision 8): amber (warning), not red. Drift is a
 * normal-cycle event — the EHR moved, OmniScribe didn't, and that's
 * expected. The banner asks the clinician to reconcile, not to fix
 * an error.
 *
 * Rule 23 (no hardcoded status colors): rendered through StatusBanner
 * with the canonical `variant="warning"`. The icon is `AlertTriangle`
 * (lucide); a small chip below the title can label the drift kind
 * (`STATUS` / `ICD`).
 */
export type CaseFhirDriftBannerProps = {
  /** 1-2 sentence summary the agent emitted (the `reconcileProposal.summary`).
   *  Renders verbatim — the agent already cited both sides + the
   *  recorder. */
  summary: string;
  /** 'STATUS' for status drift, 'ICD' for ICD-code drift. Drives the
   *  small chip beneath the title so the clinician sees the kind at a
   *  glance. */
  driftKind: 'STATUS' | 'ICD';
  /** Optional override for the title — defaults to "EHR ↔ OmniScribe
   *  drift detected" so reused mounts can phrase it differently
   *  (e.g. on the Cases tab: "Drift on this case"). */
  title?: string;
  /** Pass-through for callers that need to anchor a follow-up element
   *  (resolution radios, expandable details) under the banner. */
  children?: React.ReactNode;
};

export function CaseFhirDriftBanner({
  summary,
  driftKind,
  title = 'EHR ↔ OmniScribe drift detected',
  children,
}: CaseFhirDriftBannerProps) {
  return (
    <StatusBanner variant="warning" icon={<AlertTriangle />} title={title}>
      <div className="space-y-2">
        <p className="text-sm leading-relaxed">{summary}</p>
        <p className="text-[10px] uppercase tracking-wide opacity-70">
          drift kind: {driftKind}
        </p>
        {children}
      </div>
    </StatusBanner>
  );
}
