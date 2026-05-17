import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * ProcessingIndicator — three interlocking gears, calm and slow.
 * Three different rotation rates (11s / 7.5s / 8.5s) so the motion never repeats.
 * Honors prefers-reduced-motion (rendered static at 70% opacity).
 *
 * Used throughout the app: /processing/[noteId], async note generation,
 * voice-id matching, brief precompute. ui-context.md "Loading & Progress".
 */
const sizes = cva('text-muted-foreground/40', {
  variants: {
    size: {
      sm: 'h-[44px] w-[44px]',
      md: 'h-[62px] w-[62px]',
      lg: 'h-[84px] w-[84px]',
    },
  },
  defaultVariants: { size: 'md' },
});

export type ProcessingIndicatorProps = React.ComponentProps<'div'> &
  VariantProps<typeof sizes> & {
    label?: string;
  };

export function ProcessingIndicator({
  className,
  size = 'md',
  label = 'Processing',
  ...props
}: ProcessingIndicatorProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn('inline-block', className)}
      {...props}
    >
      <svg
        viewBox="0 0 120 120"
        className={cn(sizes({ size }), 'block')}
        aria-hidden
      >
        <g style={{ transformOrigin: '40px 40px' }} className="motion-safe:animate-[spin_11s_linear_infinite]">
          <Gear cx={40} cy={40} r={20} teeth={8} />
        </g>
        <g style={{ transformOrigin: '85px 50px' }} className="motion-safe:animate-[spin_7.5s_linear_infinite_reverse]">
          <Gear cx={85} cy={50} r={14} teeth={6} />
        </g>
        <g style={{ transformOrigin: '60px 90px' }} className="motion-safe:animate-[spin_8.5s_linear_infinite]">
          <Gear cx={60} cy={90} r={16} teeth={7} />
        </g>
      </svg>
    </div>
  );
}

function Gear({ cx, cy, r, teeth }: { cx: number; cy: number; r: number; teeth: number }) {
  const toothLen = r * 0.18;
  const innerR = r * 0.45;
  return (
    <g fill="currentColor">
      <circle cx={cx} cy={cy} r={r} />
      {Array.from({ length: teeth }).map((_, i) => {
        const angle = (i / teeth) * 360;
        return (
          <rect
            key={i}
            x={cx - 2}
            y={cy - r - toothLen}
            width={4}
            height={toothLen}
            style={{ transformOrigin: `${cx}px ${cy}px`, transform: `rotate(${angle}deg)` }}
          />
        );
      })}
      <circle cx={cx} cy={cy} r={innerR} fill="white" className="dark:fill-[var(--background)]" />
    </g>
  );
}
