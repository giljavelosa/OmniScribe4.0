# Unit 25: Watch v1 — FHIR-backed Cards

## Goal

Wave 5 opener. Take the existing Watch v0 (Unit 07 — beacon + 2 cards: open follow-ups + plan-for-today, both sourced from SIGNED-note projections) and extend with 4 EHR-backed cards: active conditions, current medications, recent observations, allergies. All four feed off Unit 21's `FhirCachedResource` via Unit 22's `loadExternalEhrContext` projection.

> **Unit 25 ships when** a clinician on /prepare or /capture for a patient with a verified PatientFhirIdentity + a populated FHIR cache sees 4 new cards in the Watch surface, each row carrying an EhrSourcePill that opens the ProvenanceDrawer.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Card set | 4 cards in v1: ActiveConditions, CurrentMedications, RecentObservations, Allergies. Build plan called out a separate "labs card" + "vitals card"; we ship ONE Observations card v1 — splitting requires vendor-specific LOINC classification that's better as a follow-up unit. |
| 2 | Data source | Reuses `loadExternalEhrContext` (Unit 22). Parent server-component fetches once; passes projected context to all 4 cards as props. |
| 3 | Render contract | Each card is a `'use client'` component (so the existing one-time `COPILOT_CARD_RENDERED` audit hook works). Server parents fetch + pass data. |
| 4 | Provenance | Every row carries the Unit 23 `<EhrSourcePill>` — same staleness chips + drawer the brief uses. No new provenance UI. |
| 5 | Rule 20 enforcement | Cards render NOTHING when the patient has no `'verified'` PatientFhirIdentity. The projection helper enforces this at the boundary (returns null); the cards render nothing on null context. |
| 6 | Audit | `COPILOT_CARD_RENDERED` extended allowlist: `'active-conditions'`, `'current-medications'`, `'recent-observations'`, `'allergies'`. Fires once per card mount with itemCount. |
| 7 | Surfaces | /prepare/[noteId] + (clinical)/capture/[noteId]'s PriorContextPanel get the 4 cards. /patients/[id] does NOT (the EhrLinkPanel already covers EHR connection management there; adding 4 more cards would dilute the page). |

## Design

### Card components

`src/components/copilot/cards/`:

- `active-conditions-card.tsx` — lists active conditions; row format `<display> · <code> · since <onsetDate>`; max 8 rows (matches Unit 22 brief's cap); empty state surfaces "No active conditions in EHR."
- `current-medications-card.tsx` — pooled MedicationStatement + MedicationRequest; row format `<display> · <status>`; no cap (the EHR's "active meds" list is the truth).
- `recent-observations-card.tsx` — last 10 observations from the projection; row format `<display> — <value> <unit> · on <date>`; sorted desc by effectiveDate.
- `allergies-card.tsx` — all allergies; row format `<display> · criticality <criticality>`; reaction icon highlighted when criticality === 'high'.

Each card has:
- `'use client'`
- `useEffect` audit fire on mount (one-time via `auditedRef`)
- Same Card / CardHeader / CardContent shell as Unit 07 cards
- Empty-state branch + populated-state branch

### Server helper

`loadExternalEhrContext` (Unit 22) is already what we need. No new helper.

### Page wiring

`/prepare/[noteId]/page.tsx` — server fetches context once, passes to all 4 cards. Slots them below the existing `OpenFollowUpsCard` + `PlanForTodayCard` grid.

`(clinical)/capture/[noteId]/_components/PriorContextPanel.tsx` (or sibling) — same fetch + same card grid, rendered in the right aside under the existing cards.

When `loadExternalEhrContext` returns null (no link / empty cache / all stale), the WatchFhirCards block renders nothing — no extra "no EHR" placeholder (the EhrLinkPanel on /patients/[id] already owns that messaging).

### Audit allowlist extension

`/api/audit/copilot-event/route.ts`:
- `cardType` enum extended with 4 new values.
- No new actions; same `COPILOT_CARD_RENDERED`.

## Implementation order

1. Spec + audit cardType allowlist extension
2. 4 card components
3. Wire into prepare + capture pages
4. Tracker + PR #26

## Out of scope (Unit 25)

- Vitals/labs split (one Observations card in v1; LOINC classification is its own unit).
- CarePlan + Goal cards (Wave 4.5 polish — adapters not shipped).
- Watch v2 live-transcript triggers (Unit 26 — copilot listens to live transcript + raises cards on topic match).
- Empty-state CTAs that link to EhrLinkPanel (the panel lives on /patients/[id], not on the Watch surfaces — the Watch is for "currently relevant context" not for connection management).

## Verify when done

- Patient with verified FHIR link + populated cache: 4 cards render on /prepare + /capture's PriorContextPanel.
- Each row has an EhrSourcePill that opens the ProvenanceDrawer.
- Patient without a verified link: NO new cards render anywhere.
- `COPILOT_CARD_RENDERED` audit rows fire once per card per page load with the new cardType values.
- `npm run build && npm run lint && npm test` green.
- progress-tracker.md updated; PR #26 stacked on Unit 24.
