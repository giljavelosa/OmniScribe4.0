'use client';

import { AlertTriangle } from 'lucide-react';

import { StatusBanner } from '@/components/ui/status-banner';

/**
 * Unit 49 §G — pre-sign intent-fit chip.
 *
 * SOFT nudge surfaced on the /review screen, BENEATH the readiness
 * panel and ABOVE the "Continue to sign" button. Reads only
 * structured fields (Encounter.intent + CaseManagement.primaryIcd —
 * rule 20 safe). Parent gates render on:
 *   - feature flag `cleo.caseRule.v1` ON, AND
 *   - verdict === 'MISFITS' (FITS / LIKELY_FITS render no chip)
 *
 * Pure presentation; parent owns the structured reason string. Does
 * NOT block sign — the clinician proceeds at their discretion. We
 * surface the prompt because catching a typo / wrong-case-attached
 * BEFORE signing is cheaper than an addendum after.
 */
export function IntentFitChip({ reason }: { reason: string }) {
  return (
    <div
      data-testid="intent-fit-chip"
      role="status"
      aria-label="Visit intent doesn't match case ICD"
    >
      <StatusBanner variant="warning" className="text-xs">
        <span className="flex items-start gap-2">
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" aria-hidden />
          <span>{reason}</span>
        </span>
      </StatusBanner>
    </div>
  );
}
