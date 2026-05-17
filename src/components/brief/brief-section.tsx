'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * BriefSection — generic collapsible labeled section. Section headers are
 * small-caps muted (not buttons) when expanded; the whole row toggles when
 * `collapsible` is true. Per UI spec: top-priority sections (trajectory,
 * follow-ups) are expanded by default; secondary sections collapse.
 */
export function BriefSection({
  label,
  count,
  collapsible = false,
  defaultExpanded = true,
  trailing,
  children,
  className,
}: {
  label: string;
  /** Optional badge-style count surfaced in the header. */
  count?: number;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  /** Optional content (e.g., trend arrow) at the right edge of the header. */
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const showBody = collapsible ? expanded : true;

  return (
    <section
      className={cn('space-y-2', className)}
      aria-label={label}
    >
      <Header
        label={label}
        count={count}
        trailing={trailing}
        collapsible={collapsible}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />
      {showBody && <div className="text-sm leading-relaxed">{children}</div>}
    </section>
  );
}

function Header({
  label,
  count,
  trailing,
  collapsible,
  expanded,
  onToggle,
}: {
  label: string;
  count?: number;
  trailing?: ReactNode;
  collapsible: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const labelText =
    count !== undefined ? `${label} (${count})` : label;

  if (!collapsible) {
    return (
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{labelText}</p>
        {trailing}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="flex w-full items-center justify-between text-left"
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground">
        <span aria-hidden="true" className="mr-1 inline-block w-2 text-foreground">
          {expanded ? '▼' : '▶'}
        </span>
        {labelText}
      </span>
      {trailing}
    </button>
  );
}
