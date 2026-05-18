'use client';

import { cn } from '@/lib/cn';
import type { ProgressStripCell } from '@/lib/notes/derive-progress-strip';

const GLYPH: Record<ProgressStripCell['status'], string> = {
  empty: '○',
  generating: '⟳',
  populated: '●',
  edited: '✏',
  failed: '⚠',
};

const COLOR: Record<ProgressStripCell['status'], string> = {
  empty: 'text-muted-foreground/40',
  generating: 'text-[var(--status-info-fg)] motion-safe:animate-spin',
  populated: 'text-[var(--status-success-fg)]',
  edited: 'text-[var(--status-warning-fg)]',
  failed: 'text-[var(--status-danger-fg)]',
};

/**
 * SectionProgressStrip — horizontal row of glyph + label cells.
 * Per ui-context.md "Section progress strip" and design-critique-capture-flow
 * findings: status is ONE source of truth (the per-section status in
 * Note.inferenceLog), never a duplicated string. Glyphs reinforce color so
 * colorblind users still get the meaning.
 */
export function SectionProgressStrip({
  cells,
  className,
}: {
  cells: ProgressStripCell[];
  className?: string;
}) {
  return (
    <ol
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs',
        className,
      )}
      aria-label="Section progress"
    >
      {cells.map((c) => (
        <li key={c.sectionId} className="flex items-center gap-1">
          <span
            className={cn('inline-block w-3 text-center font-medium', COLOR[c.status])}
            aria-hidden
          >
            {GLYPH[c.status]}
          </span>
          <span className="text-muted-foreground">
            {c.label}
            {c.isRequired && <span className="text-[var(--status-danger-fg)] ml-0.5">*</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
