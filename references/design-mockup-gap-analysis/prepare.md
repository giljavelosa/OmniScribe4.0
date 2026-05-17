# Prepare flow — Mockup Gap Analysis

## At a glance

- **Mockup file(s):** `design-mockups-2026-05/prepare_screen_mobile_mockup.html` (116 lines)
- **Production file(s):** `src/app/(clinical)/prepare/[noteId]/page.tsx` (896 lines)
- **Coverage estimate:** built ~85% / partial ~11% / missing ~4%
- **Top blocking issue:** Remaining gap is now mostly minor token polish and optional setup-depth simplification; setup-summary status affordances are now on shared badge primitives and setup/alternate links now use semantic info text tokens.

## Mockup summary

**Structure (`prepare_screen_mobile_mockup.html`)**

- **Wrapper:** `.wrap` centered phone; `.phone` 360px, `border-radius: 28px`, `var(--color-background-primary)`.
- **App bar:** circular `.back-btn` 32px; `.patient-block` with `.patient-name` **17px / 500** + callout **1**; `.patient-meta` **12px** `var(--color-text-primary)` — "DOB … · MRN … · In person".
- **Body:** `.body` vertical stack `gap: 12px`; two `.card`s on `var(--color-background-secondary)`, large radius.
  - **Prior context:** `.card-h` "PRIOR CONTEXT" + `.card-h-link` "Full history →"; `.last-visit-line` secondary; `.summary` 13px primary; `.goals-tag` "Active goals · 2"; `.goal` rows with `.goal-dot` `#1D9E75`.
  - **Note setup:** header "NOTE SETUP" + "Adjust →"; `.setup-row` with green `.tick` ✓, `.setup-key` / `.setup-val` three rows (Type, Style, Template).
- **Bottom:** `.bottom-zone`; `.cta` full-width **teal** `#0F6E56`, **14px** padding, 15px type, `.mic-circle` + dot affordance; `.alt-row` quiet `.alt-link` "Upload audio" · "Paste transcript"; `.cancel-row` `.cancel-link` "Cancel visit".
- **Legend callouts:** **1** patient identity contrast; **2** prior context = one card answering "what happened last time"; **3** setup pre-filled with Adjust sheet only when needed; **4** single decisive primary, alternates not competing buttons.

**Tokens:** Same family as capture mockups (`--color-background-*`, `--color-text-*`, `--border-radius-md|lg`, `--color-text-info` for links). **Hardcoded** `#0F6E56`, `#1D9E75`.

## Production summary

Full-height **fixed** layout: header bar, **scrollable left** prior-context column (~`flex-1`), **fixed-width right** `w-[380px]` card with workflow explainer, visit details, primary actions, expandable upload/paste.

```314:895:src/app/(clinical)/prepare/[noteId]/page.tsx
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b ...">
        {/* back + patient + Change Patient */}
      </header>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto border-r ... px-6 pt-5 ...">
          {/* BackfillBadge, SiblingEpisodesIndicator, Prior Visit Context, goals, previous notes accordion */}
        </div>
        <div className="w-[380px] shrink-0 flex min-h-0 flex-col bg-card">
          <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-6">
            {/* Capture Workflow explainer, Visit Details */}
          </div>
          <div className="shrink-0 border-t ... p-5 space-y-3 ...">
            <Button className="w-full h-12 ... bg-primary shadow-[0_8px_20px_rgba(10,132,255,0.15)]" ...>
              <Mic ... />
              {starting ? "Starting..." : "Start Recording"}
            </Button>
            {/* or divider, Upload Audio + Paste Transcript outline buttons, panels, ghost actions, Cancel Visit */}
          </div>
        </div>
      </div>
    </div>
  );
```

Prior context uses **"Prior Visit Context"**, **structured brief** fields (main concern, prior assessment, carry-forward), **badged** "Selected for today", goals as bordered rows with **Active/Carried** chips, and **accordion** previous notes [`page.tsx:378-596`].

## Element-by-element diff

### Header

- Mockup [`.appbar`, lines 46–51] **round** back control + large patient name + meta on **one** visual block; prod now matches this pattern closely on mobile (circular back control + identity stack with DOB/MRN + modality), with only small typography/token differences remaining.
- Mockup **no** "Change Patient" in header; prod now centers on discard-confirm flow instead of multi-path patient-switch actions, reducing decision density.

### Body — Prior context

- Mockup **single** card: last visit line + paragraph + goal list + one "Full history →"; prod **multi-section**: chip "Selected for today", optional **brief** subfields, separate **Active Goals** cards with origin + status pill, **Selected Prior Notes** accordion with per-note expansion [`page.tsx:378-596`] — **far denser** than mockup callout **2**.
- Mockup link **"Full history →"**; prod **"View all notes"** routing to patient [`page.tsx:497-502`] — **similar intent**, different label and placement.

### Body — Setup / note type

- Mockup **read-only** three checked rows + **"Adjust →"** implying sheet; prod **no** equivalent summary card — instead **"Capture Workflow"** prose + numbered list describing that setup happens **on capture** [`page.tsx:612-635`] — **directly contradicts** mockup callout **3** ("setup pre-fills… no decisions") and pushes cognitive load to later screen.

### Footer / actions

- Mockup **one** full-width teal CTA "Start recording" + mic glyph + **quiet text links** for upload/paste [`lines 96–108`]; prod now follows this interaction hierarchy on both mobile and desktop (single primary + text-link alternates).
- Mockup **"Cancel visit"** alone as small centered link; prod now uses **Discard visit** with a shared confirmation dialog and a quieter single-link posture.

### Interactions

- Prod **auto-expands** upload or paste panel from `note.captureMode` [`page.tsx:154-161`] — helpful; mockup does not depict.
- Prod **redirects** to capture when status not `PREPARING`/`INTERRUPTED` [`page.tsx:164-170`] — behavior not shown in static mockup.

**Three lenses:** Stronger prior-context presentation supports **continuity-of-care** documentation (goals, last visit) for Medicare **medical necessity** threading; **wrong-patient** risk: mockup stresses DOB/MRN prominence — prod metamodel is sound but split across dense desktop panes may reduce **at-a-glance** verification on tablet. **Rule 16:** Starting recording only navigates to capture; actual transcription + drafting still depends on workers when they finalize later.

## Copy diff

| Mockup | Production |
|--------|------------|
| "Prior context" (uppercase card title) | "Prior Visit Context" [`page.tsx:383-384`] |
| "Full history →" | "View all notes" [`page.tsx:501`] |
| "Note setup" + rows "SOAP note", "Hybrid", template name | No card; "Capture Workflow" + "Visit Details" [`page.tsx:616-674`] |
| "Start recording" | "Start Recording" / "Starting..." [`page.tsx:685-686`] |
| "Upload audio" / "Paste transcript" (low emphasis links) | Same words but as **outline buttons** [`page.tsx:697-713`] |
| "Cancel visit" | "Cancel Visit" [`page.tsx:887-889`] |
| "Active goals · 2" | "Active Goals ({count})" [`page.tsx:462-464`] |
| Mockup last-visit line includes clinician name | Prod shows date + clinician in brief header line [`page.tsx:400-403`] |

## Token / styling diff

- Mockup **brand teal** `#0F6E56` on CTA; prod uses theme **`bg-primary`** with nested mic circle and no blue marketing shadow on desktop action zone — closer to mockup CTA posture while staying tokenized.
- **Hardcoded errors:** `text-red-600` upload/paste errors [`page.tsx:756`, `836`] — critique + Task #4 family; prefer `text-destructive` or danger tokens.
- **Hardcoded success state:** `bg-[var(--status-success-bg)]` in upload done state [`page.tsx:793`] — token-good; mixed with `text-red-600` elsewhere.
- Left column now uses neutral tokenized surface without blue gradient wash, reducing non-mockup visual bias.
- Mockup tokens `--color-*` largely **absent** from `globals.css` under those exact names (same as capture section).
- Goal status pills use **primary/emerald** mixes [`page.tsx:481-482`] — candidate for **`StatusBadge`**.

## Refactor recommendations

1. ~~**`prepare/[noteId]/page.tsx` [L] [high]**~~ **DONE** — responsive mobile single-column flow with patient hero, stacked prior/setup summary cards, one primary CTA, and quiet upload/paste links.
2. ~~**Same [M] [med]**~~ **DONE (mobile + desktop summary depth)** — setup summary card (Type/Style/Template) + inline adjust flow on mobile; desktop now mirrors with a dedicated summary surface ahead of full setup controls.
3. ~~**Same [S] [low]**~~ **DONE** — **CTA styling:** desktop blue marketing shadow removed; nested mic-circle affordance retained in tokenized form.
4. **Same [XS] [low]** — Normalize errors to **`text-destructive`** / semantic tokens [`page.tsx:756`, `836`].
5. ~~**Same [S] [med]**~~ **DONE** — Footer action density reduced by removing the extra desktop `Return to Patients` action; `Discard visit` remains the single quiet alternate.
6. **Goal/status chips [XS] [low]** — Map **Active/Carried** to **`StatusBadge`** in prior-context rows; setup-summary status affordances now use `StatusBadge` success primitives.

## Cross-reference to cursor-tasks/01-quick-wins.md

- **Task #1:** **N/A** (capture controls).
- **Task #2:** **N/A**.
- **Task #3 (patient identity contrast):** **PARTIAL / improved** — prepare uses `text-foreground/85` for identity tokens [`page.tsx:328-334`]; verify no regressions elsewhere; mockup wants **12px primary** for full meta line including modality.
- **Task #4 (`StatusBadge`):** **PARTIAL** — goal row pills still custom Tailwind [`page.tsx:481-482`]; "Selected for today" chip uses `bg-primary/8` [`page.tsx:386-388`].
- **Task #5:** **PARTIAL** — primary CTA `h-12` (48px) [`page.tsx:681`]; many **sm** ghost controls — audit tablet prepare in portrait.
- **Task #6:** **N/A**.
- **Task #7:** **N/A**.

**Phase 2+ candidates:** Mobile-first prepare **parity**; **setup summary card** + adjust sheet; **quiet** upload/paste links vs equal buttons; **typography** match (17px name); **round** back control; reduce **accordion depth** to single "prior answer" card when appropriate; prepare-time **defaults** to shrink capture setup (strategic link to capture critique §Documentation Setup).
