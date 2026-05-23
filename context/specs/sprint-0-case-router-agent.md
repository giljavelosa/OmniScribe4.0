# Sprint 0.13: Miss Cleo's case-routing agent (Phase A + B)

> The agentic case-routing system. Visit recording no longer requires the
> clinician to pick a case upfront — they tap **Start visit**, record, and
> at review time Miss Cleo presents a structured case-routing proposal with
> citational reasoning. The clinician confirms (1 tap) or overrides; the
> note attaches to the right case atomically; audit captures both the
> proposal and the decision. **Native cases only — FHIR-aware reconciliation
> is Sprint 0.15.**

## Context — read first

- `CLAUDE.md` — agent rules. Especially:
  - **Rule 2** — `NoteStatus` enum values append-only. Same discipline
    applies to `CaseManagementStatus` here (`PENDING_ROUTER` is appended,
    not inserted).
  - **Rule 4** — `npx prisma db seed` after every schema change.
  - **Rule 8** — audit-log writes never wrapped in swallowing try-catch.
  - **Rule 10** — BullMQ jobs MUST have retry logic — 3 retries,
    exponential backoff.
  - **Rule 20** — the copilot reads only SIGNED/TRANSFERRED notes,
    clinician-confirmed FollowUp rows, and verified FHIR resources. The
    case-router agent honors this exactly.
  - **Rule 24** — agent does **data routing only**, never clinical
    recommendations. Its proposal says *"this visit's content matches
    case X"* — never *"you should treat this as X."*
- `context/specs/sprint-0-case-management.md` — Sprint 0.11. Establishes
  `CaseManagement` + `EpisodeOfCare` + the `Encounter → CaseManagement`
  linkage. This sprint extends that model with a routing layer above it.
- `context/specs/sprint-0-cleo-persona-pass.md` — Sprint 0.12. Should land
  *first* so clinicians meet Miss Cleo on the brief + handout before her
  case-routing panel asks for trust.
- `context/specs/42-copilot-persona-miss-cleo.md` — the persona module.
  This sprint reuses `buildPersonaSystemBlock('chart')` +
  `PERSONA_ANTI_DRIFT_BLOCK` for the agent's system prompt and brands the
  review-screen panel as *"✨ Miss Cleo's case routing"*.

## Files this sprint touches

Schema + migration:
- `prisma/schema.prisma` — append `PENDING_ROUTER` to `CaseManagementStatus`;
  new `CaseRouterRun` model + `RouterConfidence` enum; new
  `mirrorsFhirConditionId` (nullable) column on `CaseManagement`.
- A new Prisma migration directory.

Server (encounter creation):
- `src/lib/encounters/start.ts` — auto-create pending case when no
  `caseManagementId` supplied.
- `src/app/api/encounters/route.ts` — body schema makes
  `caseManagementId` optional.
- `src/app/api/schedules/[id]/start/route.ts` — same.
- `src/app/api/admin/telehealth/sessions/[id]/start/route.ts` — same.

Agent + worker:
- New: `src/services/copilot/case-router.ts` — the agent service.
- New: `src/workers/case-router/handler.ts` — the BullMQ worker.
- `src/workers/ai-generation/handler.ts` — chain-enqueue the case-router
  job on AI-generation completion (same pattern as the existing
  `enqueueNoteBriefJob`).

Accept endpoint:
- New: `src/app/api/notes/[id]/case-router/accept/route.ts`.

UI:
- New: `src/app/(clinical)/review/[noteId]/_components/case-routing-panel.tsx`.
- `src/app/(clinical)/review/[noteId]/_components/review-client.tsx` — mount
  the panel at the top of the review screen.
- `src/app/(clinical)/patients/[id]/_components/start-visit-dialog.tsx` —
  case picker becomes the *override* path; default flow POSTs without a
  case id.
- `src/app/(clinical)/patients/[id]/_components/start-visit-button.tsx` —
  passes through.
- `src/app/(clinical)/patients/[id]/_components/patient-chart-tabs.tsx` —
  the existing hero card's "Continue this case" button stays — it remains
  the explicit pre-route shortcut for clinicians who want to pre-select.

Audit:
- `src/lib/audit/actions.ts` — append three new actions.

## Goal

A clinician taps **Start visit** on a patient's chart. The encounter is
created with a `PENDING_ROUTER` case. Recording proceeds normally. After
AI-generation completes, Miss Cleo's case-router worker fires and writes a
`CaseRouterRun` with a structured proposal. The clinician opens the review
screen and sees, at the top:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ✨ Miss Cleo's case routing  ·  confidence: HIGH                        │
│                                                                          │
│ ◉ Attach to existing case                                                │
│   M54.81  Cervicogenic headache  ·  your active case                     │
│   + add M25.51 (shoulder pain) as a secondary ICD on this case          │
│                                                                          │
│   Why: today's visit focuses on right-shoulder pain, described alongside │
│   continued neck symptoms. Your last 11 notes anchor to M54.81; the      │
│   Assessment identifies cervicogenic and rotator-cuff contributions      │
│   together.                                                              │
│                                                                          │
│ ○ Open a new case  (M25.51 Shoulder pain)                                │
│ ○ Change manually…                                                       │
│                                                                          │
│                                  [ Confirm and continue review ▸ ]      │
└─────────────────────────────────────────────────────────────────────────┘
```

The clinician confirms (1 tap) or overrides. The encounter rebinds (or the
pending case promotes) atomically. Audit captures the proposal + the
decision. By sign-time, the case is locked.

> **Ships when** a recording started without a case can complete its full
> pipeline — AI-generation → case-router proposal → review-screen panel →
> clinician confirmation → encounter case-linkage settled — with audit
> reconstructing the routing decision end-to-end.

## Locked decisions

| # | Decision | Value |
|---|----------|-------|
| 1 | When the agent runs | After AI generation completes, before the review screen renders. BullMQ worker chained from the ai-generation worker. |
| 2 | Encounter case-linkage | `Encounter.caseManagementId` stays NOT NULL. When no case is supplied, the server auto-creates a `PENDING_ROUTER` case and binds the encounter to it. The invariant *"every encounter has a case"* is preserved. |
| 3 | When routing settles | At **review**, not at sign. The clinician confirms while reviewing the draft; by sign, the case linkage is locked the same as `finalJson`. |
| 4 | Override path | Always one click. "Change manually…" opens the existing case picker (the same component the StartVisitDialog uses). Reuse, don't duplicate. |
| 5 | Confidence-gated UI weight | HIGH → pre-select + primary "Confirm" button. MEDIUM → pre-select + "Why" expanded by default. LOW → no pre-selection; clinician picks from alternatives. |
| 6 | Model | Claude Sonnet via Bedrock (existing infra at `src/services/llm/`). Structured output via Zod-validated JSON. Fallback to Haiku on quota/error. |
| 7 | Persona | All system prompts include `buildPersonaSystemBlock('chart')` + `PERSONA_ANTI_DRIFT_BLOCK` from `persona.ts`. The agent IS Miss Cleo — no separate identity. |
| 8 | Audit | New actions `CASE_ROUTER_PROPOSED`, `CASE_ROUTER_ACCEPTED`, `CASE_ROUTER_OVERRIDDEN`. All three carry `personaVersion: 'miss-cleo-v1'`. |
| 9 | Stub mode | When `STUB_MODE=true` or no Bedrock key, the worker writes a synthetic `CaseRouterRun` (confidence `LOW`, action `open-new` with `primaryIcd = null`, reasoning "Auto-route unavailable in stub mode — pick manually.") so the review panel still renders and the clinician can complete the flow. |
| 10 | FHIR | **Not in this sprint.** No `Condition.list` in the agent's inputs. Sprint 0.15 adds it. Phase 1 reasoning operates on OmniScribe cases only. |
| 11 | Hero card from 0.11.1 | **Retained.** Browsing the patient's cases still benefits from the hero treatment, and clinicians who *want* to pre-select before recording use it as a shortcut. Most won't, with agentic routing. |

## Design

### Phase A — schema + pending-case flow

**Append to `CaseManagementStatus`** (rule-2 append-only):

```prisma
enum CaseManagementStatus {
  ACTIVE
  CLOSED
  CANCELLED
  PENDING_ROUTER  // NEW — encounter is bound while Miss Cleo routes.
}
```

**New table** + **new enum**:

```prisma
model CaseRouterRun {
  id                 String    @id @default(cuid())
  orgId              String
  noteId             String    @unique
  proposalJson       Json
  confidence         RouterConfidence
  reasoning          String
  modelVersion       String
  createdAt          DateTime  @default(now())
  acceptedAction     String?   // 'accepted' | 'overridden-attach' |
                                //   'overridden-open-new' | 'overridden-manual'
  acceptedAt         DateTime?
  acceptedByUserId   String?

  organization       Organization @relation(fields: [orgId], references: [id])
  note               Note         @relation(fields: [noteId], references: [id])
  acceptedBy         User?        @relation(fields: [acceptedByUserId], references: [id])

  @@index([orgId, createdAt])
}

enum RouterConfidence {
  HIGH
  MEDIUM
  LOW
}
```

**New nullable column** on `CaseManagement` (forward-compatible with Sprint
0.15's FHIR phase):

```prisma
model CaseManagement {
  // ... existing fields ...
  mirrorsFhirConditionId String?  // populated by Sprint 0.15 when the case
                                   // opens from a verified FHIR Condition.
}
```

**Encounter creation flow** in `src/lib/encounters/start.ts`:

When `caseManagementId` is NOT supplied:

1. Inside the existing transaction, before encounter create:
   ```ts
   const pendingCase = await tx.caseManagement.create({
     data: {
       orgId,
       patientId,
       primaryIcd: null,
       primaryIcdLabel: 'Routing in progress',
       status: 'PENDING_ROUTER',
       openedByOrgUserId: clinicianOrgUserId,
       openedAt: new Date(),
     },
   });
   caseManagementIdForEncounter = pendingCase.id;
   ```
2. Use that id when creating the encounter.

When `caseManagementId` IS supplied (override path from "Change manually"
or the chart's hero "Continue this case" button), the existing flow runs
unchanged.

### Phase B — the agent

**`src/services/copilot/case-router.ts`** — the service. Mirrors the
existing `src/services/copilot/agent.ts` patterns.

**Structured output schema** (Zod-validated):

```ts
export const CaseRouterProposalSchema = z.object({
  action: z.enum(['attach', 'attach-with-secondary', 'open-new']),
  caseManagementId: z.string().optional(),
  newCase: z.object({
    primaryIcd: z.string().nullable(),
    primaryIcdLabel: z.string(),
    secondaryIcd: z.string().optional(),
    secondaryIcdLabel: z.string().optional(),
  }).optional(),
  secondaryIcdAddition: z.object({
    icd: z.string(),
    icdLabel: z.string(),
  }).optional(),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z.string(),
  alternatives: z.array(z.object({
    action: z.enum(['attach', 'open-new']),
    caseManagementId: z.string().optional(),
    newCase: z.object({
      primaryIcd: z.string().nullable(),
      primaryIcdLabel: z.string(),
    }).optional(),
    reasoning: z.string(),
  })).max(3),
});
export type CaseRouterProposal = z.infer<typeof CaseRouterProposalSchema>;
```

**Inputs** (passed by the worker):

- `noteId`, `orgId`, `patientId`.
- Drafted Note's `assessmentSnippet` + `planSnippet` (derive from
  `draftJson` or `finalJson`; reuse the same helper the chart uses).
- The patient's `CaseManagement[]` projection with the three recency
  signals (`viewerLastActivityAt`, `viewerDivisionLastActivityAt`,
  `lastActivityAt`) — reuse the projection from
  `src/app/(clinical)/patients/[id]/page.tsx`.
- The recording clinician's `professionType` → `division`.

**Tools available** (reuse the existing copilot catalog where possible):

- `listPatientCases(patientId)` — server projection of cases.
- `lookupSignedNote(noteId)` — for cross-visit context (rule-20 — only
  signed notes).
- `lookupEpisodeGoals(episodeId)` — for rehab arc detail.

**System prompt** — concatenation of:

1. `buildPersonaSystemBlock('chart')` — Miss Cleo's voice + scope.
2. `PERSONA_ANTI_DRIFT_BLOCK` — the rule-20/24 reminder.
3. A case-router-specific instruction block (~30 lines) describing the
   three action types, the confidence rubric, the reasoning citation rule
   *("cite specific cases by id or specific sentence fragments from the
   Assessment")*, and the JSON output schema.

**Output validation** — Zod-parsed. If invalid, the worker falls back to a
synthetic LOW-confidence `open-new` proposal with `reasoning: 'Auto-route
unavailable — pick manually.'` (Same as stub mode.)

### Phase B — the worker

**`src/workers/case-router/handler.ts`** — BullMQ worker.

- Listens on `case-router` job type (same queue as other workers).
- Triggered by the ai-generation worker on completion. Add the
  enqueue call in `src/workers/ai-generation/handler.ts` at the same point
  it currently calls `enqueueNoteBriefJob`.
- Loads the Note + patient + case projection.
- Calls `caseRouter.propose({...})`.
- Writes a `CaseRouterRun` row.
- Audits `CASE_ROUTER_PROPOSED` with metadata `{ noteId, caseRouterRunId,
  confidence, modelVersion, action, alternativesCount, personaVersion:
  'miss-cleo-v1' }`. No PHI.
- Retry: 3 retries, exponential backoff (rule 10).
- On exhaustion, write a `confidence: LOW` synthetic run so the review
  panel still renders.

### Phase B — accept endpoint

**`POST /api/notes/[id]/case-router/accept`**:

Body:

```ts
{
  caseRouterRunId: string,        // for audit traceability
  decision:
    | { kind: 'accept' }
    | { kind: 'attach', caseManagementId: string }
    | { kind: 'open-new', primaryIcd: string | null, primaryIcdLabel: string, secondaryIcd?: string, secondaryIcdLabel?: string }
    | { kind: 'attach-with-secondary', caseManagementId: string, icd: string, icdLabel: string }
}
```

In a single transaction:

- **Resolve the chosen action** from the body. If `kind: 'accept'`, read
  the proposal's `action` from `proposalJson`.
- **Apply**:
  - `attach` → `encounter.caseManagementId = chosen`; delete the pending case
    if the current encounter's case has `status = PENDING_ROUTER`.
  - `attach-with-secondary` → same as attach + update the chosen case's
    `secondaryIcd`/`secondaryIcdLabel` (only when the slot is empty; never
    overwrite).
  - `open-new` → promote the pending case: set `status = ACTIVE`,
    `primaryIcd`, `primaryIcdLabel`, optional secondary. Encounter remains
    bound to the same row.
- **Update `CaseRouterRun`**: set `acceptedAction`, `acceptedAt`,
  `acceptedByUserId`.
- **Audit**: `CASE_ROUTER_ACCEPTED` (when decision matches proposal) or
  `CASE_ROUTER_OVERRIDDEN` (when it differs). Metadata as documented in
  *Audit* below.

Authorization: `requireFeatureAccess('NOTE_EDIT')` + the user must be the
note's author (`note.clinicianOrgUserId === orgUser.id`) **or** an
`ORG_ADMIN`. Same rule as note section edits.

### Phase B — the review-screen panel

**`src/app/(clinical)/review/[noteId]/_components/case-routing-panel.tsx`**.

- Server-fetches the latest `CaseRouterRun` for the noteId (or via the
  existing SSE channel — see *Loading strategy* below).
- Renders the panel as sketched at the top of this spec. Branded with the
  `Sparkles` icon and `"Miss Cleo's case routing"` heading (using
  `COPILOT_DISPLAY_NAME`).
- Confidence drives the affordances:
  - HIGH: pre-selects the recommended action; "Confirm and continue
    review" is the loud CTA.
  - MEDIUM: pre-selects + "Why" expanded by default; "Confirm" is loud
    but the alternatives are visible.
  - LOW: nothing pre-selected; the panel says *"I'd want a human read on
    this — pick from these or open new."* All alternatives shown as peers.
- "Change manually…" toggles to the existing `CaseRadio` picker from
  `start-visit-dialog.tsx` (reused, not duplicated).
- On Confirm, POSTs to the accept endpoint above.
- After acceptance, the panel collapses to a small pill:
  `"✓ Cleo's routing accepted: M54.81 (cervicogenic headache)"`.

**Loading strategy** — the panel mounts on review-page load:
- If a `CaseRouterRun` row exists, render the proposal.
- If not (the worker hasn't fired yet — clinician opened review very
  quickly), render a small *"Miss Cleo is reviewing this visit…"*
  placeholder + subscribe to the existing SSE channel for updates.
- If after 60s no run exists, fall through to a fallback prompt: *"Auto-
  route unavailable — pick a case manually."* + the picker.

Mount this above the section accordions, after the patient identity header
on the review screen.

### Existing surfaces — what changes

- **StartVisitDialog** — the case picker becomes the *override* path. The
  default flow when starting a visit: no picker, encounter creates with
  pending case. The picker renders only when:
  - The clinician explicitly hits *"Change manually"* from the proposal
    panel later.
  - The chart hero's *"Continue this case"* button supplies an explicit
    `caseManagementId` (the bypass shortcut from Sprint 0.11.1 — kept).
- **The hero card** from Sprint 0.11.1 stays. Browsing benefits from the
  hero visual treatment; the *"Continue this case"* button remains for
  clinicians who want to pre-route.
- **CasesPanel** — unchanged. Still the browse/admin surface.

### Audit (new actions)

Append-only to `AuditAction` (rule-2 compliant since these are new):

| Action | When | Metadata (PHI-free) |
|--------|------|---------------------|
| `CASE_ROUTER_PROPOSED` | Worker writes a `CaseRouterRun` | `{ noteId, caseRouterRunId, confidence, modelVersion, action, alternativesCount, personaVersion }` |
| `CASE_ROUTER_ACCEPTED` | Accept endpoint fires; chosen action == proposal | `{ caseRouterRunId, caseManagementId, action, personaVersion }` |
| `CASE_ROUTER_OVERRIDDEN` | Accept endpoint fires; chosen action != proposal | `{ caseRouterRunId, proposedAction, chosenAction, caseManagementId, personaVersion }` |

The pair `CaseRouterRun` + audit lets a regulator reconstruct *every*
routing decision: what the AI proposed (with reasoning + confidence), what
the clinician chose, and when.

## Implementation steps

1. **Phase A — schema migration** (additive only):
   - Append `PENDING_ROUTER` to `CaseManagementStatus`.
   - Add `mirrorsFhirConditionId` (nullable) on `CaseManagement`.
   - Create `CaseRouterRun` table + `RouterConfidence` enum.
   - `npx prisma migrate dev --name sprint_0_13_case_router`.
   - `npx prisma db seed` (rule 4) — verify clean.
2. **Phase A — encounter flow:**
   - Update `src/lib/encounters/start.ts` to auto-create a pending case
     when none supplied (inside the existing tx).
   - Update the four caller routes (`/api/encounters`, `/api/schedules/[id]/start`,
     `/api/admin/telehealth/sessions/[id]/start`) to make `caseManagementId`
     optional in their body schemas.
   - Update `start-visit-dialog.tsx` default flow: no case picker by
     default; POST without case id; picker renders only on explicit
     override.
3. **Phase B — agent service:**
   - Create `src/services/copilot/case-router.ts` with the Zod schema,
     `propose()` function, persona-block-prefixed system prompt, tool
     catalog binding. Reuse Bedrock infra from `services/llm/`.
   - Stub-mode fallback path.
4. **Phase B — worker:**
   - Create `src/workers/case-router/handler.ts`. Register on the BullMQ
     queue. Add `enqueueCaseRouterJob` to `src/lib/queue/`.
   - In `src/workers/ai-generation/handler.ts`, chain-enqueue the
     case-router job at the same point `enqueueNoteBriefJob` is called.
5. **Phase B — accept endpoint:**
   - Create `src/app/api/notes/[id]/case-router/accept/route.ts`.
   - Implement the transactional rebind/promote/update logic above.
6. **Phase B — review panel:**
   - Create
     `src/app/(clinical)/review/[noteId]/_components/case-routing-panel.tsx`.
   - Mount it in `review-client.tsx` at the top of the review screen, above
     the section accordions.
   - Wire the "Change manually" branch to the existing case picker
     component from `start-visit-dialog.tsx`.
7. **Phase B — audit:**
   - Append `CASE_ROUTER_PROPOSED`, `CASE_ROUTER_ACCEPTED`,
     `CASE_ROUTER_OVERRIDDEN` to `src/lib/audit/actions.ts`.
8. **Tests** (rule 21 — test coverage on every PR):
   - `test/lib/case-router/propose.test.ts` — agent stub-mode fallback +
     Zod validation + each of the three actions parses correctly.
   - `test/api/case-router-accept.test.ts` — transactional rebind/promote
     logic; override case; case-not-found case.
   - `test/workers/case-router-handler.test.ts` — chain-enqueue from
     ai-generation; retry; eventual-LOW fallback.
9. **Verify** — see *Verify when done* below.

## Out of scope (deliberate)

- **FHIR Conditions in the agent's input** — Sprint 0.15 (Phase D₁ of the
  FHIR work). When that lands, the proposal gains an
  `open-new-from-condition` action + the "EHR-verified" pill.
- **Persistent per-patient Cleo memory** (`MissCleoPatientState`) — Sprint
  0.14. The case-router will read it when it exists, but doesn't require
  it.
- **Proactive nudges** — Sprint 0.18.
- **ICD-10 typeahead picker** — still Phase 2 of
  `sprint-0-case-management.md`. Until then, `open-new` with no confident
  ICD writes `primaryIcd = null` and the existing "Needs coding" UI flag
  handles it.
- **Org-level config toggles** (e.g., `caseRouterAutoAccept`) — Sprint
  0.17+.
- **Removing the hero card from Sprint 0.11.1** — it stays. With routing
  agentic, most visits won't use the *"Continue this case"* shortcut, but
  the visual hero treatment still helps browsing.

## Verify when done

- [ ] Starting a visit (chart sticky-header *"Start visit"* button)
      creates an encounter without requiring a case pick. The encounter's
      `caseManagementId` points to a `PENDING_ROUTER` case.
- [ ] After recording finishes and AI-generation completes, a
      `CaseRouterRun` row exists for the note, with a valid `proposalJson`
      matching the Zod schema. `confidence`, `reasoning`, `modelVersion`
      are populated.
- [ ] The review screen renders the *"✨ Miss Cleo's case routing"* panel
      at the top.
- [ ] Confirming the proposal rebinds (or promotes) the case atomically
      in a single transaction:
      - `attach` → `Encounter.caseManagementId` = chosen; pending case
        deleted.
      - `open-new` → pending case promoted to `ACTIVE` with the proposed
        ICDs.
      - `attach-with-secondary` → encounter rebinds + chosen case gains
        secondary ICD.
- [ ] *"Change manually"* opens the existing case picker; selecting there
      fires the accept endpoint with the override decision; audit logs
      `CASE_ROUTER_OVERRIDDEN`.
- [ ] Audit rows for `CASE_ROUTER_PROPOSED`, `CASE_ROUTER_ACCEPTED`, and
      (when applicable) `CASE_ROUTER_OVERRIDDEN` exist with the documented
      metadata. Every row carries `personaVersion: 'miss-cleo-v1'`.
- [ ] Stub mode (no Bedrock key) produces a synthetic LOW-confidence
      proposal so the review panel still renders end-to-end.
- [ ] Existing tests still pass. New tests above are added and pass.
- [ ] `npm run typecheck` clean. `npm run lint` clean on touched files.
- [ ] `npx prisma db seed` clean.
- [ ] Manual end-to-end on the dev server (Devon Mitchell on
      `seed-patient-medical`): Start visit → record briefly → finish →
      processing → review screen shows the routing panel → confirm →
      `Encounter.caseManagementId` reflects the chosen case →
      `CaseRouterRun.acceptedAction = 'accepted'`.
- [ ] Three-lens documented in PR body.

## Three-lens

- **Clinician** — one tap to start; record; one tap to confirm at review.
  Case management becomes invisible until it needs their attention.
  Override is always one tap. Recording flow stops fragmenting their
  attention with pre-recording case decisions.
- **Compliance** — every routing decision is captured end-to-end: the
  AI's structured proposal (with confidence + citational reasoning), the
  clinician's confirmation or override, the model version that produced
  the proposal, and the encounter's final case linkage. Reconstructable
  from `CaseRouterRun` + audit trail alone.
- **Auditor** — `CaseRouterRun` is the per-note source-of-truth for
  routing provenance; the three new audit actions are the per-event
  trail. A regulator can answer *"why is this note attached to this
  case?"* either way — from the run's proposal + decision, or from the
  audit event stream.

## Downstream impact

After this sprint, three later sprints become unblocked:

- **Sprint 0.14** — `MissCleoPatientState` projection. The case-router
  consumes it when populated; until then operates on the per-call inputs
  it already has.
- **Sprint 0.15** — FHIR Phase D₁. Extends the agent's inputs to include
  `Condition.list(patientId)`; adds the `open-new-from-condition` action
  to the Zod schema (additive); the panel gains the *"EHR-verified"* pill.
  Schema change: `CaseManagement.mirrorsFhirConditionId` (already added
  here) gets populated.
- **Sprint 0.16** — FHIR Phase D₂ reconciliation. Adds the `reconcile`
  action + the conflict-banner UI on the same panel.

This sprint deliberately makes those future sprints *additive* — the
schema column is here, the JSON shape is extensible, the audit actions
generalize.
