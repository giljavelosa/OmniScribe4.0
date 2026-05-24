'use client';

import { Compass } from 'lucide-react';
import { EncounterIntent, type Division } from '@prisma/client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { INTENT_DISPLAY_LABEL, intentsForDivision } from '@/services/copilot/intent-labels';

/**
 * Unit 48 PR2 — Miss Cleo's visit-type intent chip.
 *
 * Renders at the top of the `<StartVisitDialog>` when the caller has
 * pre-fetched a proposal from `GET /api/patients/[id]/proposed-intent`.
 * Cleo proposes; the chip is preselected to that proposal with the
 * `reason` shown as helper text below. The clinician confirms by
 * leaving the chip alone (auto-post / start-visit fires with the
 * proposal) OR overrides via the dropdown (division-filtered intent list
 * in stable archetype order).
 *
 * Decision 7 (silent + safe fallback): when `proposedIntent.intent` is
 * UNSPECIFIED, the chip reads *"Visit type — choose ▾"* and the
 * helper text invites the clinician to pick from the dropdown. Auto-post
 * in `AutoPostShell` defers until the clinician picks (handled by the
 * parent dialog's confidence-aware logic — see start-visit-dialog.tsx).
 *
 * This component is a controlled `<Select>` wrapped in a labeled box —
 * no internal state. The parent owns `value` + `onChange` and decides
 * what to do with the selection.
 */
export type IntentChipProps = {
  /** Cleo's deterministic proposal. The label/reason fields here drive
   *  the chip's display when no override has been selected. */
  proposedIntent: {
    intent: EncounterIntent;
    reason: string;
    confidence: 'high' | 'medium' | 'low';
  };
  /** Currently selected intent (controlled). Initially set to
   *  `proposedIntent.intent` by the parent; updates on every override. */
  value: EncounterIntent;
  /** Fired when the clinician picks a different intent from the dropdown.
   *  Parent should also track whether the new value === proposedIntent
   *  to decide the IntentSource (COPILOT_PROPOSAL_CONFIRMED vs CLINICIAN). */
  onChange: (next: EncounterIntent) => void;
  /** Clinician's division — determines which intents appear in the
   *  override dropdown. Required because the proposer might return
   *  UNSPECIFIED in which case there's no division hint in the proposal
   *  itself. */
  division: Division;
  /** Disabled when the dialog is mid-submit. */
  disabled?: boolean;
};

export function IntentChip({
  proposedIntent,
  value,
  onChange,
  division,
  disabled,
}: IntentChipProps) {
  const options = intentsForDivision(division);
  const isProposalActive = value === proposedIntent.intent;
  const helperText = isProposalActive
    ? proposedIntent.reason
    : `was: ${INTENT_DISPLAY_LABEL[proposedIntent.intent]} — you changed it`;

  return (
    <div
      className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3"
      data-testid="intent-chip"
      data-intent={value}
      data-intent-source={isProposalActive ? 'copilot-proposal' : 'clinician-override'}
    >
      <div className="flex items-center gap-2">
        <Compass
          className="size-3.5 text-muted-foreground shrink-0"
          aria-hidden
        />
        <Select
          value={value}
          onValueChange={(v) => onChange(v as EncounterIntent)}
          disabled={disabled}
        >
          <SelectTrigger
            className="h-8 w-full border-none bg-transparent p-0 font-medium shadow-none focus:ring-0 focus:ring-offset-0"
            aria-label="Visit type for this encounter"
          >
            <SelectValue placeholder={INTENT_DISPLAY_LABEL[EncounterIntent.UNSPECIFIED]}>
              {INTENT_DISPLAY_LABEL[value]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {INTENT_DISPLAY_LABEL[opt]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="pl-5 text-xs text-muted-foreground" data-testid="intent-chip-reason">
        {helperText}
      </p>
    </div>
  );
}

/**
 * Helper the parent dialog uses to decide what `intentSource` to send
 * to the server. Lives here so the chip + submitter share one definition
 * of "did the clinician override?"
 */
export function deriveIntentSource(
  selected: EncounterIntent,
  proposed: EncounterIntent,
): 'CLINICIAN' | 'COPILOT_PROPOSAL_CONFIRMED' {
  if (selected === proposed && proposed !== EncounterIntent.UNSPECIFIED) {
    return 'COPILOT_PROPOSAL_CONFIRMED';
  }
  return 'CLINICIAN';
}
