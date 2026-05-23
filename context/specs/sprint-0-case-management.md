# Sprint 0.11: Case Management + Rehab Episode of Care

> ICD-10-CM-anchored **Case Management** becomes the patient-care umbrella.
> Rehab plans of care stay as `EpisodeOfCare` but are now REHAB-only and
> *nested inside* a Case Management. Subsumes the planned Sprint 0.10
> (REHAB-only Episodes tab gating) — the new model makes that intrinsic.

## Context — read first

- **`CLAUDE.md`** at the repo root — agent rules. Especially anti-regression
  rules 1 (no removing/renaming Prisma models without a migration), 4
  (`npx prisma db seed` after schema changes), and 21 (three-lens on every PR).
- **`context/specs/sprint-0-overview-cockpit.md`** — the cockpit spec.
  This work changes the **Problems** data source — see *Downstream impact*.
- Files this spec touches / creates:
  - **Schema**: `prisma/schema.prisma` (new `CaseManagement` model + enum + FKs).
  - **Migration**: a new `*_case_management` Prisma migration + data backfill.
  - **API**: new `/api/case-management/*` endpoints; `/api/encounters`,
    `/api/episodes/*` updated to require the case linkage.
  - **UI**: `src/app/(clinical)/patients/[id]/_components/patient-chart-tabs.tsx`,
    `episodes-panel.tsx` (becomes the rehab-episode renderer inside a case),
    `start-visit-dialog.tsx` (case picker step).
- Pattern reference — reuses the **Sheet** drill-down pattern from the cockpit
  spec; no new patterns invented.

## Goal

A patient chart presents one or more **Case Managements**, each ICD-anchored.
The viewing clinician sees the case + division section *relevant to their role*
expanded first — never overloaded with other divisions' detail. Rehab
clinicians can additionally open an **Episode of Care** under any case for
recert + visit-auth + STG/LTG goal tracking, with the freedom to flip the
parent case's primary/secondary ICDs for rehab-billing purposes.

> **Ships when** a clinician can: (1) open a new case from a patient chart
> with an existing-case de-dup check firing before persist; (2) start a visit
> that auto-routes to their case (and for rehab, the episode); (3) see the
> chart present *their* division's view first on landing; (4) recertify only
> when REHAB on an `EpisodeOfCare`.

## Locked decisions

| # | Decision | Value |
|---|----------|-------|
| 1 | Case anchor | **ICD-10-CM** diagnosis code. NOT CPT — CPT stays a per-visit billing field. |
| 2 | Codes per case | `primaryIcd` (required) + `secondaryIcd` (optional), set by the case opener. |
| 3 | Rehab primary/secondary flip | `EpisodeOfCare` carries its *own* `primaryIcd`/`secondaryIcd`. Rehab may swap the parent case's order so the rehab-treated diagnosis becomes the episode's primary (and the physician's primary becomes the episode's secondary) for therapy billing. The case itself is untouched. |
| 4 | Episode-of-Care scope | **REHAB-only** by DB CHECK constraint. Required FK to `CaseManagement`. |
| 5 | Note linkage | Every `Encounter` carries a required `caseManagementId`. `episodeOfCareId` is set **only when** `Note.division === 'REHAB'` AND an episode exists for the case. |
| 6 | Who can open a case | Any clinician involved in the patient's care (same authorization as starting a visit — no extra gate). |
| 7 | Who can recertify | **REHAB specialists only.** Recert lives on `EpisodeOfCare`, which is itself REHAB-only — so the action is intrinsically REHAB-gated. Hidden from MEDICAL / BH UIs because there is no episode to act on. |
| 8 | Draft edit ownership | Only the recording clinician (`Note.clinicianOrgUserId`) can edit their draft. Server already enforces; UI reinforces. |
| 9 | New-case de-dup | Before persist, the server returns existing `CaseManagement`s for this patient (Phase 1) and FHIR `Condition` resources (Phase 2). The clinician picks an existing case, picks a FHIR condition (creates a new case prefilled), or confirms manual entry. |
| 10 | Chart presentation | Role-aware stratification — `viewingClinician.profession → division → expand that division's section`. Other divisions collapse to one-line summaries. |

## Design

### Data model (delta)

```
   Patient
     └── CaseManagement   (NEW — the umbrella, one per primary-ICD arc)
           │   primaryIcd:      M17.11
           │   primaryLabel:    "Right knee OA"
           │   secondaryIcd:    Z47.1?  (optional)
           │   secondaryLabel:  "Aftercare following joint replacement"
           │   status:          ACTIVE / CLOSED / CANCELLED
           │   openedByOrgUserId, openedAt, closedAt, closeReason
           │
           ├── Encounter (any division — note inherits division from clinician)
           │     ├── Note (MEDICAL)         — PCP visit
           │     ├── Note (BH)              — LCSW visit
           │
           └── EpisodeOfCare  (REHAB-only — the rehab plan of care)
                 │   caseManagementId   (required FK)
                 │   primaryIcd / secondaryIcd  (may flip the parent's order)
                 │   recertDueAt, recertIntervalDays
                 │   visitsAuthorized, visitsCompleted
                 │   goals (STG / LTG with GoalProgressEntry trail)
                 │
                 └── Encounter (REHAB)
                       └── Note (REHAB)     — PT / OT / SLP visit
```

**Schema delta**:
- **New** `CaseManagement` model with `primaryIcd`, `primaryIcdLabel`,
  `secondaryIcd` (nullable), `secondaryIcdLabel` (nullable), `status`,
  `patientId`, `orgId`, `openedByOrgUserId`, `openedAt`, `closedAt`,
  `closedByOrgUserId`, `closeReason`. Index `(orgId, patientId, status)`
  + `(orgId, primaryIcd)`.
- **New** enum `CaseManagementStatus` (`ACTIVE`, `CLOSED`, `CANCELLED`).
- **Modified** `EpisodeOfCare` — gains required `caseManagementId` FK, its own
  `primaryIcd`/`primaryIcdLabel`/`secondaryIcd`/`secondaryIcdLabel` (for the
  flip). DB-level CHECK constraint enforces `division = 'REHAB'`. Existing
  fields (recert, visit auth, goals, department, status, close/reopen
  reasons) unchanged.
- **Modified** `Encounter` — gains required `caseManagementId` FK. Existing
  `episodeOfCareId` retained — populated **only when** the encounter's note
  ends up `division = 'REHAB'` and the case has an episode.

**Invariant** (lineage):

```
Note → Encounter → CaseManagement (always set)
                      └── EpisodeOfCare (set ONLY when Note.division === 'REHAB')
```

### Patient chart UI — role-aware stratification

The chart's Episodes tab becomes **Cases** (renamed). Each case is a card.

```
   STICKY HEADER — Maria Alvarez · 67F · ⚠ Penicillin · [Start visit]
   ─────────────────────────────────────────────────────────────────
   Case (1):  M17.11 · Right knee OA            Sec: Z47.1   ACTIVE  ▾
   ┌─────────────────────────────────────────────────────────────┐
   │  [REHAB]   Episode of care · 8/12 visits · recert in 14d    │ ← expanded
   │            Episode primary: M17.11   secondary: Z47.1        │   for a PT
   │            Goals (3): LTG flexion to 120° (118° ▴)            │
   │            Last visit: 3d ago — Dr. Sara Smith (PT)         │
   │            [11 rehab notes ▸]      [+ Open rehab episode]   │
   │                                                              │
   │  [MEDICAL] 3 PCP visits — most recent 6d ago            ▸   │ ← collapsed
   │  [BH]      no activity                                       │ ← muted
   └─────────────────────────────────────────────────────────────┘

   Case (2):  E11.9  Type 2 diabetes                       ACTIVE  ▸
   Case (3):  F43.22 Adjustment disorder                   ACTIVE  ▸
```

Same patient opened by an **MD** → the `[MEDICAL]` row is the expanded one;
`[REHAB]` collapses to a one-line summary; and Case 2 (diabetes) likely
*promotes above* Case 1 because that's where the MD has recent activity.

**Stratification algorithm:**
- **Within a case** — expand the division section that matches the viewing
  clinician's `profession → division`. Others collapse to a one-line
  summary; tapping opens a Sheet with that division's notes for this case.
- **Across cases** — order by (a) cases this clinician has authored notes in
  most recently, then (b) cases with most-recent activity in this clinician's
  division, then (c) most-recent overall.

The chart server-component passes the viewing clinician's `professionType`
to the client component. Re-ordering + expand decisions happen client-side.

### Visit creation flow

The Start Visit dialog gains a **case picker** before the existing site/date
controls. For rehab clinicians, an episode picker follows.

```
   1. Pick a case management        ← NEW
      ┌─────────────────────────────────────────────────────┐
      │  ◉ M17.11 Right knee OA      (your last visit 3d ago) │ ← preselected
      │  ○ E11.9  Type 2 diabetes                              │     by clinician's
      │  ○ F43.22 Adjustment disorder                          │     own most-recent
      │  ○ + New case management…   (fires de-dup check)        │     activity
      └─────────────────────────────────────────────────────┘

   2. (REHAB only) Episode of care for this case
      ┌─────────────────────────────────────────────────────┐
      │  ◉ Existing — 8/12 visits, recert 14d, primary M17.11  │
      │  ○ + Open new episode of care under this case          │
      │     └── pre-fills case's primary/secondary; PT may FLIP │
      │         them for rehab billing (decision 3)             │
      └─────────────────────────────────────────────────────┘   ← skipped for
                                                                  MEDICAL / BH

   3. Site, date — existing
```

**Auto-routing by clinician profession** (existing `PROFESSION_TO_DIVISION`
map, no change):
- **PT / OT / SLP (REHAB)** → case picker → episode picker. Note inherits
  `caseManagementId` *and* `episodeOfCareId`.
- **MD / DO / NP / PA / RN (MEDICAL)** → case picker only. Note inherits
  `caseManagementId`; `episodeOfCareId` stays null.
- **LCSW / LMFT / Psychologist (BH)** → same as MEDICAL.

The note's `division` continues to be set automatically from the clinician's
profession (the existing invariant) — never clinician-selectable.

### "+ New case management" sub-flow (de-dup)

Server endpoint `POST /api/case-management/check-dups` accepts
`{ patientId }` and returns:

```
{
  existingCases: [
    { id, primaryIcd, primaryIcdLabel, status, lastActivityAt }, …
  ],
  fhirConditions: [  // Phase 2 only — empty array in Phase 1
    { fhirId, icd, label, recordedDate }, …
  ]
}
```

The dialog presents the lists and three actions:

1. **Use this existing case** → resolves the visit to that case; no new row.
2. **Create from this FHIR condition** (Phase 2) → creates a new
   `CaseManagement` prefilled from the condition (primary ICD + label).
3. **Create new (manual)** → manual `primaryIcd` entry (Phase 1: text input;
   Phase 2: ICD-10-CM picker). Optional `secondaryIcd`. Persists, then
   resolves the visit to the new case.

This guards against duplicate cases for the same diagnosis.

### Recertification

The Recertify button moves out of `EpisodeCard`'s generic action row into a
"This is a rehab plan of care" section that only renders when the card
represents an `EpisodeOfCare`. Since EpisodeOfCare is REHAB-only by schema,
the action is intrinsically REHAB-gated — non-rehab users never see it
because they never see an episode to act on.

### Draft edit ownership

Server already enforces `Note.clinicianOrgUserId === current orgUserId` on
PATCH/sign (except ORG_ADMIN). The UI now also hides the "Edit draft" /
"Resume" affordance on drafts the viewer didn't author — they see a
read-only preview only.

## Phasing

**Phase 1 (this spec):**
- `CaseManagement` model + the data migration of existing episodes.
- Chart restructured around case cards with role-aware stratification.
- Visit-creation case picker + native-only de-dup (existing OmniScribe cases).
- Episode-of-care card UI updated (primary/secondary flip form on create).
- Recertify gated to episode cards only.

**Phase 2 (deferred — separate spec):**
- ICD-10-CM lookup picker (typeahead backed by a local CSV or a service).
- FHIR `Condition` query for de-dup at case-open time (requires EHR-linked
  patients).
- Backfill prompts for migrated cases with `primaryIcd = NULL`
  (a "needs coding" badge with a one-tap action).

## Implementation steps

1. **Schema** — add `CaseManagement` + `CaseManagementStatus` enum. Add
   nullable `caseManagementId` columns to `EpisodeOfCare` and `Encounter`.
   Add nullable `primaryIcd`/`secondaryIcd` (+ labels) to `CaseManagement`
   and `EpisodeOfCare`. Existing `EpisodeOfCare.diagnosis`/`bodyPart`
   retained — they feed `primaryIcdLabel` during migration.
2. **Data migration** — see *Existing-data migration* below.
3. **Constraints lock** — after migration succeeds, `ALTER TABLE` to
   `caseManagementId NOT NULL` on `EpisodeOfCare` and `Encounter`, plus a
   CHECK constraint `EpisodeOfCare.division = 'REHAB'`.
4. **API** — `POST /api/case-management` (create + de-dup), `GET` (list per
   patient), `PATCH`, `POST /close`. Update `POST /api/encounters` to require
   `caseManagementId`. Update `POST /api/episodes/[id]/recertify` server-side
   to validate the parent case status.
5. **UI — chart** — `patient-chart-tabs.tsx` renames the Episodes tab to
   **Cases**, renders one card per active `CaseManagement` with the
   stratification rules. Pass `viewingProfession` from the server page.
6. **UI — visit start** — `start-visit-dialog.tsx` gains the case picker
   step. The existing episode picker is now scoped to the picked case and
   only rendered for REHAB clinicians.
7. **UI — new case dialog** — new `_components/new-case-dialog.tsx`: existing-
   case dedup list + manual ICD entry (Phase 1).
8. **Verify** — `npm run lint && npm run typecheck && npm test` clean.
   `npx prisma db seed` clean.

## Existing-data migration

A single migration script, idempotent, run after `prisma migrate dev`:

1. For each existing `EpisodeOfCare` row (any division):
   - Insert a new `CaseManagement` row — `patientId`, `orgId` copied;
     `primaryIcd = NULL` (needs coding); `primaryIcdLabel = episode.diagnosis`;
     `description = episode.bodyPart`; `status` mapped from
     episode status (`ACTIVE/RECERT_DUE → ACTIVE`, `DISCHARGED → CLOSED`,
     `CANCELLED → CANCELLED`); `openedByOrgUserId = NULL` (or earliest
     authoring clinician on the episode's notes); `openedAt = episode.createdAt`.
   - Set `episode.caseManagementId = <new case id>`.
   - For REHAB episodes only: copy `episode.diagnosis` → `episode.primaryIcdLabel`.
2. For each existing `Encounter`:
   - If `encounter.episodeOfCareId IS NOT NULL` → set
     `encounter.caseManagementId = episode.caseManagementId`.
   - Else (ad-hoc encounter not under any episode) → create a synthetic
     `CaseManagement` per patient with `primaryIcd = NULL`,
     `primaryIcdLabel = 'Uncategorized care'`, and link the encounter to it.
     A "needs coding" badge on the chart prompts the next clinician to merge
     it into a real case.
3. For NON-REHAB `EpisodeOfCare` rows (the MEDICAL / BH ones that shouldn't
   exist by the new model):
   - Their encounters already inherit `caseManagementId` from step 2.
   - Null out `encounter.episodeOfCareId`.
   - Delete the non-REHAB EpisodeOfCare row.
4. Add `NOT NULL` constraint on `caseManagementId` (both tables).
5. Add the CHECK constraint `EpisodeOfCare.division = 'REHAB'`.

The migration is logged via `MIGRATION_RUN` audit entries (PHI-free metadata
— counts only).

## Downstream impact

- **`sprint-0-overview-cockpit.md`** — the "Problems" derivation currently
  reads `EpisodeOfCare.diagnosis` across divisions. After this work,
  Problems should read `CaseManagement.primaryIcd + secondaryIcd` for each
  active case — a cleaner, division-independent source. The cockpit spec
  must be updated in lockstep.
- **Snapshot strip** — unaffected; sources from extracted note measures,
  not from episodes.
- **Visit viewer** — unaffected; sources from `Note.finalJson`.

## Out of scope

- ICD-10-CM picker / lookup service (Phase 2).
- FHIR `Condition` query for new-case de-dup (Phase 2).
- Migrating historical free-text diagnoses into ICD codes (the migration
  leaves `primaryIcd = NULL` — backfill is Phase 2 UI work).
- Cockpit spec edits — flagged in *Downstream impact*; done in a follow-up
  commit alongside this work.

## Verify when done

- [ ] A patient with multiple pre-existing episodes has them reorganized
      cleanly: REHAB episodes nested under new Case Managements; non-REHAB
      episodes unwrapped into Case Managements and the episode rows deleted.
- [ ] Opening "+ New case" fires the existing-case de-dup check and presents
      matches before persisting.
- [ ] On the chart, a PT sees the REHAB section expanded for the case they
      have recent activity in; an MD on the same patient sees MEDICAL
      expanded for *their* most-active case.
- [ ] An LCSW cannot see a Recertify button anywhere — no episodes are
      shown to them (rehab-only) and no episode-less surface has the action.
- [ ] A draft note authored by Clinician A renders read-only for Clinician B
      (no Resume / Edit button).
- [ ] Starting a visit picks a case first; for a PT, an episode picker
      follows with the primary/secondary flip option pre-filled from the
      case; for an MD, it skips straight to site/date.
- [ ] `npm run typecheck && npm run lint && npm test` clean.
- [ ] Three-lens evaluation in the PR description.

## Three-lens (target)

- **Clinician** — Case management mirrors how clinicians already think:
  *"this patient is being managed for X."* Role-aware stratification removes
  cross-division cognitive overload. Recert is correctly a rehab concern.
  The primary/secondary flip respects the rehab clinician's clinical reality.
- **Compliance** — Every note attaches to a coded diagnosis via the case;
  reconstructing a patient's care history per ICD becomes a single query.
  Dual coding with the rehab flip matches Medicare therapy billing rules.
- **Auditor** — Case → episode → note lineage is single-source-of-truth.
  The primary/secondary flip is captured *in the data*, not inferred at
  read time. The de-dup audit row at case creation traces why a case was
  created vs. merged.
