'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';

import { COPILOT_DISPLAY_NAME } from '@/services/copilot/persona';
import { NudgeCard, type NudgeCardData } from './nudge-card';

/**
 * Sprint 0.18 — visit-prepare nudge block.
 *
 * Always-expanded list of up to 3 nudges (per-surface cap enforced
 * server-side). Lives above the recording controls on
 * `/prepare/[noteId]` per spec §goal — "the visit-prepare surface is
 * where most actionable nudges shine."
 *
 * Decision 10 — when zero nudges, renders nothing.
 */
export type PrepareNudgeBlockProps = {
  nudges: NudgeCardData[];
};

export function PrepareNudgeBlock({ nudges }: PrepareNudgeBlockProps) {
  const [items, setItems] = useState<NudgeCardData[]>(nudges);

  if (items.length === 0) return null;

  function removeItem(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id));
  }

  return (
    <section
      className="rounded-md border border-border bg-card p-3 space-y-3"
      aria-labelledby="prepare-nudge-block-title"
      data-testid="prepare-nudge-block"
    >
      <header className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h3
          id="prepare-nudge-block-title"
          className="text-sm font-semibold"
        >
          Before this visit, {COPILOT_DISPLAY_NAME} noticed
        </h3>
      </header>
      <div className="space-y-2">
        {items.map((nudge) => (
          <NudgeCard
            key={nudge.id}
            nudge={nudge}
            surface="VISIT_PREPARE"
            density="expanded"
            onResolved={() => removeItem(nudge.id)}
          />
        ))}
      </div>
    </section>
  );
}
