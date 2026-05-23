'use client';

import { MoreHorizontal } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

/**
 * Sprint 0.18 — dismiss / snooze picker.
 *
 * Decision 6: dismissal + snooze are one-tap and non-destructive
 * (the pattern will re-emit on the next state rebuild if it persists
 * past the per-kind cooldown). No `<AlertDialog>` — that level of
 * friction is the path to "clinician disables nudges entirely."
 *
 * Snooze durations are 1d / 7d in Sprint 0.18; custom durations are
 * deferred per spec (out of scope).
 */
export type NudgeDismissMenuProps = {
  onDismiss: () => void;
  onSnooze: (until: Date) => void;
  /** Optional disabled state — pending API call. */
  disabled?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function NudgeDismissMenu({ onDismiss, onSnooze, disabled }: NudgeDismissMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label="Nudge actions"
          className="h-7 w-7 p-0"
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={() => onDismiss()}>Dismiss</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onSnooze(new Date(Date.now() + 1 * DAY_MS))}>
          Snooze 1 day
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSnooze(new Date(Date.now() + 7 * DAY_MS))}>
          Snooze 7 days
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
