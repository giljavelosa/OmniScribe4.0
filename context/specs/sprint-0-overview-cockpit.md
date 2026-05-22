# Sprint 0.9: Patient Chart — Overview Cockpit + Sheet Drill-downs

> **Sprint 0 polish — chart modernisation, continued.** Builds directly on Sprint 0.8
> (`PatientChartTabs`). Turns the Overview tab into a single-screen clinical "cockpit"
> and adds a persistent Tier-1 safety band. Detail opens in right-side Sheets — no page
> navigation, the base chart stays put and frozen underneath.

## Context — read first

- **`CLAUDE.md`** at the repo root — the agent rules. Obey the anti-regression rules,
  the three-lens evaluation, and the "ask before risky/irreversible" rule.
- **`context/ui-context.md`** — design tokens, typography, spacing. Use existing tokens;
  do not introduce arbitrary `text-[Npx]` sizes or hardcoded status colors.
- The chart this spec modifies:
  - `src/app/(clinical)/patients/[id]/page.tsx` — server component, fetches the data.
  - `src/app/(clinical)/patients/[id]/_components/patient-chart-tabs.tsx` — the
    Sprint 0.8 tabbed client component (Overview / Episodes / Visits / Profile + sticky
    mini-header). This is the main file to restructure.
- Pattern reference — the **Sheet** component (`src/components/ui/sheet.tsx`) is already
  the house pattern for overlay panels: Add Patient, Start Visit, and the Miss Cleo
  copilot all use it. This spec reuses it; it does not invent a new pattern.

## Goal

A clinician opening a patient chart gets the whole patient in one screen, and drills into
any detail **without leaving the page**. Three tiers:

- **Tier 1 — Safety band**: allergies + active problems, always on screen (inside the
  sticky header), across every tab.
- **Tier 2 — Overview cockpit**: the Overview tab becomes a compact grid of summary
  *tiles* — Snapshot, Medications, Open follow-ups, Last visit, Prior records. Each tile
  is a headline + a `▸` open affordance.
- **Tier 3 — Sheet drill-downs**: tapping a tile's `▸` opens a **right-side Sheet** with
  the full detail. The chart stays visible and frozen underneath; the sheet scrolls
  internally; closing returns the clinician exactly where they were.

> **Ships when** a clinician can land on a patient chart, read the whole patient on the
> Overview tab without scrolling on desktop, tap any tile to open its detail in a
> right-side sheet, scroll inside that sheet, and close it back to the exact same chart
> position — and the allergies/problems band stays visible the whole time.

## Locked decisions

| # | Decision | Value |
|---|----------|-------|
| 1 | Sheet side | `side="right"` on desktop and mobile. Base chart stays visible + scroll-locked while a sheet is open. |
| 2 | Sheets are read-only | Phase-1 cockpit sheets are *consulting* surfaces — no edit/save actions inside them. (Edit affordances + role-gating are a separate workstream — see Out of scope.) |
| 3 | Nesting cap | 1 level of nested sheet is normal, 2 is the absolute max. Never 3-deep. |
| 4 | No marathon scroll | Overview fits one screen on desktop; on mobile it is a short stack of compact tiles. |
| 5 | No duplicated identity | Drop the `PatientIdentityHeader` from inside the Overview tab — identity already lives in the sticky mini-header. |
| 6 | Allergies / Medications data | Sourced from FHIR → **Phase 2**. Phase 1 renders these tiles + the allergy slot in the safety band as an explicit "Not recorded — connect an EHR" state. |
| 7 | Prior context placement | Moves out of the Overview body into a cockpit tile (`Prior records (N) ▸`) that opens a sheet. |
| 8 | One gesture everywhere | Every cockpit tile opens its detail the same way — a right-side sheet. No mix of modals/popovers/navigation. |

## Design

### Tier 1 — Safety band

A slim strip rendered **inside the existing sticky mini-header** in `patient-chart-tabs.tsx`
(directly under the identity row), so it persists across all four tabs.

- **Allergies** — `⚠ Allergies: Penicillin, Sulfa` in a `StatusBadge variant="danger"` when
  present. `No known allergies` (neutral) when explicitly cleared. `Allergies not recorded`
  (`variant="warning"`) when unknown — the *absence* of data must be visible, never silent.
  Phase 1: always the "not recorded" state (Phase 2 wires FHIR).
- **Active problems** — neutral badges. Phase 1: derived from the patient's
  `ACTIVE`/`RECERT_DUE` episode `diagnosis` values (all divisions — REHAB, MEDICAL, and
  BEHAVIORAL_HEALTH). The Episodes UI tab is separately gated to REHAB patients (Sprint 0.10),
  but the Problems derivation intentionally spans all divisions so a Medical or BH patient
  still has their diagnoses surfaced in the safety band. Truncate to ~3 with `+N more` →
  tapping `+N more` opens the Problems sheet.
- The band is **one line** on desktop, wraps minimally on mobile. It is a band, not a card —
  keep it visually quiet (small text, no heavy borders) so it never competes with content.

### Tier 2 — Overview cockpit

Restructure the Overview `TabsContent` in `patient-chart-tabs.tsx`:

- **Remove**: the `PatientIdentityHeader` (decision 5) and the inline `ExternalContextSection`
  (becomes a tile, decision 7).
- **Keep**: the small "N signed visits · Active in: …" division summary line.
- **Add**: a responsive grid of `CockpitTile`s — 2 columns on `lg`, 1 column stacked on
  mobile. Tiles:

  | Tile | Headline shown | `▸` opens |
  |------|----------------|-----------|
  | Snapshot | Inline measures (Pain/ROM/Gait or vitals) — reuse `PatientSnapshotStrip` content | `SnapshotDetailSheet` |
  | Medications | `Medications (4)` — or `Not recorded` (Phase 1) | `MedicationsSheet` (Phase 2 data) |
  | Open follow-ups | `Open follow-ups (2)` / `None open` | `FollowUpsSheet` |
  | Last visit | `6 weeks ago — Hypertension follow-up` / `No visits yet` | `LastVisitSheet` |
  | Prior records | `Prior records (3)` / `None on file` | `PriorRecordsSheet` |

- A `CockpitTile` is a small `Card`: a label (uppercase, muted), a headline value/count,
  and a right-aligned `▸` (`ChevronRight`). The **whole tile** is the click target
  (`min-h-[var(--touch-min)]`). Consistent anatomy across all tiles.

### Tier 3 — the `ChartDetailSheet` pattern

One reusable wrapper so every drill-down behaves identically:

- `Sheet` + `SheetContent side="right"` (`sm:max-w-md`, `lg:max-w-lg`).
- A consistent `SheetHeader`: title + the Sheet's built-in close (`X`).
- A **scrollable body** — `flex-1 overflow-y-auto` — so long content scrolls *inside the
  panel*. The base chart never moves (Radix `Sheet` scroll-locks the background).
- No edit actions in Phase 1 sheets (decision 2).
- Sheet contents:
  - `FollowUpsSheet` — open `FollowUp` rows for the patient (text, source visit + date,
    created date). **Data exists** — `GET /api/patients/[id]/follow-ups`.
  - `LastVisitSheet` — a *summary* of the most recent signed visit, with an
    **"Open full visit"** button that navigates to `/visits/[noteId]` (the dedicated
    viewer). A sheet summarizes; a full page is the whole artifact — do not make the
    sheet try to be the visit viewer.
  - `SnapshotDetailSheet` — the snapshot measures with their source note + history.
  - `PriorRecordsSheet` — the external-context list (reuse the body of the existing
    `ExternalContextSection`).
  - `MedicationsSheet` / `AllergiesSheet` — Phase 2 (FHIR data).
  - `ProblemsSheet` — Phase 1, episode-derived list; each row may link to the Episodes tab.

## Data sourcing

| Tile / band item | Source | Phase |
|------------------|--------|-------|
| Snapshot | `buildSnapshotStrip` — already fetched in `page.tsx` | 1 |
| Open follow-ups | `FollowUp` rows (`status: OPEN`) — native DB. Add a `prisma.followUp.findMany` in `page.tsx`, or call `GET /api/patients/[id]/follow-ups` | 1 |
| Last visit | Already in the `visits` array passed to `PatientChartTabs` (`visits[0]`) | 1 |
| Prior records | `externalContextItems` — already passed in | 1 |
| Problems (band + sheet) | Derived from active-episode `diagnosis` — already in `episodesForPanel` | 1 |
| Allergies (band + tile) | FHIR — surfaced today only in Miss Cleo's `allergies-card`. **Decision deferred.** | 2 |
| Medications (tile) | FHIR — surfaced today only in Miss Cleo's `current-medications-card`. **Decision deferred.** | 2 |

> **Open question for Phase 2 (do not resolve in Phase 1):** allergies + medications live
> in FHIR and are currently surfaced only inside the copilot. Phase 2 must decide: (a)
> surface that same FHIR-synced data on the chart, or (b) add lightweight native models.
> Phase 1 ships the cockpit + the band shell with these two as honest "Not recorded —
> connect an EHR" placeholders, so the whole interaction pattern lands without blocking
> on this decision.

## Implementation (Phase 1)

1. `_components/chart-detail-sheet.tsx` — the reusable right-side sheet wrapper
   (`side="right"`, header + scrollable body). Props: `open`, `onOpenChange`, `title`,
   `children`.
2. `_components/cockpit-tile.tsx` — the summary tile (label, headline, `▸`, full-tile
   click target).
3. `_components/safety-band.tsx` — the Tier-1 strip (allergies + problems).
4. The Phase-1 sheets: `follow-ups-sheet.tsx`, `last-visit-sheet.tsx`,
   `snapshot-detail-sheet.tsx`, `prior-records-sheet.tsx`, `problems-sheet.tsx`.
5. `page.tsx` — add the open-`FollowUp` fetch for the patient; pass follow-ups +
   episode-derived problems down to `PatientChartTabs`.
6. `patient-chart-tabs.tsx` — render `SafetyBand` inside the sticky header; rebuild the
   Overview `TabsContent` as the cockpit grid; remove the in-Overview
   `PatientIdentityHeader` and `ExternalContextSection`.
7. Verify against the checklist below; run `npm run typecheck && npm run lint`.

## Out of scope

- **Role-gating the edit controls** (the `403` on goal/episode edits for read-only
  viewers) — a real bug, but a separate workstream. Note it; do not fix it here.
- **Phase 2** — wiring allergies + medications to FHIR data.
- Native allergy/medication/problem-list schema models.
- Any change to the Episodes / Visits / Profile tabs beyond what decision 5/7 requires.

## Verify when done

- [ ] Overview fits one screen on a desktop viewport with no page scroll; mobile is a
      short compact stack.
- [ ] The allergies + problems safety band is visible and sticky across all four tabs.
- [ ] Every cockpit tile opens its detail in a **right-side** sheet; the base chart stays
      visible and does not scroll while the sheet is open.
- [ ] The sheet body scrolls internally for long content.
- [ ] Closing a sheet returns the clinician to the exact same chart scroll position.
- [ ] "Last visit" sheet's "Open full visit" button navigates to `/visits/[noteId]`.
- [ ] Allergies + Medications render an explicit "Not recorded — connect an EHR" state
      (Phase 1), never a blank.
- [ ] 3-tap test: from the chart, any cockpit detail is reachable in ≤ 1 tap.
- [ ] No native `confirm()`/`alert()`; no hardcoded status colors (`StatusBadge` only);
      no arbitrary `text-[Npx]`.
- [ ] `npm run typecheck` and `npm run lint` are clean.
- [ ] Three-lens evaluation recorded in the PR description.

## Three-lens (target)

- **Clinician** — the whole patient in one screen; allergies never missed; detail comes
  to you as a layer instead of a page change, so context is never lost.
- **Compliance** — the safety band makes allergy *absence* explicit (not recorded ≠ none).
- **Auditor** — drill-downs are read-only; no data path changes; provenance unchanged.
