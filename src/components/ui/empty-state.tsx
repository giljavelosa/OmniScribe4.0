import * as React from 'react';

import { cn } from '@/lib/cn';

type EmptyStateProps = {
  /** Optional muted icon chip (e.g. a lucide icon). */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Caller-supplied CTA, usually a <Button>. */
  action?: React.ReactNode;
  size?: 'sm' | 'md';
  /** 'success' tints the icon chip for composed "all clear" states. */
  tone?: 'muted' | 'success';
  className?: string;
};

/**
 * EmptyState — the single designed empty surface for clinical cards.
 * Server-safe (no hooks). Replaces bare gray sentences so a sparse chart
 * reads as composed, not unfinished. Colors come from tokens only.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  tone = 'muted',
  className,
}: EmptyStateProps) {
  const sm = size === 'sm';
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        sm ? 'gap-1.5 py-4' : 'gap-2 py-8',
        className,
      )}
    >
      {icon && (
        <span
          aria-hidden
          className={cn(
            'flex shrink-0 items-center justify-center rounded-full',
            sm ? 'size-8' : 'size-10',
            tone === 'success'
              ? 'bg-[var(--status-success-bg)] text-[var(--status-success-fg)]'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {icon}
        </span>
      )}
      <p className={cn('font-medium text-foreground', sm ? 'text-sm' : 'text-base')}>{title}</p>
      {description && (
        <p className={cn('max-w-[40ch] text-muted-foreground', sm ? 'text-xs' : 'text-sm')}>
          {description}
        </p>
      )}
      {action && <div className={sm ? 'mt-1' : 'mt-2'}>{action}</div>}
    </div>
  );
}
