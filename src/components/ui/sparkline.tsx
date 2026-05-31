import * as React from 'react';

export type SparklineTrend = 'improving' | 'stable' | 'worsening' | 'unknown';

/** Stroke per clinical trend — color carries meaning, the line carries data. */
const TREND_STROKE: Record<SparklineTrend, string> = {
  improving: 'var(--status-success-fg)',
  worsening: 'var(--status-warning-fg)',
  stable: 'var(--muted-foreground)',
  unknown: 'var(--muted-foreground)',
};

/**
 * Sparkline — token-colored SVG polyline. Real-data-only: renders nothing
 * when fewer than 2 points, so we never fabricate a trend (auditor lens).
 * Decorative (aria-hidden) — the adjacent value + trend chip carry meaning.
 */
export function Sparkline({
  points,
  trend = 'unknown',
  width = 72,
  height = 22,
  className,
}: {
  points: number[];
  trend?: SparklineTrend;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!points || points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const coords = points
    .map((p, i) => {
      const x = pad + (i / (points.length - 1)) * innerW;
      const y = pad + (1 - (p - min) / span) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      className={className}
      aria-hidden
    >
      <polyline
        points={coords}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: TREND_STROKE[trend] }}
      />
    </svg>
  );
}
