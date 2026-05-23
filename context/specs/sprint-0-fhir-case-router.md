# Sprint 0.15: FHIR Phase D₁ — Conditions in the case-router

> Miss Cleo's case-router agent gains access to the patient's verified FHIR
> `Condition` list. A new proposal action — `open-new-from-condition` —
> lets the router pre-fill a brand-new case from a clinician-recorded EHR
> diagnosis, eliminating the *"Needs coding"* state for any EHR-linked
> patient. The proposal panel shows an **EHR-verified** trust pill with
> the Condition's recorder + recorded-date. **Native-only graceful
> degradation when FHIR is unavailable.**

## Context — read first

- `CLAUDE.md` — agent rules. Especially:
  - **Rule 20** — copilot reads only SIGNED/TRANSFERRED notes,
    clinician-confirmed FollowUp rows, and **verified FHIR resources**.
    This sprint operationalizes the FHIR half of that contract for the
    case-router specifically.
  - **Rule 8** — audit-log writes never wrapped in swallowing try-catch.
  - **Rule 10** — BullMQ jobs MUST have retry logic — 3 retries,
    exponential backoff. The case-router worker already has this; FHIR
    failure inside it should degrade gracefully rather than re-trigger
    retries (see *Graceful degradation* below).
- `context/specs/sprint-0-case-router-agent.md` — Sprint 0.13. Established
  the case-router agent + `CaseRouterRun` + the three core actions
  (`attach`, `attach-with-secondary`, `open-new`). This sprint extends
  **additively** — adds one action, two columns become populated, two
  audit actions appended. No schema migration; the `mirrorsFhirConditionId`
  column was already added in 0.13.
- `context/specs/sprint-0-cleo-persistent-memory.md` — Sprint 0.14.
  `CopilotPatientState.caseAwarenessJson` gains a `fhirMirror` field per
  case when this sprint lands. Backward-compatible.
- `context/specs/sprint-0-case-management.md` — Sprint 0.11. The
  `NewCaseDialog`'s de-dup endpoint was explicitly scoped as a Phase-1
  fallback in 0.11; agentic routing absorbs that responsibility here.
- Existing FHIR plumbing — `src/services/fhir/patient-client.ts` and the
  copilot's `fhir-watch-cards-live.tsx` already read Conditions
  successfully. This sprint reuses that infrastructure rather than
  adding new FHIR clients.

## Files this sprint touches

Agent + worker:
- `src/services/copilot/case-router.ts` — extend Zod schema (the new
  action + optional `fhirCitations` field); extend agent inputs; extend
  system prompt with FHIR-citation guidance.
- New: `src/services/copilot/case-router-fhir.ts` — fetcher + projector
  that turns `Condition[]` into the structured input the agent consumes
  (`{ fhirId, icd, label, recordedDate, recorderName, clinicalStatus }`).
- `src/workers/case-router/handler.ts` — wire the FHIR fetcher; populate
  `proposalJson.fhirCitations`; emit `CASE_ROUTER_FHIR_CITED` audit.

Accept endpoint:
- `src/app/api/notes/[id]/case-router/accept/route.ts` — handle the new
  action `open-new-from-condition`. Promote the pending case with the
  Condition's coded ICD + populate `mirrorsFhirConditionId`. Emit
  `CASE_FHIR_LINKED` audit.

UI:
- `src/app/(clinical)/review/[noteId]/_components/case-routing-panel.tsx` —
  render `open-new-from-condition` as a fourth action option with the
  **EHR-verified** pill (variant: `success`, small) showing
  *"recorded 2024-08-15 by Dr. Patel"*.

State (cross-cutting):
- `src/services/copilot/state-builder.ts` (from 0.14) — populate
  `caseAwarenessJson[].fhirMirror` for cases where
  `mirrorsFhirConditionId` is set. Bump `generatorVersion`.

Audit + config:
- `src/lib/audit/actions.ts` — append `CASE_ROUTER_FHIR_CITED` and
  `CASE_FHIR_LINKED`.
- New: `src/lib/case-management/fhir-router-config.ts` — small org-level
  helper that returns whether FHIR routing is currently enabled +
  healthy for an org (gates Phase D₁ on a verified connection).

## Goal

When the patient is FHIR-linked, Miss Cleo's case-router agent looks at
the EHR's coded diagnosis list alongside OmniScribe's native cases and
makes one of four decisions:

1. **Attach** to a native case (unchanged).
2. **Attach with secondary** ICD addition (unchanged).
3. **Open new** without a Condition mirror (unchanged — the "free-text
   ICD or no ICD yet" fallback).
4. **Open new from condition** *(NEW)* — pre-fill the new case's
   `primaryIcd` from a verified Condition; link via
   `CaseManagement.mirrorsFhirConditionId`; no "Needs coding" badge.

The review panel shows action 4 with a small **✓ EHR-verified** pill
plus a citation line — *"recorded 2024-08-15 by Dr. Patel"*. The
clinician confirms in one tap; the case is created with a real coded
diagnosis, traceable end-to-end.

> **Ships when**: an EHR-linked patient (a) sees Cleo's panel proposing
> `open-new-from-condition` from a real `Condition` resource when no
> native case mirrors it; (b) confirming that proposal creates a
> `CaseManagement` with `primaryIcd` from the Condition's coded value
> and `mirrorsFhirConditionId` populated; (c) audit emits
> `CASE_ROUTER_FHIR_CITED` + `CASE_FHIR_LINKED`. Non-FHIR patients see
> identical behavior to Sprint 0.13.

## Locked decisions

| # | Decision | Value |
|---|----------|-------|
| 1 | FHIR resource scope | **`Condition` only** this sprint. `Encounter` and `Observation` deferred to a later phase — keep the inputs narrow so we calibrate confidence on diagnoses first. |
| 2 | Read depth | One call per case-router run: `Condition.list(patientId)` filtered to `clinicalStatus = active`. Reuse `services/fhir/patient-client.ts`. No write-back (Sprint 0.17). |
| 3 | Schema delta | **None.** `mirrorsFhirConditionId` already exists from 0.13. `proposalJson` is JSON — adding `fhirCitations` is additive. |
| 4 | Action enum extension | Zod schema in `case-router.ts` grows by one value: `'open-new-from-condition'`. Existing Sprint-0.13 routing logic for the three prior actions is **unchanged**. |
| 5 | Provenance citation | Every Condition referenced by the agent is logged in `proposalJson.fhirCitations`: `[{ resourceType: 'Condition', fhirId, lastUpdated, recorder, recordedDate }]`. PHI-free audit row carries the count + `fhirId`s; full data lives in the run row. |
| 6 | "EHR-verified" pill | `StatusBadge variant="success"` with `Sparkles` or `BadgeCheck` icon, accompanied by a citation line. Pill is visible only on action 4; never inferred for action 3 (`open-new`). |
| 7 | Graceful degradation | FHIR fetch failure (timeout, 401, 5xx, scope expired) → agent runs with `fhirConditions = []` and emits `CASE_ROUTER_FHIR_UNAVAILABLE` audit (no retry; the routing decision still ships using native data). The worker's BullMQ retry budget is reserved for genuine agent / DB failures. |
| 8 | Pre-existing dedup endpoint | `POST /api/case-management/check-dups` (the Phase-1 fallback for manual `NewCaseDialog` flow) ALSO gains FHIR Condition checking in this sprint, since the helper now exists. Same source of truth. |
| 9 | Org gate | A new helper `isFhirRouterEnabled(orgId)` returns true only when the org has a verified FHIR connection. Defaults ON when connection is verified; OFF otherwise. No new admin UI yet — the toggle is implicit on connection state. |
| 10 | Backward compatibility | A patient with no FHIR link, or an org with FHIR disabled, sees **identical** Sprint-0.13 behavior. The new action is impossible to surface without a verified Condition. |

## Design

### Agent inputs — additive

The `case-router.ts` agent function gains one new optional input:

```ts
type CaseRouterAgentInputs = {
  // ... existing fields from Sprint 0.13 ...
  fhirConditions?: Array<{
    fhirId: string;
    icd: string;            // ICD-10 code from Condition.code.coding
    icdLabel: string;       // Human label from Condition.code.text
    clinicalStatus: 'active' | 'recurrence' | 'relapse' | 'resolved' | 'remission';
    recordedDate: string;   // ISO
    recorderName: string | null;
    lastUpdated: string;    // ISO
  }>;
};
```

When `fhirConditions` is present and non-empty, the system prompt grows
by one short instruction block:

> *"You also have the patient's EHR-recorded diagnosis list (FHIR
> Conditions). When a clinically-active Condition matches the visit's
> content but no OmniScribe case mirrors it (`mirrorsFhirConditionId`
> null on all native cases for this patient), prefer the
> `open-new-from-condition` action over `open-new` — it produces a coded
> case with verified provenance."*

When `fhirConditions` is empty or absent, the prompt block is omitted
and the agent behaves identically to Sprint 0.13.

### Structured output — additive

Zod schema extension:

```ts
export const CaseRouterProposalSchema = z.object({
  action: z.enum([
    'attach',
    'attach-with-secondary',
    'open-new',
    'open-new-from-condition',  // NEW
  ]),
  // ... existing fields ...
  newCaseFromCondition: z.object({   // NEW — set only for action 4
    fhirConditionId: z.string(),
    primaryIcd: z.string(),           // required — coded
    primaryIcdLabel: z.string(),
    recordedDate: z.string(),
    recorderName: z.string().nullable(),
  }).optional(),
  // ... rest unchanged ...
  fhirCitations: z.array(z.object({   // NEW — populated on any FHIR-aware run
    resourceType: z.literal('Condition'),
    fhirId: z.string(),
    lastUpdated: z.string(),
    recorder: z.string().nullable(),
    recordedDate: z.string(),
  })).optional(),
});
```

All four actions' existing payload shapes are unchanged. `newCase`
remains the field for action 3; `newCaseFromCondition` is its FHIR-backed
cousin for action 4.

### Worker flow

```
ai-generation complete → enqueueCaseRouterJob
                              ↓
                    case-router/handler.ts:
                      1. Load Note + patient + cases (existing).
                      2. If isFhirRouterEnabled(orgId) AND
                         patient.fhirIdentities exist:
                           → call fetchPatientConditions(...)
                           → on failure: log + emit
                             CASE_ROUTER_FHIR_UNAVAILABLE, continue
                             with fhirConditions = [].
                      3. Call caseRouter.propose({..., fhirConditions}).
                      4. Persist CaseRouterRun.
                      5. Emit CASE_ROUTER_PROPOSED (existing).
                      6. If proposalJson.fhirCitations?.length > 0:
                           → emit CASE_ROUTER_FHIR_CITED.
```

### Accept endpoint — new action handler

`POST /api/notes/[id]/case-router/accept` gains a fourth branch:

```ts
case 'open-new-from-condition': {
  // The pending case row exists from encounter creation (Sprint 0.13).
  // Promote it: set status, copy the Condition's coded values, link.
  await tx.caseManagement.update({
    where: { id: pendingCase.id },
    data: {
      status: 'ACTIVE',
      primaryIcd: decision.fhirConditionData.primaryIcd,
      primaryIcdLabel: decision.fhirConditionData.primaryIcdLabel,
      mirrorsFhirConditionId: decision.fhirConditionData.fhirConditionId,
      openedAt: new Date(),
    },
  });
  // Audit (after the tx, rule 8 — never swallow):
  await writeAuditLog({
    userId, orgId,
    action: 'CASE_FHIR_LINKED',
    resourceId: pendingCase.id,
    metadata: {
      caseRouterRunId,
      fhirConditionId: decision.fhirConditionData.fhirConditionId,
      personaVersion: 'miss-cleo-v1',
    },
  });
  break;
}
```

The existing three branches are untouched.

### Review-panel UI — additive

`case-routing-panel.tsx` renders all four actions as radio options. For
action 4, an extra row beneath the radio shows the provenance pill:

```
○ Open a new case (M54.81 — Cervicogenic headache)
  ✓ EHR-verified · recorded 2024-08-15 by Dr. Patel
```

Pill is a `StatusBadge variant="success"` with the `BadgeCheck` icon
(lucide). When `decision.fhirConditionData` is missing (action 3), the
pill does not render — `open-new` retains the "Needs coding" semantics
when the agent couldn't find a Condition.

When the agent's confidence is **HIGH** and the proposed action is
`open-new-from-condition`, it pre-selects this option (the trust signal
plus the coded ICD justifies a default toward "yes").

### State-builder integration (cross-cutting, additive)

`src/services/copilot/state-builder.ts` (from 0.14) extends
`caseAwarenessJson` per case:

```ts
{
  // ... existing fields ...
  fhirMirror?: {
    conditionId: string;
    clinicalStatus: string;
    lastUpdated: string;
  };
}
```

Populated whenever `CaseManagement.mirrorsFhirConditionId` is non-null.
Bump `generatorVersion` (e.g. `'state-builder-v2'`) so existing rows
re-build on the next event-driven trigger.

### Existing dedup endpoint — FHIR awareness

`POST /api/case-management/check-dups` (used by `NewCaseDialog` as the
manual fallback) gains the same FHIR Condition lookup. When the caller
queries for a patient with a verified FHIR connection, the response
includes a `fhirConditions: [...]` array alongside the existing
`existingCases: [...]`. UI in the dialog can be updated to surface them
side-by-side; for this sprint we ship the data only, dialog UI can
follow.

### Audit additions

Append-only to `AuditAction`:

| Action | When | Metadata (PHI-free) |
|--------|------|---------------------|
| `CASE_ROUTER_FHIR_CITED` | Worker run produced a proposal that cited at least one FHIR Condition | `{ caseRouterRunId, citationCount, fhirIds: string[], personaVersion }` |
| `CASE_FHIR_LINKED` | Accept endpoint set `mirrorsFhirConditionId` on a case | `{ caseManagementId, caseRouterRunId, fhirConditionId, personaVersion }` |
| `CASE_ROUTER_FHIR_UNAVAILABLE` | Worker tried to fetch Conditions but the FHIR call failed (degraded path) | `{ orgId, patientId, errorKind: 'timeout'\|'auth'\|'5xx', personaVersion }` |

All three carry `personaVersion: 'miss-cleo-v1'` for unified Cleo
telemetry.

## Implementation steps

1. **FHIR fetcher** (`src/services/copilot/case-router-fhir.ts`):
   - `fetchPatientConditions(args: { orgId, patientId })` →
     `FhirConditionForRouter[]` or `null` on failure.
   - Reuses `services/fhir/patient-client.ts`. Filters
     `clinicalStatus = active`. Times out after 4s.
2. **Agent extension** (`src/services/copilot/case-router.ts`):
   - Add `fhirConditions?` to inputs.
   - Extend Zod schema with new action + `newCaseFromCondition` +
     `fhirCitations`.
   - Extend system prompt with the FHIR-citation block (only included
     when `fhirConditions` is non-empty).
3. **Worker wiring** (`src/workers/case-router/handler.ts`):
   - Call `isFhirRouterEnabled(orgId)`; if true and patient is linked,
     call the fetcher.
   - On fetcher failure → emit `CASE_ROUTER_FHIR_UNAVAILABLE`, continue
     with empty array.
   - On success → pass `fhirConditions` to `caseRouter.propose`.
   - After persist → if `proposalJson.fhirCitations?.length > 0`, emit
     `CASE_ROUTER_FHIR_CITED`.
4. **Accept endpoint** (`/api/notes/[id]/case-router/accept`):
   - Add `'open-new-from-condition'` branch.
   - Promote the pending case with coded ICD + link
     `mirrorsFhirConditionId`.
   - Emit `CASE_FHIR_LINKED`.
5. **Review panel**
   (`src/app/(clinical)/review/[noteId]/_components/case-routing-panel.tsx`):
   - Render the fourth action option with the **EHR-verified** pill +
     citation line.
   - When `confidence === 'high'` AND action is
     `open-new-from-condition`, pre-select it.
6. **State-builder** (`src/services/copilot/state-builder.ts`):
   - Populate `caseAwarenessJson[].fhirMirror` for cases with
     `mirrorsFhirConditionId`.
   - Bump `generatorVersion`.
7. **Dedup endpoint extension** (`/api/case-management/check-dups`):
   - Add the FHIR Condition lookup; return alongside
     `existingCases`.
8. **Org gate helper**
   (`src/lib/case-management/fhir-router-config.ts`):
   - `isFhirRouterEnabled(orgId)`: returns `true` iff the org has a
     verified FHIR connection (read from `Org.fhirConnections`).
9. **Audit actions** appended (`src/lib/audit/actions.ts`).
10. **Tests**:
    - `test/services/copilot/case-router-fhir.test.ts` — fetcher;
      timeout; auth error; empty Conditions list; happy path.
    - `test/services/copilot/case-router-agent.test.ts` (extend) —
      Zod validates the new action; system prompt block is included only
      when `fhirConditions` is non-empty.
    - `test/workers/case-router-handler.test.ts` (extend) — FHIR
      fetcher failure → audit + continue; success → citations populate +
      `CASE_ROUTER_FHIR_CITED` emitted.
    - `test/api/case-router-accept.test.ts` (extend) —
      `open-new-from-condition` branch: case promotes, `mirrorsFhirConditionId`
      set, `CASE_FHIR_LINKED` audited.
    - `test/components/case-routing-panel.test.tsx` (extend) — renders
      EHR-verified pill; pre-selects HIGH-confidence
      `open-new-from-condition`.
11. **Verify** — see *Verify when done* below.

## Out of scope (deliberate)

- **FHIR `Encounter` and `Observation` inputs.** Conditions only this
  sprint. Adding more resource types is its own phase once we've
  calibrated confidence on diagnoses.
- **FHIR write-back.** Sprint 0.17. The agent reads Conditions; it does
  not propose creating new Conditions in the EHR.
- **Reconciliation / drift detection.** Sprint 0.16 adds the
  `reconcile` action when OmniScribe and FHIR disagree on a case's
  status.
- **Manual override of FHIR-coded ICD in the dialog.** If the clinician
  picks a Condition but wants to change its label/code at the moment of
  case creation, that's not in scope. The case opens exactly as the
  Condition codes; subsequent edits via case admin UI.
- **NewCaseDialog UI changes** to surface the FHIR Condition list
  visually. Data is returned by the dedup endpoint; UI surfacing is a
  small follow-up.
- **Confidence calibration based on Condition recency.** Stale
  Conditions (e.g., `recordedDate` > 2 years old, `clinicalStatus =
  resolved`) get the same scoring as fresh ones in this sprint. Sprint
  0.16's reconciliation will refine this.

## Verify when done

- [ ] On a FHIR-linked patient with a Condition not yet mirrored to a
      native case, the case-router proposes `open-new-from-condition`
      with the Condition's coded ICD.
- [ ] The review panel renders the new action option with a green
      **✓ EHR-verified** pill + citation line (*"recorded YYYY-MM-DD by
      \<recorder name\>"*).
- [ ] Confirming the proposal promotes the pending case to ACTIVE,
      sets `primaryIcd` + `primaryIcdLabel` from the Condition, and
      populates `mirrorsFhirConditionId`. No "Needs coding" badge
      appears on the resulting case.
- [ ] `CASE_ROUTER_FHIR_CITED` fires when the agent's proposal carries
      `fhirCitations`. `CASE_FHIR_LINKED` fires when a case is opened
      via the new action.
- [ ] On a non-FHIR-linked patient, the proposal panel behaves
      **identically** to Sprint 0.13. The new action is impossible to
      surface.
- [ ] When FHIR returns 401 / 5xx / timeout, the worker emits
      `CASE_ROUTER_FHIR_UNAVAILABLE`, continues with the native flow,
      and the review panel still renders a valid proposal — no
      blocking error.
- [ ] `MissCleoPatientState.caseAwarenessJson[].fhirMirror` populates
      for cases with `mirrorsFhirConditionId` set;
      `generatorVersion` bumped so existing rows refresh on next event.
- [ ] `npm run typecheck` clean. `npm run lint` clean on touched
      files. `npm test` clean (existing + new tests pass).
- [ ] `npx prisma db seed` clean (no schema migration in this sprint;
      seed unaffected).
- [ ] Three-lens documented in the PR body.

## Three-lens

- **Clinician** — When the EHR has the diagnosis coded already, Miss
  Cleo proposes it back with verified provenance. The clinician
  confirms in one tap; no manual ICD entry, no "Needs coding" badge.
  When the EHR is silent or unreachable, behavior is identical to
  yesterday — zero regression.
- **Compliance** — Every FHIR-cited routing decision is captured:
  the `Condition.fhirId` + `recordedDate` + `recorder` are persisted
  in `CaseRouterRun.proposalJson.fhirCitations`, audited via
  `CASE_ROUTER_FHIR_CITED`, and linked to the resulting case via
  `mirrorsFhirConditionId` + `CASE_FHIR_LINKED`. Single coherent
  provenance chain from a Medicare auditor's perspective.
- **Auditor** — `CASE_ROUTER_FHIR_UNAVAILABLE` is recorded explicitly
  when the system degraded — never a silent fall-through. The audit
  trail distinguishes "the agent never had FHIR data" from "the
  agent had data and chose not to cite it."

## Downstream impact

- **Sprint 0.16 (FHIR Phase D₂ — reconciliation)** — adds a fifth
  action `reconcile`. Status-drift detection between
  `CaseManagement.status` and `Condition.clinicalStatus`. Uses
  `mirrorsFhirConditionId` (now populated by this sprint) to know which
  cases are eligible. The review panel grows a conflict banner UI
  variant. Schema delta: a new `CaseFhirDriftLog` table for tracking
  detected drifts over time.
- **Sprint 0.17 (FHIR Phase D₃ — write-back)** — when the clinician
  confirms `open-new` (action 3, no Condition match), an optional
  sub-checkbox appears: *"Also record this diagnosis in the EHR."* On
  confirm, a FHIR `Condition` is POSTed via
  `services/fhir/patient-client.ts`; the response's id is written
  to `mirrorsFhirConditionId`. Org-level policy gate
  (`fhirWriteBackPolicy`). No-op when policy is `never` or
  organization-level write scopes are missing.
- **Sprint 0.18 (proactive nudges)** — `observedPatternsJson` gains
  a new pattern kind `fhir_condition_unaddressed`: a Condition is
  active in the EHR but has no recent OmniScribe visit on the
  mirroring case. Surfaces as a non-intrusive nudge on the chart.
