'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';

export type CopilotSurface = 'prepare' | 'capture' | 'review';

/**
 * CopilotShell — Unit 07 / Watch v0.
 *
 * One component owns both the floating Beacon (Sparkles, bottom-right,
 * always-visible) AND the Sheet (slides in from the right). Open/close
 * state lives in local useState; we deliberately do NOT pull in zustand
 * for a single boolean toggle (consistent with Unit 03's D — Context over
 * Zustand when one provider serves one piece of state). Future units may
 * extract a real store when the sheet needs cross-component coordination
 * (e.g., Unit 27 chat history persistence).
 *
 * The Beacon does NOT render on /sign, /admin/*, /owner/*, /login per
 * Unit 07 spec — gating is at the caller (each page decides whether to
 * mount this).
 *
 * Audit semantics: open and close each POST a single client-side audit
 * row (COPILOT_BEACON_OPENED / _CLOSED) with { surface, noteId }. PHI-free
 * by the API contract (route only accepts the fenced shape).
 */
export function CopilotShell({ surface, noteId }: { surface: CopilotSurface; noteId: string }) {
  const [open, setOpen] = useState(false);
  const lastOpenStateRef = useRef(false);

  const fireAudit = useCallback(
    (action: 'COPILOT_BEACON_OPENED' | 'COPILOT_BEACON_CLOSED') => {
      void fetch('/api/audit/copilot-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, surface, noteId }),
        // Audit POST is best-effort: a flaky network shouldn't break the
        // sheet open/close UX. Errors here log to console only.
      }).catch(() => {});
    },
    [surface, noteId],
  );

  // Fire BEACON_OPENED / _CLOSED on every transition (not on initial mount).
  useEffect(() => {
    if (open === lastOpenStateRef.current) return;
    lastOpenStateRef.current = open;
    fireAudit(open ? 'COPILOT_BEACON_OPENED' : 'COPILOT_BEACON_CLOSED');
  }, [open, fireAudit]);

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Co-Pilot"
        size="icon"
        className={cn(
          'fixed bottom-6 right-6 z-50 size-12 rounded-full shadow-lg',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
        )}
      >
        <Sparkles className="size-5" aria-hidden="true" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="size-4" aria-hidden="true" />
              Co-Pilot
            </SheetTitle>
            <SheetDescription>
              Watch mode is on — relevant context surfaces on the page automatically. Ask mode
              (free-form questions, grounded in attested sources) arrives in a later unit.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-3 px-4 pb-4 text-sm">
            <p className="text-muted-foreground">
              For now, see the Watch cards on this screen for open follow-ups and the plan
              prior clinicians flagged for today. Every fact links back to its source note.
            </p>
            <p className="text-xs text-muted-foreground italic">
              The agent loop, FHIR-backed cards, and Ask sheet land in later waves. Every
              capability ships strictly source-grounded — no inferred recommendations.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
