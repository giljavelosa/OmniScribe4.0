'use client';

import { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/cn';

export type ReasoningStep = {
  index: number;
  summary: string;
};

/**
 * ReasoningChain — Unit 31 / Phase 56-60 surface.
 *
 * Renders the agent's chain of thought as a collapsible chip + ordered
 * list under an assistant bubble. Closed by default — most clinicians
 * want the answer; the chain is for trust-verification + audit-aware
 * review. Click the header chip to expand; click again to collapse.
 *
 * Per Rule 23 the chain is TEXT-ONLY — no actionable clinical card
 * shape. Per Unit 31 PHI fence, the summaries shown here are bounded
 * to ≤120 chars per step and the model is instructed to omit patient
 * identifiers (the audit row records only stepIndex + summaryLength,
 * never the text).
 *
 * Renders nothing when `steps` is empty — callers don't need to gate.
 */
export function ReasoningChain({ steps }: { steps: ReasoningStep[] }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5',
          'text-[10px] uppercase tracking-wide text-muted-foreground',
          'hover:text-foreground hover:bg-muted/80 transition-colors',
        )}
        aria-expanded={open}
        aria-controls={`reasoning-chain-${steps[0]!.index}`}
      >
        <Brain className="h-2.5 w-2.5" aria-hidden />
        <span>
          Reasoning chain · {steps.length} step{steps.length === 1 ? '' : 's'}
        </span>
        {open ? (
          <ChevronDown className="h-2.5 w-2.5" aria-hidden />
        ) : (
          <ChevronRight className="h-2.5 w-2.5" aria-hidden />
        )}
      </button>

      {open && (
        <div
          id={`reasoning-chain-${steps[0]!.index}`}
          className="mt-2 rounded-md border border-border bg-muted/30 p-2 space-y-1"
        >
          <ol className="space-y-1">
            {steps.map((step) => (
              <li
                key={step.index}
                className="font-mono text-[11px] text-muted-foreground leading-snug"
              >
                <span className="text-foreground/60">{step.index}.</span>{' '}
                {step.summary}
              </li>
            ))}
          </ol>
          <p className="pt-1 text-[10px] text-muted-foreground italic">
            The agent showed its thinking — useful for trust calibration.
          </p>
        </div>
      )}
    </div>
  );
}
