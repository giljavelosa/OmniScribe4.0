'use client';

import { ChevronRight } from 'lucide-react';

import { Card } from '@/components/ui/card';

type Props = {
  /** Uppercase muted label row (e.g. "OPEN FOLLOW-UPS"). */
  label: string;
  /** Primary value/count line (e.g. "Open follow-ups (2)"). */
  headline: string;
  onClick: () => void;
};

/**
 * CockpitTile — the atomic unit of the Overview cockpit grid (Sprint 0.9).
 *
 * A small Card with a muted uppercase label, a bold headline, and a
 * right-aligned chevron. The **entire tile** is the click target so it
 * passes the 3-tap / touch-target rule with a single gesture.
 */
export function CockpitTile({ label, headline, onClick }: Props) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="min-h-[4.5rem] px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-muted/40 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none select-none"
    >
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground leading-none">
          {label}
        </p>
        <p className="text-sm font-medium leading-snug truncate">{headline}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Card>
  );
}
