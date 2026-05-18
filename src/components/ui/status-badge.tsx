import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Check, AlertTriangle, AlertCircle, Info, Sparkles, Circle } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * StatusBadge — the ONLY way to render a status pill in clinical/admin surfaces.
 * Color is always reinforced with an icon AND text (ui-context.md a11y rule:
 * "Status states ALWAYS reinforced with an icon or text — color is never the only signal").
 * Anti-regression rule 23: no hardcoded status colors anywhere else.
 */
const statusBadgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        success:
          'bg-[var(--status-success-bg)] text-[var(--status-success-fg)] border-[var(--status-success-border)]',
        warning:
          'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] border-[var(--status-warning-border)]',
        danger:
          'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)] border-[var(--status-danger-border)]',
        info: 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)] border-[var(--status-info-border)]',
        violet:
          'bg-[var(--status-violet-bg)] text-[var(--status-violet-fg)] border-[var(--status-violet-border)]',
        neutral: 'bg-muted text-muted-foreground border-border',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
);

type StatusVariant = NonNullable<VariantProps<typeof statusBadgeVariants>['variant']>;

const DEFAULT_ICONS: Record<StatusVariant, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  success: Check,
  warning: AlertTriangle,
  danger: AlertCircle,
  info: Info,
  violet: Sparkles,
  neutral: Circle,
};

export type StatusBadgeProps = React.ComponentProps<'span'> &
  VariantProps<typeof statusBadgeVariants> & {
    /** Override the default icon for this variant. */
    icon?: React.ReactNode;
    /** Hide the icon entirely. Text alone still reinforces meaning. */
    noIcon?: boolean;
  };

export function StatusBadge({
  className,
  variant = 'neutral',
  icon,
  noIcon,
  children,
  ...props
}: StatusBadgeProps) {
  const v = variant ?? 'neutral';
  const Icon = DEFAULT_ICONS[v];

  return (
    <span
      data-slot="status-badge"
      data-variant={v}
      className={cn(statusBadgeVariants({ variant: v }), className)}
      {...props}
    >
      {!noIcon && (icon ?? <Icon className="h-3 w-3" aria-hidden />)}
      <span>{children}</span>
    </span>
  );
}

export { statusBadgeVariants };
