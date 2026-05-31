'use client';

import { CalendarClock, ChevronRight } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { SectionLabel } from '@/components/ui/section-label';
import { EmptyState } from '@/components/ui/empty-state';

type Props = {
  hasVisit: boolean;
  /** Visit headline — template name (falls back to "Visit"). */
  headline: string;
  /** Secondary line — relative date · clinician. */
  meta?: string;
  /** Assessment excerpt, clamped to 3 lines. */
  snippet?: string | null;
  onOpen: () => void;
};

/**
 * LastVisitCard — compact rail card surfacing the most recent signed visit.
 * Whole card is the click target (opens LastVisitSheet). Empty → composed
 * "No visits yet" state instead of a ragged box.
 */
export function LastVisitCard({ hasVisit, headline, meta, snippet, onOpen }: Props) {
  if (!hasVisit) {
    return (
      <Card className="gap-0 py-0">
        <CardContent className="px-4 py-4">
          <EmptyState
            size="sm"
            icon={<CalendarClock className="size-4" />}
            title="No visits yet"
            description="Signed visits appear here."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      variant="interactive"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="gap-0 py-0"
    >
      <CardContent className="px-4 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <SectionLabel>Last visit</SectionLabel>
            <p className="text-sm font-semibold leading-snug text-foreground mt-1.5 truncate">
              {headline}
            </p>
            {meta && <p className="text-xs text-muted-foreground leading-tight mt-0.5">{meta}</p>}
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/70 mt-0.5" aria-hidden />
        </div>
        {snippet && (
          <p className="text-sm text-foreground/80 leading-snug mt-2.5 line-clamp-3">{snippet}</p>
        )}
      </CardContent>
    </Card>
  );
}
