'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';
import { AskSurface } from './ask-surface';
import { ResearchSurface } from './research-surface';

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
export function CopilotShell({
  surface,
  noteId,
  patientId,
}: {
  surface: CopilotSurface;
  noteId: string;
  /** Unit 27 — required by AskSurface so the agent can scope tools. The
   *  three call sites (prepare/capture/review) already have the patient
   *  in scope via the Note lookup. */
  patientId: string;
}) {
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
        <SheetContent side="right" className="sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="size-4" aria-hidden="true" />
              Co-Pilot
            </SheetTitle>
          </SheetHeader>
          <Tabs defaultValue="chart" className="flex-1 min-h-0 flex flex-col">
            <TabsList className="mx-4 mt-3">
              <TabsTrigger value="chart">Chart</TabsTrigger>
              <TabsTrigger value="research">Research</TabsTrigger>
            </TabsList>
            <TabsContent value="chart" className="flex-1 min-h-0 mt-3">
              <AskSurface patientId={patientId} noteId={noteId} />
            </TabsContent>
            <TabsContent value="research" className="flex-1 min-h-0 mt-3">
              <ResearchSurface />
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </>
  );
}
