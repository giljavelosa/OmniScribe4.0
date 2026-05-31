import * as React from 'react';

import { cn } from '@/lib/cn';
import { Sparkline, type SparklineTrend } from './sparkline';

export type MetricTrend = SparklineTrend;

/**
 * trendInfo — maps a clinical trend to its glyph, token color, and accessible
 * label. Color is always reinforced with a glyph AND text ("color is never the
 * only signal").
 */
export function trendInfo(trend: MetricTrend): {
  glyph: string;
  colorClass: string;
  label: string;
} {
  switch (trend) {
    case 'improving':
      return { glyph: '↗', colorClass: 'text-[var(--status-success-fg)]', label: 'improving' };
    case 'worsening':
      return { glyph: '↘', colorClass: 'text-[var(--status-warning-fg)]', label: 'worsening' };
    case 'stable':
      return { glyph: '→', colorClass: 'text-muted-foreground', label: 'stable' };
    default:
      return { glyph: '·', colorClass: 'text-muted-foreground', label: 'no trend' };
  }
}

/**
 * MetricStat — a labeled measurement: small label, large tabular value +
 * unit, and an optional bottom row with a real-data sparkline and a trend
 * chip. Server-safe. The sparkline only appears with >= 2 points.
 */
export function MetricStat({
  label,
  value,
  unit,
  trend,
  series,
  className,
}: {
  label: string;
  value: string;
  unit?: string | null;
  trend?: MetricTrend;
  series?: number[];
  className?: string;
}) {
  const showChip = trend && trend !== 'unknown';
  const t = showChip ? trendInfo(trend) : null;
  const hasSeries = !!series && series.length >= 2;

  return (
    <div className={cn('space-y-1.5', className)}>
      <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground leading-none">
        {label}
      </p>
      <p className="flex items-baseline gap-0.5 text-2lg font-semibold tabular-nums leading-none">
        {value}
        {unit ? <span className="text-xs font-normal text-muted-foreground">{unit}</span> : null}
      </p>
      <div className="flex min-h-[1.125rem] items-center gap-2">
        {hasSeries ? <Sparkline points={series!} trend={trend} /> : null}
        {t ? (
          <span
            aria-label={t.label}
            className={cn('inline-flex items-center gap-0.5 text-2xs font-medium', t.colorClass)}
          >
            <span aria-hidden>{t.glyph}</span>
            {t.label}
          </span>
        ) : null}
      </div>
    </div>
  );
}
