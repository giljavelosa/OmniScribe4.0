# Section Progress Strip — UI Spec (single screen, three components)

**Status:** Draft for implementation
**Companion to:** `section-progress-spec.md`
**Last updated:** 2026-05-05

---

## 1. Target experience

Phase 04 is a single-screen surface — the during-visit capture page at `src/app/(clinical)/capture/[noteId]/page.tsx`. Three new components compose at the top of that page:

| Component | Surface | Primary purpose |
|---|---|---|
| **`<SectionProgressStrip>`** | Top of capture page | Glanceable row of section status cells |
| **`<SectionProgressCell>`** | Inside the strip, one per section | Status badge + per-section regenerate `↻` |
| **`<SectionRegenerateConfirmDialog>`** | Triggered from a cell on `edited` status | Prompt-on-overwrite confirmation |

Plus one hook:

| Hook | Purpose |
|---|---|
| **`useSectionProgress(noteId, initialStrip)`** | Bootstraps from initial strip; subscribes to SSE; reconciles state; exposes `regenerateSection(sectionId)` and `isRegenerating(sectionId)` |

Visual language: **muted defaults, color only on action; status glyph + label always paired with a tap target; provenance via the existing transcript pane (we don't restate it here).**

## 2. Layout — full screen

The strip slots in at the top of the existing capture page. Everything below renders unchanged.

### 2.1 Desktop (lg+ breakpoint, ≥ 1024px)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Maria González · 68F · Visit Apr 28                          [End visit]    │  ← existing capture header
│                                                                              │
│ ┌──────────────────────────────────────────────────────────────────────┐    │  ← Zone 1 — strip (NEW)
│ │ ● Subjective ↻   ⟳ Objective ↻   ○ Assessment ↻   ⚠ Plan ↻↻   ○ HEP↻ │    │
│ └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│ ┌──────────────────────────────────────┬─────────────────────────────────┐  │  ← existing capture body
│ │ Transcript pane                      │ Prior context panel             │  │     (UNCHANGED)
│ │                                      │                                 │  │
│ │ ...                                  │ ...                             │  │
│ │                                      │                                 │  │
│ └──────────────────────────────────────┴─────────────────────────────────┘  │
│                                                                              │
│ [recording controls — UNCHANGED]                                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

CSS layout (Tailwind):

```tsx
<main className="flex min-h-screen flex-col">
  <CaptureHeader ... />                                  {/* existing */}
  <SectionProgressStrip strip={strip} ... />             {/* NEW — Zone 1 */}
  <CaptureBody ... />                                    {/* existing */}
  <CaptureControls ... />                                {/* existing */}
  <SectionRegenerateConfirmDialog ... />                 {/* NEW — portal */}
</main>
```

### 2.2 Mobile / tablet (< lg, < 1024px)

Same vertical order. Strip uses `overflow-x-auto` so cells scroll horizontally on narrow viewports; chevron hint visible until the user has scrolled at least once.

```
┌──────────────────────────────────────┐
│ Maria González · 68F · Visit Apr 28  │
├──────────────────────────────────────┤
│ ● Subjective ↻ ⟳ Objective ↻ ○ As… › │  ← horizontal scroll, › chevron hint
├──────────────────────────────────────┤
│ Transcript pane (full width)         │
│ ...                                  │
├──────────────────────────────────────┤
│ Prior context (collapsible)          │
└──────────────────────────────────────┘
```

No tablet-specific layout (Phase 09 deferred).

## 3. Component 1 — `<SectionProgressStrip>`

### 3.1 Anatomy

```
┌────────────────────────────────────────────────────────────────┐
│ ● Subjective ↻   ⟳ Objective ↻   ○ Assessment ↻   ⚠ Plan ↻↻   │
└────────────────────────────────────────────────────────────────┘
```

- Horizontal flex row, `gap-2` between cells
- Container: `rounded-lg border border-border/40 bg-card px-3 py-2`
- One `<SectionProgressCell>` per section in `strip.sections`
- Empty `strip` (no sections) → render `null` (defensive; shouldn't happen in practice)

### 3.2 Props

```ts
export interface SectionProgressStripProps {
  strip: NoteProgressStrip;
  onRegenerate: (sectionId: string, opts: { overwriteEdits: boolean }) => Promise<void>;
  isRegenerating: (sectionId: string) => boolean;
}
```

The strip itself does not own the regenerate action — it forwards to the page via `onRegenerate`. The page owns the API call, the audit/toast surface, and the confirm-dialog state machine.

### 3.3 States

| State | Trigger | Render |
|---|---|---|
| Default | Strip mounted with sections | All cells render per their individual status |
| Empty template | `strip.sections.length === 0` | `null` (no DOM) |
| Loading initial | `strip` is `null` (bootstrap in flight) | Skeleton — 4 placeholder cells with shimmer |

## 4. Component 2 — `<SectionProgressCell>`

The headline interactive surface. Four variants by status, plus the regenerate button.

### 4.1 Anatomy

```
┌──────────────────┐
│ ● Subjective   ↻ │  ← status glyph · label · regenerate button
└──────────────────┘
```

- Status glyph (left): `○` empty, `⟳` generating (spinner), `●` populated, `✏` edited, `⚠` failed
- Label (center): from `section.label`; truncates with `…` if narrow viewport
- Regenerate button (right): `↻` for normal states, `↻↻` for `failed` (visual cue: retry-after-failure)

### 4.2 Per-status visual treatment

| Status | Glyph color | Cell background | Cell border | Regenerate button |
|---|---|---|---|---|
| `empty` | `text-muted-foreground/50` | transparent | `border-border/40` | enabled, `↻` |
| `generating` | `text-blue-500` (spinning) | `bg-blue-50/50` | `border-blue-200` | disabled (in-flight) |
| `populated` | `text-emerald-600` | transparent | `border-border/40` | enabled, `↻` |
| `edited` | `text-amber-600` | `bg-amber-50/30` | `border-amber-200` | enabled, `↻` (triggers prompt) |
| `failed` | `text-red-600` | `bg-red-50/40` | `border-red-300` | enabled, `↻↻` (retry) |

Color is never the only indicator — every status has both a glyph AND a label, and every regenerate button has both an icon AND an `aria-label`.

### 4.3 Click interactions

```
        ┌──────────┐
        │  status  │  ← cell rendered
        └────┬─────┘
             │ tap ↻
             ▼
        ┌──────────────────┐
        │ status === ?     │
        └────┬─────────────┘
             │
   ┌─────────┼──────────┬──────────────┐
   ▼         ▼          ▼              ▼
generating  edited    empty/         failed
(disabled)  (prompt)  populated      (retry, no prompt)
   X        modal     immediate      immediate
                      regenerate     regenerate
```

- `generating` → button is disabled (`aria-disabled="true"`); tap is a no-op
- `edited` → opens `<SectionRegenerateConfirmDialog>` with `sectionId` + `sectionLabel`; on confirm, calls `onRegenerate(sectionId, { overwriteEdits: true })`
- `empty` / `populated` → calls `onRegenerate(sectionId, { overwriteEdits: false })` immediately
- `failed` → calls `onRegenerate(sectionId, { overwriteEdits: false })` immediately (no prompt; the failed content is never a clinician edit worth preserving)

### 4.4 Optimistic UI

When the regenerate API responds `202`, the page's hook flips the cell's local state to `generating` immediately (optimistic). The actual SSE `section.generating` event reconciles to authoritative state moments later.

If the API responds `409 SECTION_HAS_EDITS` (race: status was `edited` but the user didn't see the prompt because of stale local state), the page surfaces the prompt-on-overwrite dialog before retrying.

If the API responds `409 SECTION_ALREADY_GENERATING` (race: a job is already in flight), the page swallows silently and lets SSE reconcile.

### 4.5 a11y

- Cell `role="button"` only when the cell itself is clickable (it isn't — only the `↻` is)
- `↻` button: `<button type="button">` with `aria-label="Regenerate {{ sectionLabel }}"` (or `"Retry {{ sectionLabel }} — last attempt failed"` for `failed` state)
- 44×44pt minimum tap target (mobile); use `min-h-[44px] min-w-[44px]` on the button
- Status glyph: `aria-hidden="true"` (the label conveys the same information)
- `motion-reduce:animate-none` on the `generating` glyph spinner

## 5. Component 3 — `<SectionRegenerateConfirmDialog>`

Replaces a regenerate-on-edited tap with an explicit confirmation. AlertDialog primitive — same pattern as Phase 13d's `<RecertReopenDialog>`.

### 5.1 Anatomy

```
                ┌──────────────────────────────────────────────┐
                │  Regenerate Subjective?                  [⨯] │
                │                                              │
                │  This will replace your edits.               │
                │                                              │
                │  ─────────────────────────────────────       │
                │  [ Cancel ]                  [ Regenerate ]  │
                └──────────────────────────────────────────────┘
```

### 5.2 Props

```ts
export interface SectionRegenerateConfirmDialogProps {
  open: boolean;
  sectionLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
}
```

### 5.3 Behavior rules

- AlertDialog primitive (`alertdialog` role) — tap-outside does NOT dismiss (founder-rule clinical-confirmation guarantee)
- Escape key triggers `onCancel`
- `Cancel` is the default focus on mount (per WCAG — never default-focus the destructive action)
- `Regenerate` button uses warning palette (amber/destructive); enabled at all times
- `Cancel` is disabled when `isSubmitting` (prevents premature dismissal during in-flight POST)
- Focus trap; on close, focus returns to the cell's `↻` button

### 5.4 Microcopy

| Element | Copy |
|---|---|
| Title | `"Regenerate {{ sectionLabel }}?"` |
| Body | `"This will replace your edits."` |
| Cancel button | `"Cancel"` |
| Confirm button | `"Regenerate"` |
| Confirm button (submitting) | `"Regenerating…"` |

## 6. Hook — `useSectionProgress(noteId, initialStrip)`

The state-management surface for the page.

### 6.1 Signature

```ts
function useSectionProgress(
  noteId: string,
  initialStrip: NoteProgressStrip | null,
): {
  strip: NoteProgressStrip | null;
  regenerateSection: (sectionId: string, opts: { overwriteEdits: boolean }) => Promise<void>;
  isRegenerating: (sectionId: string) => boolean;
};
```

### 6.2 Behavior

1. **Mount:** seed local state from `initialStrip`
2. **Subscribe:** open SSE connection (or piggyback on existing capture-screen SSE channel) and listen for `section.generating` / `section.completed` events
3. **Reconcile:** on each event, update the matching `section` in local state — match by `(noteId === event.noteId, sectionId === event.sectionId)`
4. **Regenerate:** `regenerateSection(sectionId, opts)`:
   - Optimistic flip of cell to `generating`
   - `POST /api/notes/[noteId]/sections/[sectionId]/regenerate` with body `{ overwriteEdits: opts.overwriteEdits }`
   - On `202`: leave optimistic state; SSE will reconcile
   - On `409 SECTION_HAS_EDITS`: rollback optimistic state, throw a typed error so the page can surface the confirm dialog
   - On `409 SECTION_ALREADY_GENERATING`: rollback to whatever SSE has reported (already in `generating` likely)
   - On other errors: rollback, throw, let the page surface a generic toast
5. **`isRegenerating`:** returns `true` if local state has `status === "generating"` for the section, OR an in-flight POST exists for that section

### 6.3 Stale-token guarding

If the user taps `↻` twice rapidly on the same section, the second call should be a no-op (the first is already in flight). Track in-flight POST per `sectionId` in the hook; reject the second call until the first resolves.

## 7. Microcopy

| Surface | Element | Copy |
|---|---|---|
| Cell `↻` button (default) | `aria-label` | `"Regenerate {{ sectionLabel }}"` |
| Cell `↻↻` button (failed) | `aria-label` | `"Retry {{ sectionLabel }} — last attempt failed"` |
| Cell `↻` button (disabled / generating) | `aria-label` | `"Regenerating {{ sectionLabel }}…"` |
| Confirm dialog | Title | `"Regenerate {{ sectionLabel }}?"` |
| Confirm dialog | Body | `"This will replace your edits."` |
| Confirm dialog | Confirm | `"Regenerate"` |
| Confirm dialog | Cancel | `"Cancel"` |
| Toast — regenerate success | After SSE `section.completed` outcome `populated` | `"{{ sectionLabel }} regenerated."` |
| Toast — regenerate failed | After SSE `section.completed` outcome `failed` | `"{{ sectionLabel }} regeneration failed. Tap retry."` |
| Toast — overwrite refused (server) | After `409 SECTION_HAS_EDITS` (race) | (no toast — page re-opens the confirm dialog instead) |
| Toast — already generating | After `409 SECTION_ALREADY_GENERATING` | (no toast — silent reconcile) |
| Toast — generic error | After non-`409` failure | `"Couldn't regenerate {{ sectionLabel }}. Try again."` |

**Tone:** factual, brief, never cute. The regenerate is a *correction* of the AI's output; the copy should not anthropomorphize the AI ("Sorry!") or imply blame on the clinician ("Are you sure?").

## 8. Accessibility

- All `↻` buttons: `<button type="button">`, focus-visible outline, 44×44pt min tap target on mobile (WCAG 2.1 AA)
- Status glyphs are `aria-hidden="true"` — the label conveys the meaning to assistive tech
- `generating` spinner respects `prefers-reduced-motion: reduce` (snaps without spin animation)
- AlertDialog (confirm) traps focus, returns focus to the trigger on close, supports Escape for cancel
- Color is never the only status indicator — every status has glyph + label
- SSE state changes announce via `aria-live="polite"` on a hidden region adjacent to the strip: e.g., `"Subjective regenerated."` after a `section.completed` event

## 9. Files Cursor will touch

### New (created in 04c)

- `src/app/(clinical)/capture/[noteId]/_components/SectionProgressStrip.tsx`
- `src/app/(clinical)/capture/[noteId]/_components/SectionProgressCell.tsx`
- `src/app/(clinical)/capture/[noteId]/_components/SectionRegenerateConfirmDialog.tsx`
- `src/hooks/useSectionProgress.ts`

### Modified (additive, no behavior change to existing UI outside the strip)

- `src/app/(clinical)/capture/[noteId]/page.tsx` — render the strip at the top; pass `initialStrip` from bootstrap response; mount the hook; render the confirm dialog as a portal sibling

### Untouched (founder rules)

- Any review or sign shell components — confirmed by file path inspection
- `src/services/llm/*` — no new LLM call paths in 04c (LLM call lands in 04b's worker extension)
- AssemblyAI / Soniox integration — unchanged
- Audio capture / transcript pane — unchanged

## 10. Acceptance criteria

### 04c (UI ship gate)

- [ ] `<SectionProgressStrip>` renders all 5 status states correctly on a seeded note
- [ ] `<SectionProgressCell>` `↻` button click on `empty` / `populated` triggers `onRegenerate` immediately with `overwriteEdits: false`
- [ ] `↻` click on `edited` opens `<SectionRegenerateConfirmDialog>`; confirming triggers `onRegenerate` with `overwriteEdits: true`; canceling closes the dialog and does not trigger regenerate
- [ ] `↻↻` click on `failed` triggers `onRegenerate` immediately with `overwriteEdits: false` (retry, no prompt)
- [ ] `generating` cell renders the spinner with `motion-reduce:animate-none` honored
- [ ] `<SectionRegenerateConfirmDialog>` cannot be dismissed by tap-outside; only by Cancel, Escape, or Regenerate
- [ ] Default focus on the dialog is `Cancel`, not `Regenerate`
- [ ] SSE `section.generating` events flip the matching cell to `generating`; `section.completed` events flip to `populated` or `failed`
- [ ] Optimistic UI flips to `generating` on `↻` tap; rolls back on non-202 response
- [ ] In-flight POST for a section blocks duplicate POSTs from the same hook instance
- [ ] 3-tap test passes on desktop and mobile: open capture → tap a cell's `↻` → land on regenerate confirm dialog (when `edited`) or generating state (otherwise)
- [ ] Existing capture-page tests still pass; new component tests pass
- [ ] `npx tsc --noEmit`, `npm test`, `NODE_ENV=production npm run build` all green

## 11. Anti-patterns to avoid

- See @CLAUDE.md rules 8 (audit-log writes never silently swallowed — applies to the page-level toast surface), 9 (3-tap test)
- Do **not** make `Regenerate` the default focus on the confirm dialog — `Cancel` is default focus per WCAG
- Do **not** use `<Dialog>` for the confirm dialog — `<AlertDialog>` only (alertdialog role)
- Do **not** silently overwrite clinician edits — confirm dialog is required when status is `edited`
- Do **not** show the `generating` spinner without `motion-reduce:animate-none`
- Do **not** color the entire cell by status — only glyph + (subtle background tint) for `generating` / `edited` / `failed`. The cell body and label stay neutral.
- Do **not** add a "regenerate all" button anywhere on the strip
- Do **not** integrate the strip into the prepare or review screens — capture-only (master spec §11)
- Do **not** poll the API for status — SSE only (master spec §11)

## 12. Open questions (deferred — not blocking)

- **Cell width on mobile** — fixed-width per cell (consistent visual rhythm but cuts long labels) vs. content-sized (variable widths but no truncation). Default: content-sized + truncate at viewport edge with horizontal scroll.
- **Cell tap target on the LABEL itself** — currently only the `↻` is interactive. Should tapping the label also trigger regenerate? Default: no — keeps the cell visually scannable as a status display, with regenerate as an explicit affordance.
- **Strip persistence on visit pause/resume** — when a clinician pauses recording and resumes, does the strip retain in-flight `generating` state? Default: yes — the SSE channel is independent of recording state, and the worker doesn't pause when the clinician does.

## 13. Visual mockup (optional follow-on)

The wireframes here are intentionally low-fidelity ASCII so we can lock layout and behavior before pixels. If you want a clickable HTML mockup matching `design-mockups-2026-05/` style for the strip, I can produce one as a separate deliverable after 04b API work confirms data shapes.
