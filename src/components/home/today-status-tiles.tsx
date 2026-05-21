import Link from 'next/link';

import { cn } from '@/lib/cn';

type Props = {
  visits: number;
  drafts: number;
  followups: number;
};

/**
 * TodayStatusTiles — compact 3-column status row for the home cockpit.
 *
 * Replaces large empty-state cards with tappable tiles that show
 * counts at a glance. Each tile links to the relevant section or page.
 * Used on both the mobile cockpit and the desktop center workspace.
 */
export function TodayStatusTiles({ visits, drafts, followups }: Props) {
  return (
    <div className="grid grid-cols-3 divide-x divide-border border border-border rounded-lg overflow-hidden bg-card">
      <Tile
        count={visits}
        label="Today"
        sublabel="visits"
        href="/home#schedule"
        active={visits > 0}
      />
      <Tile
        count={drafts}
        label="Drafts"
        sublabel="waiting"
        href="/home#drafts"
        active={drafts > 0}
        activeVariant="warning"
      />
      <Tile
        count={followups}
        label="Follow-ups"
        sublabel="open"
        href="/home#followups"
        active={followups > 0}
        activeVariant="info"
      />
    </div>
  );
}

function Tile({
  count,
  label,
  sublabel,
  href,
  active,
  activeVariant = 'default',
}: {
  count: number;
  label: string;
  sublabel: string;
  href: string;
  active: boolean;
  activeVariant?: 'default' | 'warning' | 'info';
}) {
  const countColor = active
    ? activeVariant === 'warning'
      ? 'text-[oklch(0.55_0.18_75)]'
      : activeVariant === 'info'
        ? 'text-[oklch(0.55_0.15_240)]'
        : 'text-foreground'
    : 'text-muted-foreground';

  return (
    <Link
      href={href}
      className={cn(
        'flex flex-col items-center justify-center py-3 px-2 gap-0',
        'hover:bg-muted/40 transition-colors',
        'min-h-[var(--touch-min)]',
      )}
    >
      <span className={cn('text-md font-semibold tabular-nums', countColor)}>
        {count}
      </span>
      <span className="text-xs font-medium text-foreground leading-tight">{label}</span>
      <span className="text-[10px] text-muted-foreground leading-tight">{sublabel}</span>
    </Link>
  );
}
