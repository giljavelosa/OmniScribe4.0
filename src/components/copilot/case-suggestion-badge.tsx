'use client';

import { Sparkles } from 'lucide-react';

import { StatusBadge } from '@/components/ui/status-badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Unit 49 §F — small "Cleo: best match" badge with a hover-tooltip that
 * shows the structured reason. Rendered ONLY when:
 *
 *   - `cleo.caseRule.v1` feature flag is ON for the org (parent gates
 *     the render — this component assumes the gate already passed), AND
 *   - `/api/patients/[id]/case-suggestions` returned a non-null nominee
 *
 * Pure presentation; doesn't fetch. Parent passes the reason string
 * straight from the API response (`data.nominee.reason`) so audit
 * logs can match what the clinician saw exactly.
 *
 * Accessibility:
 *   - aria-label includes the reason for screen readers
 *   - sparkle icon is decorative (aria-hidden)
 *   - tooltip is keyboard-focusable via TooltipProvider
 *
 * Styling uses the existing `<StatusBadge variant="info">` so it sits
 * naturally inside `<CaseRadio>` next to the StatusBadge for "Your
 * active case" / "Most recent case" already there.
 */
export function CaseSuggestionBadge({ reason }: { reason: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span data-testid="case-suggestion-badge" tabIndex={0} aria-label={`Cleo recommends: ${reason}`}>
            <StatusBadge variant="info" noIcon className="text-[10px] gap-1">
              <Sparkles className="size-2.5" aria-hidden />
              Cleo: best match
            </StatusBadge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-[280px] text-xs">
          {reason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
