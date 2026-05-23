'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronUp, Minimize2, Send, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';
import { AskSurface } from './ask-surface';
import { ResearchSurface } from './research-surface';
import { COPILOT_DISPLAY_NAME } from '@/services/copilot/persona';

/** Phase 3 — 'patient-cockpit' added so /patients/[id] can mount the
 *  shell. Audit metadata routes through SURFACES on
 *  /api/audit/copilot-event. */
export type CopilotSurface =
  | 'prepare'
  | 'capture'
  | 'review'
  | 'visit'
  | 'patient-cockpit';

type CopilotTab = 'chart' | 'research';

type ViewMode = 'full' | 'compact';

/**
 * CopilotShell — Unit 07 / Watch v0, Sprint 0.7 compact mode.
 *
 * One component owns the floating Beacon (Sparkles, bottom-right,
 * always-visible) AND both the full Sheet view and the new compact
 * strip. Open/close state lives in local useState; we deliberately do
 * NOT pull in zustand for a single boolean toggle.
 *
 * Compact mode (Sprint 0.7) — a thin bottom-right strip that shows
 * only the most-recent assistant message + a one-line input. Useful
 * on screens where the full Sheet covers content the clinician wants
 * to keep reading (capture transcript, visit viewer note body).
 * Toggling between modes preserves the conversation; closing entirely
 * still clears it (per-session in-memory state, consistent with the
 * original Unit 27 contract).
 *
 * Audit semantics: open and close each POST a single client-side audit
 * row (COPILOT_BEACON_OPENED / _CLOSED) with { surface, noteId }.
 * Mode switches are NOT audited — they're local UX state.
 */
export function CopilotShell({
  surface,
  noteId,
  patientId,
  clinicianName,
  patientFirstName,
}: {
  surface: CopilotSurface;
  noteId: string;
  patientId: string;
  /** Unit 42 — threaded into the persona greeting + the empty-state
   *  intro. Optional so mount sites that haven't been updated yet
   *  fall back to a generic "Hi there" salutation. */
  clinicianName?: string | null;
  /** Unit 42 — patient first name only; never last name / MRN /
   *  DOB. Used in the chart-mode greeting template. Undefined on
   *  research-only contexts. */
  patientFirstName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('full');
  const [activeTab, setActiveTab] = useState<CopilotTab>('chart');
  const lastOpenStateRef = useRef(false);
  // Unit 42 — greetingShown refs live in the CopilotShell (which is
  // always mounted) so closing + reopening the Sheet within the same
  // page session does NOT re-greet. The refs are passed down to the
  // surfaces; both surfaces check + mutate them on first message
  // render. A page navigation resets them naturally (new component
  // instance, new refs).
  const chartGreetedRef = useRef(false);
  const researchGreetedRef = useRef(false);

  const fireAudit = useCallback(
    (action: 'COPILOT_BEACON_OPENED' | 'COPILOT_BEACON_CLOSED') => {
      void fetch('/api/audit/copilot-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, surface, noteId }),
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

  // Sprint 0.14 — listen for `cleo:open-sheet` so surface-level CTAs
  // (e.g. CleoReadCard's "Ask me anything") can open the Sheet without
  // a parent prop drill. The shell is always mounted on the chart, so
  // a global event is the lightest-touch coupling.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOpen = () => {
      setOpen(true);
      setViewMode('full');
      setActiveTab('chart');
    };
    window.addEventListener('cleo:open-sheet', onOpen);
    return () => window.removeEventListener('cleo:open-sheet', onOpen);
  }, []);

  function closeShell() {
    setOpen(false);
  }

  function expand() {
    setViewMode('full');
  }

  function collapse() {
    setViewMode('compact');
  }

  // The beacon (sparkle button) only renders when the shell is closed
  // OR in compact mode. Full mode renders the Sheet which has its own
  // close affordance.
  const showBeacon = !open;
  const showFullSheet = open && viewMode === 'full';
  const showCompactStrip = open && viewMode === 'compact';

  return (
    <>
      {showBeacon && (
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
      )}

      {showCompactStrip && (
        <CompactStrip
          patientId={patientId}
          noteId={noteId}
          onExpand={expand}
          onClose={closeShell}
        />
      )}

      <Sheet open={showFullSheet} onOpenChange={(v) => (v ? setOpen(true) : setOpen(false))}>
        <SheetContent side="right" className="sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <SheetTitle className="flex items-center gap-2">
                  <Sparkles className="size-4" aria-hidden="true" />
                  {COPILOT_DISPLAY_NAME}
                </SheetTitle>
                {/* Unit 42 — mode-aware subhead. Derived from the
                    controlled `activeTab` so switching tabs updates
                    the framing in real time. */}
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {activeTab === 'research' ? 'Research assistant' : 'Clinical co-pilot'}
                </p>
                {/* sr-only SheetDescription satisfies Radix's a11y
                    contract — screen readers announce Cleo's purpose
                    when the Sheet opens; sighted users see only the
                    title + subhead above. Silences the
                    "Missing Description or aria-describedby"
                    DialogContent warning that fired every open. */}
                <SheetDescription className="sr-only">
                  {activeTab === 'research'
                    ? `${COPILOT_DISPLAY_NAME} — clinical research assistant. Ask questions about evidence in the medical literature.`
                    : `${COPILOT_DISPLAY_NAME} — clinical co-pilot. Ask questions about this patient and get source-grounded answers from their chart.`}
                </SheetDescription>
              </div>
              <button
                type="button"
                onClick={collapse}
                aria-label={`Minimize ${COPILOT_DISPLAY_NAME}`}
                title="Minimize"
                className={cn(
                  'inline-flex items-center justify-center rounded-md',
                  'h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors',
                )}
              >
                <Minimize2 className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </SheetHeader>
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as CopilotTab)}
            className="flex-1 min-h-0 flex flex-col"
          >
            <TabsList className="mx-4 mt-3">
              <TabsTrigger value="chart">Chart</TabsTrigger>
              <TabsTrigger value="research">Research</TabsTrigger>
            </TabsList>
            {/* forceMount keeps both surfaces mounted so each tab's
                conversation state survives a tab switch. Manually hide the
                inactive panel via data-state styling. */}
            <TabsContent
              value="chart"
              forceMount
              className="flex-1 min-h-0 mt-3 data-[state=inactive]:hidden"
            >
              <AskSurface
                patientId={patientId}
                noteId={noteId}
                clinicianName={clinicianName ?? null}
                patientFirstName={patientFirstName ?? null}
                surface={surface}
                greetedRef={chartGreetedRef}
              />
            </TabsContent>
            <TabsContent
              value="research"
              forceMount
              className="flex-1 min-h-0 mt-3 data-[state=inactive]:hidden"
            >
              <ResearchSurface
                clinicianName={clinicianName ?? null}
                surface={surface}
                greetedRef={researchGreetedRef}
              />
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * Compact strip — fixed bottom-right pill that surfaces a minimal
 * Co-Pilot affordance without taking over the screen. Reads the latest
 * assistant answer from the AskSurface DOM (which keeps its own
 * per-session state) is brittle, so the strip instead exposes its own
 * minimal composer that submits via the same /api/copilot/ask endpoint
 * the full surface uses — and shows a hint to expand to see history.
 *
 * Why no shared store: the existing AskSurface owns its conversation
 * state internally. Cross-extracting that into a context just for the
 * compact view would balloon the change. Compact mode is intentionally
 * a "quick ping" surface; full conversations belong in the expanded view.
 */
function CompactStrip({
  patientId,
  noteId,
  onExpand,
  onClose,
}: {
  patientId: string;
  noteId: string;
  onExpand: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [latestAnswer, setLatestAnswer] = useState<string | null>(null);
  const [hasRichContent, setHasRichContent] = useState(false);

  const placeholder = useMemo(
    () => (latestAnswer ? 'Ask another question…' : 'Ask Miss Cleo a question…'),
    [latestAnswer],
  );

  async function submit() {
    const q = query.trim();
    if (!q || pending) return;
    setPending(true);
    setLatestAnswer(null);
    setHasRichContent(false);
    try {
      const res = await fetch('/api/copilot/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId,
          noteId,
          question: q,
          history: [],
        }),
      });
      if (!res.ok) {
        setLatestAnswer('Could not reach Co-Pilot. Tap to expand and try again.');
        setQuery('');
        return;
      }
      const body = await res.json();
      const answerText: string = body?.data?.answer?.text ?? '';
      const sources = body?.data?.answer?.sources ?? [];
      const drafts = body?.data?.drafts ?? [];
      const steps = body?.data?.reasoningSteps ?? [];
      setLatestAnswer(answerText || 'No response.');
      setHasRichContent(
        (Array.isArray(sources) && sources.length > 0) ||
          (Array.isArray(drafts) && drafts.length > 0) ||
          (Array.isArray(steps) && steps.length > 0),
      );
      setQuery('');
    } catch {
      setLatestAnswer('Could not reach Co-Pilot. Tap to expand and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className={cn(
        'fixed z-50',
        // Mobile: anchored above the bottom nav, full-width minus padding
        'bottom-[5.5rem] left-4 right-4',
        // Desktop: bottom-right corner, fixed width
        'sm:left-auto sm:right-6 sm:bottom-6 sm:w-80',
      )}
    >
      <div className="rounded-xl border border-border bg-card shadow-lg overflow-hidden">
        {/* Header strip */}
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-muted/30 border-b border-border">
          <div className="flex items-center gap-1.5 min-w-0">
            <Sparkles className="size-3.5 text-primary shrink-0" aria-hidden />
            <span className="text-xs font-medium truncate">{COPILOT_DISPLAY_NAME}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onExpand}
              aria-label={`Expand ${COPILOT_DISPLAY_NAME}`}
              title="Expand"
              className="inline-flex items-center justify-center rounded-md h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <ChevronUp className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${COPILOT_DISPLAY_NAME}`}
              title="Close"
              className="inline-flex items-center justify-center rounded-md h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>

        {/* Latest answer (truncated) */}
        {latestAnswer && (
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs text-foreground line-clamp-2 whitespace-pre-wrap">
              {latestAnswer}
            </p>
            {hasRichContent && (
              <button
                type="button"
                onClick={onExpand}
                className="mt-1 text-[10px] uppercase tracking-wide text-primary hover:underline"
              >
                Expand for details ↑
              </button>
            )}
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex items-center gap-1.5 px-2 py-1.5"
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            disabled={pending}
            className="h-8 text-xs"
            aria-label="Ask Co-Pilot"
          />
          <Button
            type="submit"
            size="icon"
            className="size-8 shrink-0"
            disabled={pending || !query.trim()}
            aria-label="Send"
          >
            <Send className="size-3.5" aria-hidden />
          </Button>
        </form>
      </div>
    </div>
  );
}
