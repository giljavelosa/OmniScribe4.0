# OmniScribe — Patient Detail (Snapshot Strip + Visit History + Division-Aware UI)

**Status:** Draft for implementation
**Owner:** Gil
**Last updated:** 2026-05-04
**Implementation pattern:** Master spec; derive numbered `cursor-tasks/` files per sub-phase
**Sub-phases (cursor-tasks):** `36-patient-detail-foundation.md`, `37-patient-detail-brief-prompt.md`, `38-patient-detail-api.md`, `39-patient-detail-ui.md`
**Anchored anti-regression rules:** 1, 2, 3, 6, 8, 9, 11

---

## 1. Goal

Replace the existing `src/app/(clinical)/patients/[id]/page.tsx` launcher-style screen with a **multi-division-aware clinical reference surface** — the page a clinician opens *before* walking into the room to answer "what's the deal with this patient?" in one glance.

The redesigned page renders:

- A **snapshot strip** of 5–6 most-recent objective measures (rehab: functional/ROM/pain/strength; medical: vitals; behavioral health: PHQ-9 / GAD-7) with a **manual override > extracted-from-note > FHIR (reserved)** precedence
- A **visit history list** with 2-line assessment/measurement snippets per row (currently just date + status badge)
- An **inline-editable demographics block** replacing the full-page edit form
- A **two-column desktop layout** (primary content left, snapshot strip + reference cards right) collapsing to single column on mobile
- A **`<AlertDialog>`-based recert/reopen modal** replacing the custom black-overlay pattern
- A **reserved (feature-flagged hidden) telehealth-CTA slot** in the action bar for Phase 19

The data model is shaped so future FHIR Observations and DiagnosticReports populate the same `PatientSnapshotStrip` type without a UI change — Phases F1–F6 add a FHIR → `SnapshotMeasure` mapper, and the snapshot strip starts emitting `source: "fhir"` rows alongside extracted/manual rows.

## 2. Why now

The existing patient detail page is a launcher disguised as a chart — almost no clinical context, just demographics and a flat visit list. To answer "what's the deal with this patient?" a clinician opens a recent note, then another one, then another one. That's exactly the chart-scouring pattern the prior-context brief was built to eliminate inside the *visit* — and now the *patient overview* needs the same treatment so the brief's structured data also pays off **outside** the visit context.

This phase also lands the data shape the FHIR integration phases (F1–F6) need. Doing it now — while the FHIR letter is in NextGen's queue and we have weeks of "while-waiting" runway — means the day the FHIR sandbox connects, the snapshot strip *already exists* and only needs a new `source: "fhir"` row. No UI rebuild on the FHIR side.

Strategically, this is the second concrete step (after the brief) in OmniScribe operating as a **clinical copilot** rather than a passive note generator: the patient detail page becomes the system's "I read your whole chart for you" surface, complementing the brief's "I read your last visit for you" surface.

## 3. Non-goals (v1)

- **No changes to the review or sign screens.** The patient detail page consumes signed note JSON read-only. If a snippet needs richer extraction, it goes through `src/services/llm/`, never via review/sign UI changes.
- **No new note-creation entry points.** The page may surface a "Start a new visit" button, but Phase 13 does not redesign the capture or prepare flow.
- **No marketing or auth-flow polish.** Phase 10 (auth) and Phase 12 (marketing) remain dropped/deferred.
- **No admin / team / billing surfaces** on the patient page. Phases 15–18 are deferred.
- **No telehealth integration.** A hidden, feature-flagged slot is reserved in the action bar; the actual button is wired in Phase 19.
- **No FHIR live-data wiring.** The data model includes `source: "fhir"` as a valid enum value but never emits it in v1. Phases F1–F6 add the actual FHIR mapper.
- **No new LLM call paths.** Snippet extraction reuses the prior-context-brief pipeline. No new prompts, no new workers, no new Bedrock surfaces in Phase 13 *except* the one prompt edit in sub-phase 13b.
- **No `Patient`, `Episode`, or `Note` core schema changes.** New tables are additive only. Anti-regression rules 1, 2, 3.
- **No mobile-first rebuild.** Phase 09 (responsive bonuses) remains deferred. Two-column desktop collapses to single column on mobile via Tailwind breakpoints — no tablet-specific split layouts, no sticky-bottom CTAs.
- **No removal of the existing `PriorContextPanel` collapsed preview.** Same back-compat pattern as Phase 20: deprecate only after the new surface is verified in production.
- **No multi-language.**

## 4. The patient overview (experience target)

Top-to-bottom render order on the patient detail page:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Maria González · 68F · MRN 78421                  [Edit] [⋯ Recert]│  ← inline-editable demographics
│ Rehab · R shoulder episode (active, week 4 of 6)        [— Tele —] │     telehealth slot (hidden)
├─────────────────────────────────────────────────────────────────────┤
│ Pain      ROM flex   MMT ER     Gait     FOTO      [+ measure]    │  ← snapshot strip
│ 4/10      125°       3+/5       1.1m/s   72                        │     5–6 cards, override-wins
│ ↓ Apr 28  ↑ Apr 28   = Apr 28   ↑ Apr 21 = Apr 14                  │     trend arrow + source date
├─────────────────────────────────────────────────────────────────────┤
│ Visit history (12)                       │  Reference cards         │
│                                           │                          │
│ ▸ Apr 28 — Progress Note · Dr. Smith     │  Active goals (3)        │
│   Improving — pain trending down, AROM   │  ↑ AROM flex 150°  on track
│   gains in flex/abd, scap dyskinesis...  │  ↓ Pain ≤ 2/10     active │
│                                           │  ✓ Independent HEP met   │
│ ▸ Apr 21 — Progress Note · Dr. Smith     │                          │
│   Pain VAS 5, AROM flex 110°, plan to    │  Watch                   │
│   progress band rows next visit. Scap... │  • Gabapentin 300mg Apr22│
│                                           │  • HTN flagged uncontr.  │
│ ▸ Apr 14 — Initial Eval · Dr. Smith      │                          │
│   Patient presents with 8/10 R shoulder  │  Open follow-ups (2)     │
│   pain post fall, AROM flex limited...   │  □ NSAID — ask if started│
│                                           │  □ Imaging — confirm rev │
└─────────────────────────────────────────────────────────────────────┘
```

Three core trust patterns:

- **Provenance over fluency.** Every snapshot card and every visit-history row is one tap to its source note. A measure with `source: "manual"` shows a small "edited" indicator; `source: "extracted"` shows the source note date; `source: "fhir"` (Phase F1+) shows "FHIR · NextGen".
- **Override wins.** A clinician click-edit-save on a snapshot card always trumps the extracted value. The extracted value remains visible in a tooltip ("Extracted from Apr 28 note · {value}") so the override is always reversible.
- **3-tap test.** Open patient → tap a snapshot card → land on edit affordance, no full-screen form swallow.

## 5. Schema — snapshot strip

### 5.1 TypeScript interfaces

```ts
// src/lib/types/snapshot.ts (NEW)

import type { ObjectiveMeasure } from "@/lib/types/prior-context-brief";

export type SnapshotSource = "extracted" | "manual" | "fhir";

export interface SnapshotMeasure extends ObjectiveMeasure {
  /** Stable key from the per-division registry */
  measureKey: string;                       // "rom-primary", "bp", "phq9-total", ...
  source: SnapshotSource;
  /** Set when source === "manual" */
  overriddenBy?: { userId: string; userName: string };
  overriddenAt?: string;                    // ISO
  /** Set when source === "extracted" */
  extractedFromNoteId?: string;
}

export type SnapshotScope =
  | { kind: "episode"; episodeId: string; episodeLabel: string }
  | { kind: "patient"; patientId: string };

export interface PatientSnapshotStrip {
  scope: SnapshotScope;
  division: "REHAB" | "MEDICAL" | "BEHAVIORAL_HEALTH";
  measures: SnapshotMeasure[];              // length 5–6, ordered by registry priority
  generatedAt: string;
  generatorVersion: string;                 // "snapshot-v1"
}
```

### 5.2 Per-division measure registry

Hardcoded in TypeScript for v1. Per-org configurability is deferred (templates / admin concern).

```ts
// src/lib/snapshots/registry.ts (NEW)

export interface MeasureDef {
  key: string;
  label: string;
  unit?: string;
  scope: "patient" | "episode";
  division: "REHAB" | "MEDICAL" | "BEHAVIORAL_HEALTH";
  priority: number;
}

// Rehab — episode-scoped (per design-redesign-spec.md line 281)
export const REHAB_MEASURES: MeasureDef[] = [
  { key: "pain-nrs",            label: "Pain",                unit: "/10",  scope: "episode", division: "REHAB", priority: 10 },
  { key: "rom-primary",         label: "ROM (primary joint)", unit: "°",    scope: "episode", division: "REHAB", priority: 20 },
  { key: "strength-primary",    label: "Strength (MMT)",      unit: "/5",   scope: "episode", division: "REHAB", priority: 30 },
  { key: "gait-speed",          label: "Gait speed",          unit: "m/s",  scope: "episode", division: "REHAB", priority: 40 },
  { key: "outcome-tool-score",  label: "Outcome tool",        unit: "score",scope: "episode", division: "REHAB", priority: 50 },
];

// Medical — patient-scoped vitals
export const MEDICAL_MEASURES: MeasureDef[] = [
  { key: "bp",     label: "BP",     unit: "mmHg",  scope: "patient", division: "MEDICAL", priority: 10 },
  { key: "hr",     label: "HR",     unit: "bpm",   scope: "patient", division: "MEDICAL", priority: 20 },
  { key: "weight", label: "Weight", unit: "kg",    scope: "patient", division: "MEDICAL", priority: 30 },
  { key: "bmi",    label: "BMI",                   scope: "patient", division: "MEDICAL", priority: 40 },
  { key: "spo2",   label: "SpO₂",   unit: "%",     scope: "patient", division: "MEDICAL", priority: 50 },
  { key: "temp",   label: "Temp",   unit: "°C",    scope: "patient", division: "MEDICAL", priority: 60 },
];

// BH — patient-scoped screening totals
export const BH_MEASURES: MeasureDef[] = [
  { key: "phq9-total",   label: "PHQ-9",       unit: "score", scope: "patient", division: "BEHAVIORAL_HEALTH", priority: 10 },
  { key: "gad7-total",   label: "GAD-7",       unit: "score", scope: "patient", division: "BEHAVIORAL_HEALTH", priority: 20 },
  { key: "mood-rating",  label: "Mood (0–10)", unit: "/10",   scope: "patient", division: "BEHAVIORAL_HEALTH", priority: 30 },
];

export function registryForDivision(d: "REHAB" | "MEDICAL" | "BEHAVIORAL_HEALTH"): MeasureDef[];
export function findMeasureDef(measureKey: string): MeasureDef | null;
```

### 5.3 Division derivation

Patient division is **derived at read time** — not stored on `Patient`. This supports the LRCHC reality where a single patient can be active in Rehab + Medical + BH simultaneously.

```ts
// src/lib/snapshots/division.ts (NEW)

/**
 * Derive a patient's primary division for the snapshot strip.
 * Precedence:
 *   1. If the patient has an active episode with a division, use that
 *   2. Else if the patient's home Site has a single division, use that
 *   3. Else fall back to the org's default division
 */
export function derivePatientDivision(input: {
  activeEpisode: { division: Division | null } | null;
  site: { division: Division | null } | null;
  org: { defaultDivision: Division };
}): Division;
```

The Prisma `Episode` model already carries `division`; `Site.division` and `Org.defaultDivision` are existing or trivially-additive fields (verify in 13a; add via Prisma migration if missing — additive only).

#### 5.3.1 `MULTI` handling (locked 2026-05-05, post-13a)

13a shipped with a `MULTI` value added to the `Division` enum so `derivePatientDivision` can faithfully report when a patient/site/org spans more than one division (e.g., LRCHC sites that serve Rehab + Medical + BH from the same building). The spec originally said "fall back to org default"; Cursor's MULTI propagation is more honest, so we adopt it as the canonical helper return type.

**v1 rendering rule (M1):**

When `derivePatientDivision(...) === "MULTI"`, the snapshot strip falls back to the **REHAB registry** (LRCHC pilot default) and renders `PatientSnapshotStrip.division: "REHAB"`. The `MULTI` value is internal to the helper — it never appears on the wire shape. A debug log entry `snapshot.multi.fallback` is emitted on every MULTI fallback so we can measure how often the rule triggers in production.

```ts
// pseudocode in src/lib/snapshots/build-snapshot-strip.ts
const derived = derivePatientDivision(...);
const renderDivision: "REHAB" | "MEDICAL" | "BEHAVIORAL_HEALTH" =
  derived === "MULTI" ? "REHAB" : derived;
if (derived === "MULTI") {
  logger.debug("snapshot.multi.fallback", { patientId, fallback: "REHAB" });
}
```

**Upgrade path (M2 — deferred until LRCHC has its first wrong-feeling moment):**

When `MULTI` rendering shows a clinically-wrong default for a real patient (e.g., a BH-active patient sees rehab measures), upgrade to:
1. Add `Patient.primaryDivision: Division | null` (additive Prisma migration)
2. When `derivePatientDivision === "MULTI"` AND `patient.primaryDivision` is set → render that division's registry
3. When `MULTI` AND `primaryDivision` is null → render an empty strip with copy *"Patient spans multiple divisions — set primary"* and a small picker that writes `primaryDivision`

M2 is a separate cursor-task (slot 40+) and explicitly out of scope for the Phase 13 cluster.

**M3 (stacked strip, one card per division)** is rejected for v1 — UI density and mental-model cost are too high for a feature that may rarely trigger in the LRCHC pilot. Re-evaluate post-LRCHC if data shows MULTI fallbacks > 20% of patient page views.

### 5.4 The one new Prisma table

```prisma
// prisma/schema.prisma — additive only

model SnapshotOverride {
  id              String   @id @default(cuid())
  patientId       String
  episodeId       String?         // null for patient-scoped overrides
  measureKey      String          // matches MeasureDef.key
  valueJson       Json            // number | string | { systolic, diastolic } | ...
  unit            String?
  recordedAt      DateTime        // clinician-supplied "as of" time
  enteredAt       DateTime @default(now())
  enteredById     String
  supersededAt    DateTime?       // soft-delete: latest non-superseded override wins
  supersededById  String?

  patient         Patient  @relation(fields: [patientId], references: [id])
  episode         Episode? @relation(fields: [episodeId], references: [id])
  enteredBy       User     @relation("SnapshotOverrideEnteredBy",   fields: [enteredById],   references: [id])
  supersededBy    User?    @relation("SnapshotOverrideSupersededBy", fields: [supersededById], references: [id])

  @@index([patientId, measureKey, supersededAt])
  @@index([episodeId, measureKey, supersededAt])
}
```

Design choices baked in:

- **Soft-delete via `supersededAt`** — never hard-delete; matches how the rest of the schema treats clinical data
- **`valueJson` as `Json`** — handles scalars, strings, and structured measures (BP)
- **Both `patientId` and `episodeId` indexed** — fast read at either scope
- **No `division` column** — derived at read time; Phase 13 never queries by division

### 5.5 API contract

`GET /api/patients/[id]` gains:

```ts
{
  ...existingFields,                       // unchanged — anti-regression rule 1
  snapshotStrip: PatientSnapshotStrip | null,
  visitHistory: VisitHistoryRow[],         // existing rows, extended with `assessmentSnippet`
}
```

New endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/patients/[id]/snapshot/override`        | `POST`   | Create override; auto-supersedes prior for same `measureKey` + scope |
| `/api/patients/[id]/snapshot/override/[oid]`  | `DELETE` | Soft-delete (set `supersededAt = now()`) — falls back to extracted |

`VisitHistoryRow` is the existing visit-list row type, extended with one optional field:

```ts
interface VisitHistoryRow {
  ...existingFields,                       // id, date, clinicianName, status, noteType, ...
  assessmentSnippet: string | null;        // up to 2 lines, derived via note-text.ts
}
```

## 6. Visit history snippets

Pure derivation; no schema change.

For each row in the visit history, the API computes `assessmentSnippet` by:

1. Loading the row's note `finalJson` (already loaded for status/templateName)
2. Calling `findAssessmentContent(finalJson)` from `src/lib/notes/note-text.ts` (extracted in Phase 20)
3. Falling back to `findSubjectiveContent(finalJson)` if assessment is empty
4. Truncating to ≤ 280 characters with a `...` suffix if exceeded
5. Returning `null` if both sections are empty

Read latency: negligible — the note rows are already paged (default 10) and `finalJson` is already in the result set. No new DB queries.

## 7. Read flow (compute on read)

Per the Step 3 / Step 4 decisions: snapshot strips are computed on read (no precompute table). The read flow on `GET /api/patients/[id]`:

1. Fetch patient + active episode + site + org (single query, existing pattern)
2. Derive division via `derivePatientDivision(...)`
3. Pick scope: `kind: "episode"` for rehab w/ active episode, else `kind: "patient"`
4. Pull the registry for the division
5. For each `MeasureDef`:
   - Query the latest non-superseded `SnapshotOverride` matching `(measureKey, scope)`
   - **Hit:** use override value, `source: "manual"`
   - **Miss:** look up the most recent `priorContextBrief.objectiveMeasures` entry whose `measureKey` matches (Phase 23 prompt populates this directly after sub-phase 13b ships) → if found, `source: "extracted"` with `extractedFromNoteId` set
   - **Miss both:** omit measure (registry guarantees up to 6 slots; under-population is acceptable — the strip auto-shrinks)
6. Sort by registry `priority`
7. Return as `PatientSnapshotStrip`

Read latency target: < 80 ms p95 with at most 6 indexed override queries + one already-cached brief read. Profiled in production before any precompute is considered.

## 8. UI touchpoints

Three deliverables, all on the patient detail page:

### 8.1 Snapshot strip (`src/components/patients/PatientSnapshotStrip.tsx`, NEW)

- Horizontal row of cards, max 6
- Each card: label, value, unit, trend arrow vs the prior reading, source date, source indicator dot
- Click card → opens inline edit affordance (input + save), saves via `POST /snapshot/override`
- Click "× revert" on a manual card → soft-deletes the override, falls back to extracted
- Hover/long-press → tooltip with `extractedFromNoteId` link or override author + timestamp

### 8.2 Visit history rows (`src/components/patients/VisitHistoryRow.tsx`, NEW)

- Replaces the inline `<li>` rendering on the existing patient page
- Each row: date, status badge, clinician, **2-line assessment snippet** (new), tap → existing note detail
- Status badge palette unchanged (no design-token changes in Phase 13)

### 8.3 Inline-editable demographics + modal migrations + telehealth slot

- Demographics block: click name / DOB / MRN field → editable in place, save on blur, escape cancels
- "Full edit" button opens a sheet (not full-page form swap)
- Recert / reopen flows replace the current black-overlay pattern with `<AlertDialog>`
- Action bar reserves a top-right slot for `<TelehealthCTA />` — feature-flagged via `process.env.NEXT_PUBLIC_TELEHEALTH_ENABLED === "true"`; component renders `null` in v1

### 8.4 Two-column → single-column responsive

- `lg:grid-cols-[1fr_320px]` for desktop (primary content left, snapshot strip + reference cards right)
- `< lg`: stacks single column, snapshot strip moves above reference cards above visit history
- `max-w-[800px]` removed from the page wrapper (the patient page deserves full width)
- No new responsive primitives, no tablet-specific split layout (Phase 09 deferred)

## 9. HIPAA / compliance

- All snapshot reads go through existing `canAccessPatientHistoricalNote` access checks (no widening of scope)
- `SnapshotOverride` writes log a `SNAPSHOT_OVERRIDE_CREATED` audit entry with `(patientId, episodeId?, measureKey, enteredById)` — audit-log writes never wrapped in silent-swallow try/catch (rule 8)
- Soft-delete sets `supersededAt` and writes a `SNAPSHOT_OVERRIDE_SUPERSEDED` entry
- `SnapshotMeasure.value` and override `valueJson` are PHI; never logged in cleartext outside the audit log
- 42 CFR Part 2 sensitivity inheritance — if the source note (for an extracted measure) is sensitivity-restricted, the snapshot card displays "—" with a "view source" gating prompt rather than the value itself
- LLM prompt change in sub-phase 13b passes through `src/services/llm/` (rule 6); no direct Bedrock SDK calls

## 10. Phasing roadmap

Four sub-phases, each independently shippable, each gated by acceptance criteria. Each becomes its own `cursor-tasks/<NN>-patient-detail-<sub>.md` file.

| Sub-phase | Cursor-task | Title | Risk | Effort |
|---|---|---|---|---|
| 13a | `36-patient-detail-foundation.md` | Types, registry, division derivation, override table, override API | Low | 1 sprint |
| 13b | `37-patient-detail-brief-prompt.md` | Brief prompt emits `measureKey` + fixture re-validation | Medium (touches stable prompt) | 0.5 sprint |
| 13c | `38-patient-detail-api.md` | `GET /api/patients/[id]` snapshot strip + visit snippets | Low | 1 sprint |
| 13d | `39-patient-detail-ui.md` | Snapshot strip, visit history rows, inline edit, AlertDialog, telehealth slot, responsive | Medium (UI surface area) | 2.5 sprints |

### 10.1 Phase boundaries (the gates)

- **13a ships when** `SnapshotOverride` migration is applied, override CRUD endpoints respond correctly, registry exports for all 3 divisions, and `derivePatientDivision` passes its unit tests with all permutations of (active episode / site / org) inputs.
- **13b ships when** the brief LLM prompt emits a non-null `measureKey` for every fixture-mapped measure, registry-mismatch input is logged + stored as `null` (no crash), and Phase 23 brief generation tests still pass.
- **13c ships when** `GET /api/patients/[id]` returns a populated `snapshotStrip` for a seeded rehab patient with at least one extracted measure and one manual override (override-wins verified), and visit history rows include `assessmentSnippet` derived from `finalJson`.
- **13d ships when** the patient page renders the snapshot strip + redesigned visit list + inline-edit demographics on desktop and mobile, the recert/reopen modal is `<AlertDialog>`-based, the 3-tap test passes, and `NEXT_PUBLIC_TELEHEALTH_ENABLED=false` results in zero telehealth-CTA DOM output.

### 10.2 Dependency on existing roadmap

- 13a and 13b are independent of one another and of any other in-flight work; they can run in parallel if a second Cursor session is available.
- 13c blocks on **both** 13a (override table) and 13b (brief prompt emits `measureKey`).
- 13d blocks on 13c.

## 11. Migration / back-compat

- 13a–13c ship without removing any existing API field; the existing patient page continues to render unchanged through 13c (it just ignores the new `snapshotStrip` and `assessmentSnippet` fields).
- 13d removes `max-w-[800px]` from the patient page wrapper; this is a Tailwind class change and requires no migration.
- The `legacy edit form` is replaced by inline-edit + sheet in 13d. The old form's submit endpoint is unchanged — only the UI delivery changes.
- No `Patient`, `Episode`, or `Note` schema changes. `SnapshotOverride` is purely additive.

## 12. Open questions (deferred — not blocking implementation)

- **Manual override approval workflow:** should certain measure keys (e.g., "phq9-total") require co-sign before the override takes effect? Default for v1: no — clinician self-overrides take effect immediately, audited.
- **Snapshot strip in capture/prepare screens:** the brief already shows trajectory inside the visit; should the patient-page snapshot strip *also* render inside capture? Default for v1: no — capture stays focused on the brief, the snapshot strip is a patient-overview affordance only.
- **Per-org measure registry customization:** when do we move the registry from hardcoded TS to a per-org configurable record? Default: not in Phase 13. Re-evaluate when Phase 14 (Templates) ships.
- **FHIR source provenance UI:** when `source: "fhir"` rows arrive (Phase F1+), do we visually distinguish them from extracted/manual? Default: yes, a small "FHIR · NextGen" badge — but the visual treatment is decided alongside Phase F-spec.

## 13. Anti-patterns to avoid

- Do **not** modify the existing `PriorContextPanel` collapsed preview (anti-regression: Phase 20 deprecation gate not yet passed)
- Do **not** call Bedrock SDK directly from the snapshot or override paths (rule 6)
- Do **not** hard-delete `SnapshotOverride` rows — always soft-delete via `supersededAt`
- Do **not** silently catch + swallow audit-log write failures (rule 8)
- Do **not** add a new BullMQ job, worker, or queue in Phase 13 — read-time computation only
- Do **not** stand up the snapshot strip inside capture or prepare screens (founder rule: don't modify review shell components and don't repurpose visit-time UI for patient-overview affordances)
- Do **not** widen access — re-use `canAccessPatientHistoricalNote`
- Do **not** introduce per-org registry configuration in Phase 13 — TS-hardcoded only
- Do **not** flip on the telehealth CTA via env in 13d — slot must render `null` until Phase 19

## 14. Success metrics (Track phase, per AGENT framework)

These are capability-expansion metrics, not task-tally metrics:

- **Median time-to-orient on a returning patient** (clinician opens patient page → first useful action) before/after — target ≥ 50% reduction
- **% of returning visits where the clinician opens *no individual prior note* before starting capture** — proxy for trust in the snapshot strip + visit snippets — target ≥ 40% by Phase 13d + 30 days
- **Manual override rate** (overrides per 100 patient-page views) — high signal that extraction is wrong; target steady-state < 10% after sub-phase 13b ships and the prompt is dialed in
- **Snapshot read latency p95** — target < 80 ms; trigger precompute work only if exceeded for ≥ 7 days
- **Clinician confidence rating** — in-app micro-survey on patient-page usefulness, ≥ 4 / 5 target

Reject as success metrics: number of overrides created, number of snapshot rows rendered, snapshot strip render time alone. Those are activity metrics, not capability metrics.
