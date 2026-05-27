'use client';

import { ChevronRight } from 'lucide-react';

import type { PatientSnapshotStrip as PatientSnapshotStripData } from '@/lib/snapshots/types';

type Props = {
  strip: PatientSnapshotStripData | null;
  onClick: () => void;
};

function trendInfo(trend: 'improving' | 'stable' | 'worsening' | 'unknown') {
  switch (trend) {
    case 'improving': return { glyph: '↗', colorClass: 'text-[var(--status-success-fg)]', label: 'improving' };
    case 'worsening': return { glyph: '↘', colorClass: 'text-[var(--status-warning-fg)]', label: 'worsening' };
    case 'stable':    return { glyph: '→', colorClass: 'text-muted-foreground', label: 'stable' };
    default:          return { glyph: '·', colorClass: 'text-muted-foreground', label: 'no trend' };
  }
}

/**
 * SnapshotInlineStrip — Option D promoted snapshot (Sprint 0.10).
 *
 * Spans full width at the top of the Overview cockpit. Shows the actual
 * measure values + trend arrows so the clinician sees real clinical numbers
 * without opening a sheet. Clicking anywhere opens the SnapshotDetailSheet.
 */
export function SnapshotInlineStrip({ strip, onClick }: Props) {
  const measures = strip?.measures ?? [];

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-card shadow-sm px-4 py-3 hover:bg-muted/40 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none min-h-[var(--touch-min)]"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Snapshot</p>
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>

      {measures.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No measures yet — they appear after the next signed note.
        </p>
      ) : (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {measures.map((m) => {
            const { glyph, colorClass, label } = trendInfo(m.trend);
            const caseSuffix = m.case ? m.case.label : null;
            return (
              <div key={`${m.measureKey}:${m.case?.id ?? 'none'}`} className="space-y-0.5">
                <p className="text-xs text-muted-foreground leading-none">
                  {m.label}
                  {caseSuffix && (
                    <span className="ml-1 text-[10px] text-muted-foreground/80">
                      · {caseSuffix}
                    </span>
                  )}
                </p>
                <p className="text-sm font-semibold tabular-nums leading-tight">
                  {m.value}
                  {m.unit && (
                    <span className="text-xs font-normal text-muted-foreground ml-0.5">{m.unit}</span>
                  )}
                  <span className={`ml-1 text-sm ${colorClass}`} aria-label={label} title={label}>
                    {glyph}
                  </span>
                </p>
              </div>
            );
          })}
        </div>
      )}
    </button>
  );
}
