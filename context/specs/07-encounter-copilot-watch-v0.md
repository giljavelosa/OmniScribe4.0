# Unit 07: Encounter Copilot — Watch v0 (+ Beacon)

## Goal

Ship the first surface of the agentic clinical copilot. Build the always-available beacon (Sparkles icon, bottom-right) and two **Watch v0** cards (open-follow-ups, plan-for-today) that surface clinically-relevant data on the `/prepare` and `/capture` surfaces — without asking. The chat sheet (Ask mode) is built later in Unit 27; v0 ships the beacon with a placeholder. All copilot reads are Rule-20 attested-source only.

## Design

Read [`journeys/05-copilot-ask-mode.md`](../../journeys/05-copilot-ask-mode.md) for the Ask mode user experience (which the beacon will eventually enable) and [`references/encounter-copilot-spec.md`](../../references/encounter-copilot-spec.md) for the full copilot architecture (Phases 50–60 — this unit ships Phase 50–51).

### Mental model — one Co-Pilot, two modes

- **Watch (proactive)** — copilot surfaces context without the clinician asking. v0 = 2 cards. v1 (Unit 25) adds FHIR-backed cards.
- **Ask (reactive)** — always-available beacon → chat sheet. **v0 ships the beacon only**; sheet shows placeholder "Ask mode coming soon."

### Beacon

A small floating button in the bottom-right of `/prepare/[noteId]` and `/capture/[noteId]` and `/review/[noteId]`.

- Lucide `Sparkles` icon
- 48 × 48 px touch target
- Filled primary teal
- `aria-label="Open Co-Pilot"`
- Always-visible (does not move with scroll)
- NOT rendered on `/sign`, `/admin/*`, `/owner/*`, `/login` in v0

### Watch cards — open follow-ups

`<OpenFollowUpsCard>` rendered:
- On `/prepare/[noteId]` — right column, above setup form (alongside `<BriefCard>`)
- On `/capture/[noteId]` — right pane (desktop) or History tab (mobile), below `<PriorContextPanel>`

Content: lists open `FollowUp` rows for `(patient, episode if any)`. Each row:
- Status glyph `○` (open)
- Follow-up text
- Source pill ("from Progress Note · 2026-04-22") → tap = open source note section
- Inline buttons: Met / Drop / Carry (POSTs `/api/follow-ups/[id]/close` — already in Unit 06)

Empty state: "No open follow-ups from the last visit." (calm; no faux empty illustration)

### Watch cards — plan for today

`<PlanForTodayCard>` rendered alongside `<OpenFollowUpsCard>`. Content: bulleted list of `carryForwardPlan` items from the most-recent `NoteBrief`. Each item has a source pill.

- NOT actionable — these are reminders, not commitments
- Empty state: "No carry-forward plan from the last visit."

### Card visual rules (per Rule 23)

- **Data only** — never a clinical recommendation
- **Provenance mandatory** — every fact has a source pill; no pill = no render
- **Explicit-tap dismissal only** — cards don't auto-dismiss

### Performance budget

- Cards render < 100 ms after page is interactive (data already loaded with the brief)
- Beacon is interactive < 50 ms after first paint
- No card render adds LCP delay

## Implementation

### A. `<CopilotBeacon>` component

`src/components/copilot/CopilotBeacon.tsx`:

```tsx
'use client';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCopilotSheet } from './use-copilot-sheet';

export function CopilotBeacon() {
  const { open } = useCopilotSheet();
  return (
    <Button
      onClick={open}
      aria-label="Open Co-Pilot"
      className="fixed bottom-6 right-6 size-12 rounded-full shadow-lg z-50"
      variant="default"
    >
      <Sparkles className="size-5" aria-hidden="true" />
    </Button>
  );
}
```

Rendered in `/prepare/[noteId]/page.tsx`, `/capture/[noteId]/page.tsx`, `/review/[noteId]/page.tsx`.

### B. `<CopilotSheet>` (v0 placeholder)

`src/components/copilot/CopilotSheet.tsx`:

```tsx
'use client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useCopilotSheet } from './use-copilot-sheet';

export function CopilotSheet() {
  const { isOpen, close } = useCopilotSheet();
  return (
    <Sheet open={isOpen} onOpenChange={close}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Co-Pilot</SheetTitle>
        </SheetHeader>
        <div className="text-muted-foreground mt-8 text-sm">
          Ask mode coming soon. For now, see the Watch cards on the screen for follow-ups and plan reminders.
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

Unit 27 replaces the placeholder with the agent loop.

### C. `useCopilotSheet` hook (Zustand)

`src/components/copilot/use-copilot-sheet.ts`:

```ts
'use client';
import { create } from 'zustand';

interface CopilotSheetState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useCopilotSheet = create<CopilotSheetState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
```

### D. `<OpenFollowUpsCard>` component

`src/components/copilot/cards/OpenFollowUpsCard.tsx`:

```tsx
'use client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import type { FollowUpPreview } from '@/types/brief';
import { useTransition } from 'react';

interface Props {
  followUps: FollowUpPreview[];
  currentNoteId: string;
  onCloseFollowUp: (id: string, status: 'MET' | 'DROPPED' | 'CARRIED') => Promise<void>;
  onAuditRender?: () => void; // fires once on mount for COPILOT_CARD_RENDERED
}

export function OpenFollowUpsCard({ followUps, currentNoteId, onCloseFollowUp, onAuditRender }: Props) {
  // Fire COPILOT_CARD_RENDERED audit on mount (once)
  // ...
  
  if (followUps.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Open follow-ups</CardTitle></CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          No open follow-ups from the last visit.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open follow-ups from last visit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {followUps.map(fu => (
          <FollowUpRow key={fu.followUpId} item={fu} onClose={onCloseFollowUp} />
        ))}
      </CardContent>
    </Card>
  );
}

function FollowUpRow({ item, onClose }: { item: FollowUpPreview; onClose: (id: string, status: 'MET' | 'DROPPED' | 'CARRIED') => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <span aria-hidden="true">○</span>
        <span className="text-sm flex-1">{item.text}</span>
      </div>
      <div className="flex items-center justify-between">
        <a
          href={`/review/${item.source.noteId}`}
          className="text-xs text-muted-foreground hover:underline"
        >
          from {item.source.date}
        </a>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(() => onClose(item.followUpId, 'MET'))}>Met</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(() => onClose(item.followUpId, 'DROPPED'))}>Drop</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(() => onClose(item.followUpId, 'CARRIED'))}>Carry</Button>
        </div>
      </div>
    </div>
  );
}
```

### E. `<PlanForTodayCard>` component

`src/components/copilot/cards/PlanForTodayCard.tsx`:

```tsx
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

interface Props {
  items: { text: string; source: { noteId: string; date: string } }[];
  onAuditRender?: () => void;
}

export function PlanForTodayCard({ items, onAuditRender }: Props) {
  // Fire COPILOT_CARD_RENDERED audit on mount (once)
  
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Plan said for today</CardTitle></CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          No carry-forward plan from the last visit.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle>Plan said for today</CardTitle></CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="text-sm">
              <div>{item.text}</div>
              <a href={`/review/${item.source.noteId}`} className="text-xs text-muted-foreground hover:underline">
                from {item.source.date}
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
```

### F. Data loading

Both cards read from existing data loaded by `/prepare` and `/capture`:
- `<OpenFollowUpsCard>` consumes `FollowUp[]` rows already fetched for the brief
- `<PlanForTodayCard>` consumes `NoteBrief.content.carryForwardPlan`

**No new queries**. The cards are a thin UI layer on data already on the page.

### G. Audit logging

On card render (once per page load) and beacon open:

- `POST /api/audit/copilot-event` (lightweight endpoint specifically for client-side copilot events)
- Audit actions: `COPILOT_CARD_RENDERED` (with `cardType: 'open-followups' | 'plan-for-today'`, `itemCount`, `surface: 'prepare' | 'capture' | 'review'`, `noteId`), `COPILOT_BEACON_OPENED` (with `surface`, `noteId`)
- No PHI in metadata

### H. Rule-20 enforcement (cross-cut)

- `<OpenFollowUpsCard>` reads `FollowUp` rows — these come from signed-note extraction (Unit 06 §C); Rule 20 satisfied
- `<PlanForTodayCard>` reads `NoteBrief.content.carryForwardPlan` — brief is from signed notes only (Unit 06 §D); Rule 20 satisfied

**No card may EVER read from `Note.draftJson` or any non-signed source.** Lint rule (or CI grep): cards in `src/components/copilot/cards/` must not import anything that touches drafts.

### I. Rule-23 enforcement (no recommendations)

v0 cards surface only:
- Items the prior clinician explicitly wrote (Plan items, Follow-ups)
- Items the current clinician confirmed (closed follow-ups)

Cards NEVER surface:
- LLM-generated suggestions
- Inferred patterns
- Recommendations

If a future card needs reasoning, that's an Ask-mode tool (Unit 27), not a Watch card.

### J. Integration with `/prepare`, `/capture`, `/review`

`/prepare/[noteId]/page.tsx`:

```tsx
import { CopilotBeacon } from '@/components/copilot/CopilotBeacon';
import { CopilotSheet } from '@/components/copilot/CopilotSheet';
import { OpenFollowUpsCard } from '@/components/copilot/cards/OpenFollowUpsCard';
import { PlanForTodayCard } from '@/components/copilot/cards/PlanForTodayCard';
import { BriefCard } from '@/components/brief/BriefCard';
// ...

export default async function PreparePage({ params }) {
  // Load Note + Patient + Brief + Open follow-ups (in parallel)
  const [note, patient, brief, openFollowUps] = await Promise.all([...]);
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2">
        <PatientIdentityHeader patient={patient} />
        {brief ? <BriefCard brief={brief} /> : <NoBriefFallback />}
        <SetupForm note={note} />
      </div>
      <div className="lg:col-span-1 space-y-4">
        <OpenFollowUpsCard followUps={openFollowUps} currentNoteId={note.id} onCloseFollowUp={...} />
        {brief && <PlanForTodayCard items={brief.content.carryForwardPlan.map(...)} />}
      </div>
      <CopilotBeacon />
      <CopilotSheet />
    </div>
  );
}
```

Similar integration in `/capture/[noteId]` (right pane on desktop; History tab on mobile) and `/review/[noteId]` (collapsible right panel).

## Dependencies

- `zustand@5.x` (already in stack)
- `lucide-react` (already)
- No new packages

## Verify when done

- [ ] `<CopilotBeacon>` renders on `/prepare/[noteId]`, `/capture/[noteId]`, `/review/[noteId]` with `aria-label="Open Co-Pilot"`, 48×48 px touch target.
- [ ] Beacon does NOT render on `/sign`, `/admin/*`, `/owner/*`, `/login` in v0.
- [ ] `<CopilotSheet>` opens on beacon tap; v0 shows the placeholder copy.
- [ ] `<OpenFollowUpsCard>` renders on prepare + capture + review, listing open `FollowUp` rows with source pills + Met / Drop / Carry inline.
- [ ] Tapping Met / Drop / Carry POSTs `/api/follow-ups/[id]/close` (from Unit 06) and updates the card optimistically.
- [ ] `<PlanForTodayCard>` renders on prepare + capture (NOT review — too late for "plan for today") with `carryForwardPlan` items + source pills.
- [ ] Empty states render correctly (calm copy).
- [ ] Source pill on every fact (verify by inspection — no pill = no render).
- [ ] Cards add NO new queries on prepare/capture pages (reuse brief data).
- [ ] LCP on prepare/capture not measurably degraded (within 5%).
- [ ] Audit: `COPILOT_CARD_RENDERED`, `COPILOT_BEACON_OPENED` entries; PHI-free.
- [ ] Lint rule (or grep): nothing in `src/components/copilot/cards/` reads from `draftJson` or unsigned data.
- [ ] No card surfaces a clinical recommendation (manual review of every card's rendered text).
- [ ] Three-lens evaluation: Clinician (useful without noisy; explicit tap to act), Compliance (Rule 20 — attested sources only), Auditor (every render + interaction logged).
- [ ] `progress-tracker.md` updated.
