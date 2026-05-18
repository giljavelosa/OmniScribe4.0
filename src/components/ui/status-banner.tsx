import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Check, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * StatusBanner — full-width alert surface for inline messaging.
 * Same color rules as StatusBadge (anti-regression rule 23). ARIA role chosen
 * by variant: alert for danger/warning, status for info/neutral/success.
 */
const statusBannerVariants = cva(
  'flex w-full items-start gap-3 rounded-lg border p-3 text-sm',
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
        neutral: 'bg-muted text-muted-foreground border-border',
      },
    },
    defaultVariants: { variant: 'info' },
  },
);

type BannerVariant = NonNullable<VariantProps<typeof statusBannerVariants>['variant']>;

const DEFAULT_ICONS: Record<BannerVariant, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  success: Check,
  warning: AlertTriangle,
  danger: AlertCircle,
  info: Info,
  neutral: Info,
};

const ARIA_ROLES: Record<BannerVariant, 'alert' | 'status'> = {
  success: 'status',
  warning: 'alert',
  danger: 'alert',
  info: 'status',
  neutral: 'status',
};

export type StatusBannerProps = React.ComponentProps<'div'> &
  VariantProps<typeof statusBannerVariants> & {
    title?: React.ReactNode;
    /** Optional dismiss handler. Renders an X button when provided. */
    onDismiss?: () => void;
    icon?: React.ReactNode;
  };

export function StatusBanner({
  className,
  variant = 'info',
  title,
  icon,
  onDismiss,
  children,
  ...props
}: StatusBannerProps) {
  const v = variant ?? 'info';
  const Icon = DEFAULT_ICONS[v];
  const role = ARIA_ROLES[v];

  return (
    <div
      role={role}
      data-slot="status-banner"
      data-variant={v}
      className={cn(statusBannerVariants({ variant: v }), className)}
      {...props}
    >
      <span className="mt-0.5">
        {icon ?? <Icon className="h-5 w-5" aria-hidden />}
      </span>
      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold leading-tight">{title}</p>}
        {children && <div className={cn(title && 'mt-1')}>{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md p-1 -mr-1 -mt-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

export { statusBannerVariants };
