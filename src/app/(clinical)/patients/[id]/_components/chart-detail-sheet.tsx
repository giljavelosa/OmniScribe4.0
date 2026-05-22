'use client';

import type { ReactNode } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Optional one-line description. Renders visibly under the title
   *  when provided; otherwise an sr-only fallback ("Details for
   *  {title}") satisfies Radix's a11y contract without cluttering the
   *  visual header. Either way the DialogContent aria-describedby
   *  warning is silenced. */
  description?: string;
  children: ReactNode;
};

/**
 * ChartDetailSheet — the standard right-side drill-down panel for the
 * patient chart cockpit (Sprint 0.9). All five cockpit tiles share this
 * wrapper so every drill-down opens, scrolls, and closes identically.
 *
 * Base chart stays frozen underneath (Radix Dialog scroll-locks the
 * background automatically). The sheet body is the only thing that scrolls.
 */
export function ChartDetailSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="sm:max-w-md lg:max-w-lg flex flex-col gap-0 p-0"
      >
        {/* Fixed header — never scrolls; pr-12 clears the built-in X button */}
        <SheetHeader className="border-b pl-6 pr-12 py-4 shrink-0">
          <SheetTitle>{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">
              {`Details for ${title}`}
            </SheetDescription>
          )}
        </SheetHeader>

        {/* Scrollable body — the only thing that moves */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
