'use client';

import { useAudioLevel } from '../_hooks/capture-state';
import { cn } from '@/lib/cn';

/**
 * 3-bar VU meter. Reads the smoothed RMS from useAudioLevel() — never
 * computes its own level (single source of truth).
 *
 * Per ui-context.md: status reinforced with icon + bars, never color alone.
 * The bars use a single hue (--primary) at varying opacity so colorblind
 * users still get a clear "is the mic hearing me" signal from the heights.
 */
export function AudioLevelBars({ className }: { className?: string }) {
  const level = useAudioLevel();
  // RMS rarely exceeds 0.5 for normal speech; scale up a bit so the bars
  // feel responsive without clipping at quiet conversation levels.
  const scaled = Math.min(1, level * 2.5);

  return (
    <div
      className={cn('inline-flex items-end gap-1 h-6', className)}
      role="meter"
      aria-label="Microphone input level"
      aria-valuenow={Math.round(scaled * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {[0.4, 0.7, 1.0].map((threshold, i) => {
        const active = scaled >= threshold * 0.5;
        const fill = Math.max(0.1, Math.min(1, scaled / threshold));
        return (
          <span
            key={i}
            className={cn(
              'w-1.5 rounded-sm transition-all duration-75',
              active ? 'bg-primary' : 'bg-primary/30',
            )}
            style={{
              height: `${Math.max(20, 60 + i * 20) * Math.max(0.2, fill)}%`,
            }}
            aria-hidden
          />
        );
      })}
    </div>
  );
}
