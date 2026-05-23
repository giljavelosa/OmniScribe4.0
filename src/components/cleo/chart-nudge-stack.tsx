'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { COPILOT_DISPLAY_NAME } from '@/services/copilot/persona';
import { NudgeCard, type NudgeCardData } from './nudge-card';

/**
 * Sprint 0.18 — chart-side nudge stack.
 *
 * Default-collapsed pill ("Cleo notes N things") that expands to a
 * compact card list. Spec §UI: sits ADJACENT to the active-case hero,
 * not inside it — the hero is "your active case", singular + primary;
 * this stack is "what else should you notice", secondary +
 * collapsible. Per-surface cap of 3 (decision 4) is enforced on the
 * server side by `nudge-selector.ts`; the component renders whatever
 * the loader hands it.
 *
 * Decision 10 (backward compat): when `nudges.length === 0`, the
 * component renders NOTHING — no pill, no block. Sprint 0.16 / 0.17
 * chart behavior is byte-identical for clinicians whose state-rebuild
 * hasn't yet seeded a candidate.
 */
export type ChartNudgeStackProps = {
  nudges: NudgeCardData[];
  /** Optional starting state (used in tests + future "remember
   *  collapsed" via localStorage). */
  defaultOpen?: boolean;
};

export function ChartNudgeStack({ nudges, defaultOpen = false }: ChartNudgeStackProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [items, setItems] = useState<NudgeCardData[]>(nudges);

  if (items.length === 0) return null;

  function removeItem(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id));
  }

  return (
    <div className="rounded-md border border-border bg-muted/20" data-testid="chart-nudge-stack">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className="flex w-full items-center justify-between p-2 text-left hover:bg-muted/40"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm">
          <Sparkles className="size-3.5 text-primary" aria-hidden />
          <span className="font-medium">
            {COPILOT_DISPLAY_NAME} notes {items.length}{' '}
            {items.length === 1 ? 'thing' : 'things'}
          </span>
        </span>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        )}
      </button>
      {open && (
        <div className="space-y-2 p-2 pt-0">
          {items.map((nudge) => (
            <NudgeCard
              key={nudge.id}
              nudge={nudge}
              surface="CHART"
              density="compact"
              onResolved={() => removeItem(nudge.id)}
            />
          ))}
          {items.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">
              All clear — no open notes.
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            className="w-full"
          >
            Collapse
          </Button>
        </div>
      )}
    </div>
  );
}
