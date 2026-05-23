# Sprint 0.16: FHIR Phase D₂ — Case ↔ Condition reconciliation

> Miss Cleo detects when an OmniScribe `CaseManagement` and its mirrored
> FHIR `Condition` have drifted out of sync — status disagreement, ICD
> code change — and surfaces a structured **`reconcile`** proposal at
> the review screen. The clinician picks one of several explicit
> resolution paths (reopen, open-new, close, attach-as-is). Every drift
> is persisted to a new `CaseFhirDriftLog` table so longitudinal drift
> patterns become auditable.

## Context — read first

- `CLAUDE.md` — agent rules. Especially:
  - **Rule 20** — copilot reads only SIGNED/TRANSFERRED notes,
    confirmed FollowUps, and verified FHIR. Reconciliation is *read-and-
    surface*; the clinician's confirmation is the source of truth for
    every status change.
  - **Rule 24** — data only, no clinical recommendations. The agent
    SURFACES the drift with citational reasoning; it does NOT auto-
    resolve. The clinician chooses how the two systems reconcile.
  - **Rule 4** — `npx prisma db seed` after schema changes.
  - **Rule 8** — audit-log writes never wrapped in swallowing try-catch.
- `context/specs/sprint-0-case-router-agent.md` — Sprint 0.13.
  Established `CaseRouterRun` + the four prior actions (`attach`,
  `attach-with-secondary`, `open-new`, plus 0.15's
  `open-new-from-condition`).
- `context/specs/sprint-0-fhir-case-router.md` — Sprint 0.15. Populated
  `CaseManagement.mirrorsFhirConditionId` and wired the agent to read
  Condition lists. **Required before this sprint** — without
  `mirrorsFhirConditionId` populated, there is nothing to reconcile.
- `context/specs/sprint-0-cleo-persistent-memory.md` — Sprint 0.14.
  `MissCleoPatientState.observedPatternsJson` gains a new pattern kind
  `case_fhir_status_drift` populated by detections from this sprint.
- Existing FHIR client — `src/services/fhir/patient-client.ts` and
  `src/services/copilot/case-router-fhir.ts` (added in 0.15). This
  sprint reuses the same `Condition.list` call; no new FHIR fetcher.

## Files this sprint touches

Schema + migration:
- `prisma/schema.prisma` — new `CaseFhirDriftLog` model. Additive only.
- A new Prisma migration directory.

Agent + worker:
- `src/services/copilot/case-router.ts` — Zod schema gains `reconcile`
  action + `reconcileProposal` payload; system prompt gains drift-
  detection guidance.
- `src/services/copilot/case-router-fhir.ts` (from 0.15) — extend the
  fetched-Condition shape with `lastUpdated` (already there) plus a
  derived `driftSignals[]` computed against existing mirrored cases.
- `src/workers/case-router/handler.ts` — when the agent's input
  includes a mirrored case AND that case's mirror Condition has drifted,
  the worker writes a `CaseFhirDriftLog` row before calling the agent;
  the agent's proposal then references the log id.

Accept endpoint:
- `src/app/api/notes/[id]/case-router/accept/route.ts` — handle the
  `reconcile` action's chosen resolution option. Update
  `CaseFhirDriftLog.resolvedAt` / `resolvedAction` /
  `resolvedByUserId` atomically with the case mutation.

UI:
- `src/app/(clinical)/review/[noteId]/_components/case-routing-panel.tsx`
  — new amber **conflict banner** variant for the `reconcile` action;
  the resolution options render as a secondary radio set beneath the
  banner.
- New shared component: `case-fhir-drift-banner.tsx` (extracted for
  reuse in the Cases tab — see *Downstream impact*).

State (cross-cutting):
- `src/services/copilot/state-builder.ts` (from 0.14) — adds pattern
  `case_fhir_status_drift` to `observedPatternsJson` when a
  `CaseFhirDriftLog` exists and is unresolved.

Audit:
- `src/lib/audit/actions.ts` — append three new actions
  (`CASE_FHIR_DRIFT_DETECTED`, `CASE_ROUTER_RECONCILE_PROPOSED`,
  `CASE_FHIR_DRIFT_RESOLVED`).

## Goal

When the case-router runs against a FHIR-linked patient whose
`CaseManagement.mirrorsFhirConditionId` points at a Condition that has
*moved* (clinical status changed, ICD code updated), Miss Cleo proposes
a `reconcile` action explaining the drift and offering resolution
options. The clinician picks one in one tap; the case mutation and the
`CaseFhirDriftLog` resolution happen atomically; audit captures both.

Example (the canonical scenario):

```
┌──────────────────────────────────────────────────────────────────────┐
│ ✨ Miss Cleo's case routing  ·  confidence: MEDIUM                   │
│                                                                       │
│ ⚠ EHR ↔ OmniScribe drift detected                                    │
│                                                                       │
│ Your OmniScribe case M17.11 — Right knee OA — is ACTIVE with 11      │
│ recent visits. The matching EHR Condition was marked RESOLVED on     │
│ 2025-01-12 by Dr. Park. This visit's content describes pain and      │
│ stiffness returning — likely a recurrence.                            │
│                                                                       │
│ How would you like to reconcile?                                      │
│   ◉ Reopen the case as a recurrence  ·  (continue the same arc)      │
│   ○ Open a new case for M17.11        ·  (treat as a discrete episode)│
│   ○ Close the OmniScribe case         ·  (sync to EHR; route this     │
│                                            visit elsewhere)           │
│   ○ Attach to the case as-is          ·  (note the drift, don't      │
│                                            change either system)      │
│                                                                       │
│                                  [ Confirm and continue review ▸ ]   │
└──────────────────────────────────────────────────────────────────────┘
```

> **Ships when**: (1) the worker detects status drift on any mirrored
> case during a case-router run and writes a `CaseFhirDriftLog`; (2) the
> agent surfaces a `reconcile` proposal with structured resolution
> options when drift is present; (3) the review panel renders the
> amber conflict banner and resolution radios; (4) the clinician's
> choice atomically resolves the drift log + executes the case
> mutation; (5) `observedPatternsJson` carries unresolved drifts as a
> new pattern kind.

## Locked decisions

| # | Decision | Value |
|---|----------|-------|
| 1 | Drift types in Phase 1 | **Two only**: (a) `status` — `Condition.clinicalStatus` ≠ derived state from `CaseManagement.status`; (b) `icd` — `Condition.code` (latest coded) ≠ `CaseManagement.primaryIcd`. Other drifts (recorder change, onsetDate change) deferred. |
| 2 | When detection runs | Inside the case-router worker, **per mirrored case** that's in scope for routing. No background sweep yet — drift surfaces when a clinician records a visit on the patient. Background sweep is Sprint 0.18 (proactive nudges). |
| 3 | Auto-resolution | **Never.** Rule-24 line: the agent surfaces drift, the clinician resolves. No "if confidence > 95% just close the case" path. |
| 4 | Resolution options | Four for status drift: `reopen-case`, `open-new-case`, `close-case`, `attach-as-is`. Three for ICD drift: `update-case-icd`, `open-new-case`, `attach-as-is`. The agent picks 2-4 of these as the most clinically plausible for the specific drift; the clinician picks one. |
| 5 | Drift log persistence | Every detected drift writes a `CaseFhirDriftLog` row, **even if** the clinician picks `attach-as-is` (the drift was real; the clinician chose to defer reconciliation — both facts are reconstructable). |
| 6 | Reconcile vs. attach | When status drift is detected, the agent's TOP action becomes `reconcile`. `attach` is *moved into* the resolution options as `attach-as-is`. The agent never produces both `reconcile` and `attach` for the same case. |
| 7 | Confidence | A reconcile proposal's confidence is at most **MEDIUM** — the system has detected a fact (the drift) but the right resolution depends on clinical judgment. Confidence is NEVER `HIGH` for reconcile in this sprint. |
| 8 | UI tone | The banner is amber (`StatusBanner variant="warning"`), not red. Drift is a normal-cycle event, not a fault. |
| 9 | Scope (out) | FHIR write-back (Sprint 0.17). Cross-resource drift (Allergy, Medication). Background sweeps. Proactive nudges to the chart. |
| 10 | Backward compat | A patient with no mirrored cases → identical Sprint-0.15 behavior. The new action is impossible to surface without a `mirrorsFhirConditionId`. |

## Design

### Data model — additive

```prisma
model CaseFhirDriftLog {
  id                          String   @id @default(cuid())
  orgId                       String
  patientId                   String
  caseManagementId            String
  fhirConditionId             String

  driftKind                   CaseFhirDriftKind

  // Snapshot at detection — both sides, for reconstructability.
  caseStatusAtDetection       CaseManagementStatus
  caseIcdAtDetection          String?
  caseIcdLabelAtDetection     String?
  conditionStatusAtDetection  String       // FHIR clinicalStatus code
  conditionIcdAtDetection     String
  conditionIcdLabelAtDetection String

  detectedAt                  DateTime @default(now())
  detectedByRunId             String?  // FK to CaseRouterRun — null for
                                        // future background sweeps
                                        // (Sprint 0.18); for this sprint
                                        // always set.

  // Resolution — null until the clinician picks an option.
  resolvedAt                  DateTime?
  resolvedAction              String?  // 'reopen-case' | 'open-new-case' |
                                        // 'close-case' | 'attach-as-is' |
                                        // 'update-case-icd'
  resolvedByUserId            String?

  organization                Organization   @relation(fields: [orgId], references: [id])
  patient                     Patient        @relation(fields: [patientId], references: [id])
  caseManagement              CaseManagement @relation(fields: [caseManagementId], references: [id])
  detectedByRun               CaseRouterRun? @relation(fields: [detectedByRunId], references: [id])
  resolvedBy                  User?          @relation(fields: [resolvedByUserId], references: [id])

  @@index([orgId, patientId, resolvedAt])
  @@index([caseManagementId, resolvedAt])
  @@index([detectedAt])
}

enum CaseFhirDriftKind {
  STATUS
  ICD
}
```

`CaseFhirDriftKind` is a new enum (append-only by definition — first
introduction). Future drift kinds (e.g., `RECORDER`, `ONSET_DATE`)
append here.

### Drift detection — pure function

A new helper in `src/services/copilot/case-router-fhir.ts`:

```ts
export type DriftSignal = {
  kind: 'STATUS' | 'ICD';
  caseManagementId: string;
  fhirConditionId: string;
  caseStatus: CaseManagementStatus;
  caseIcd: string | null;
  caseIcdLabel: string | null;
  conditionStatus: string;          // active|recurrence|relapse|resolved|remission
  conditionIcd: string;
  conditionIcdLabel: string;
  recordedDate: string;
  recorderName: string | null;
};

export function detectDriftSignals(
  cases: CasePanelData[],            // already has mirrorsFhirConditionId
  fhirConditions: FhirConditionForRouter[],
): DriftSignal[];
```

Pure, deterministic, no side effects. Iterates mirrored cases; for each
finds the matching Condition; produces a signal per drift kind detected.
Easy to unit test exhaustively.

**Detection rules:**

| Case status | Condition clinicalStatus | Drift? | Kind |
|-------------|---------------------------|--------|------|
| ACTIVE | active / recurrence / relapse | no | — |
| ACTIVE | resolved / remission | **yes** | STATUS |
| CLOSED | active / recurrence / relapse | **yes** | STATUS |
| CLOSED | resolved / remission | no | — |
| CANCELLED | (any) | no | — |
| PENDING_ROUTER | (any) | no | — |

ICD drift: `case.primaryIcd != null && condition.icd != null &&
case.primaryIcd !== condition.icd`. The case's ICD code differs from
the latest coded Condition.

### Worker flow — additive

```
ai-generation complete → enqueueCaseRouterJob
                              ↓
                    case-router/handler.ts:
                      1. (existing) load Note + patient + cases.
                      2. (0.15) if FHIR enabled → fetchPatientConditions.
                      3. (NEW)  detectDriftSignals(cases, fhirConditions).
                         For each signal:
                           - INSERT a CaseFhirDriftLog row (resolvedAt=null).
                           - emit CASE_FHIR_DRIFT_DETECTED audit.
                      4. (existing) caseRouter.propose({
                           ..., fhirConditions, driftSignals
                         }).
                      5. (existing) persist CaseRouterRun.
                      6. (NEW)  if any drift signal AND the proposal
                         carries action='reconcile':
                           - emit CASE_ROUTER_RECONCILE_PROPOSED audit.
```

The drift log row is written **before** the agent runs — so the row
exists regardless of what the agent ultimately proposes. (If the agent
ignores a real drift, the audit row still flags it.) The agent's
proposal references the log row's id via `proposalJson.driftLogId`.

### Agent extension — additive

Zod schema additions:

```ts
export const CaseRouterProposalSchema = z.object({
  action: z.enum([
    'attach',
    'attach-with-secondary',
    'open-new',
    'open-new-from-condition',
    'reconcile',                    // NEW
  ]),
  // ... existing payload fields ...

  reconcileProposal: z.object({     // NEW — set only for action='reconcile'
    driftLogId: z.string(),
    caseManagementId: z.string(),
    fhirConditionId: z.string(),
    driftKind: z.enum(['STATUS', 'ICD']),
    summary: z.string(),             // 1-2 sentence human explanation
    resolutionOptions: z.array(z.object({
      kind: z.enum([
        'reopen-case',
        'open-new-case',
        'close-case',
        'attach-as-is',
        'update-case-icd',
      ]),
      label: z.string(),
      reasoning: z.string(),
    })).min(2).max(4),
    recommendedOptionIndex: z.number().int().min(0).optional(),
  }).optional(),
});
```

System prompt gains a focused drift-handling block (only included when
`driftSignals` is non-empty):

> *"This patient has a drift signal: their OmniScribe case
> `<caseManagementId>` and the mirrored FHIR Condition
> `<conditionId>` disagree on `<driftKind>`. The case shows
> `<caseStatus>/<caseIcd>`; the Condition shows
> `<conditionStatus>/<conditionIcd>`. When you see drift on a case
> that is otherwise the best match for this visit, your top action
> MUST be `reconcile`, not `attach`. Build `reconcileProposal` with
> 2-4 resolution options ranked by clinical plausibility. Confidence
> for reconcile is at most `medium`. Do NOT silently attach when
> drift is present — surface it."*

### Accept endpoint — new branch

`POST /api/notes/[id]/case-router/accept` gains a fifth handler:

```ts
case 'reconcile': {
  const { driftLogId, resolution } = decision;
  // resolution.kind is one of the resolution-options enum values
  await tx.$transaction(async (innerTx) => {
    // 1. Execute the chosen mutation
    switch (resolution.kind) {
      case 'reopen-case':
        await innerTx.caseManagement.update({
          where: { id: caseManagementId },
          data: { status: 'ACTIVE', reopenReason: resolution.note ?? 'EHR drift — recurrence' },
        });
        // Bind encounter to this case; delete pending case if any.
        break;
      case 'open-new-case':
        // Promote pending case (as in 'open-new' branch).
        break;
      case 'close-case':
        await innerTx.caseManagement.update({
          where: { id: caseManagementId },
          data: { status: 'CLOSED', closedAt: new Date(), closeReason: 'EHR-resolved' },
        });
        // Encounter rebinds elsewhere — clinician picks via override
        // path; UI ensures we don't leave the note orphaned.
        break;
      case 'attach-as-is':
        // Bind encounter to the drifted case; no status change.
        break;
      case 'update-case-icd':
        await innerTx.caseManagement.update({
          where: { id: caseManagementId },
          data: {
            primaryIcd: resolution.newIcd,
            primaryIcdLabel: resolution.newIcdLabel,
          },
        });
        // Bind encounter to this case.
        break;
    }
    // 2. Resolve the drift log row
    await innerTx.caseFhirDriftLog.update({
      where: { id: driftLogId },
      data: {
        resolvedAt: new Date(),
        resolvedAction: resolution.kind,
        resolvedByUserId: userId,
      },
    });
  });
  // 3. Audit (rule 8 — outside the tx, but never swallowed)
  await writeAuditLog({
    userId, orgId,
    action: 'CASE_FHIR_DRIFT_RESOLVED',
    resourceId: caseManagementId,
    metadata: {
      driftLogId, resolutionKind: resolution.kind, personaVersion: 'miss-cleo-v1',
    },
  });
  break;
}
```

### Review panel — conflict banner

The case-routing-panel renders the `reconcile` action as a distinct
section, ABOVE the standard resolution options:

```
─── normal proposal section (hidden when action='reconcile') ───
   ◉ Attach to existing case · M54.81 ...
   ○ Open a new case ...
   ○ Change manually …

─── reconcile section (shown when action='reconcile') ───────────
  ┌────────────────────────────────────────────────────────┐
  │ ⚠ EHR ↔ OmniScribe drift                                │
  │ <reconcileProposal.summary>                             │
  └────────────────────────────────────────────────────────┘

  How would you like to reconcile?
    ◉ <option[0].label>  ·  <option[0].reasoning>
    ○ <option[1].label>  ·  <option[1].reasoning>
    ○ <option[2].label>  ·  <option[2].reasoning>

                            [ Confirm and continue review ▸ ]
```

The `recommendedOptionIndex` pre-selects the agent's suggested
resolution (when present). The clinician can pick any of the 2-4
options. "Change manually…" stays available as a fallback to the
existing override path.

Pull this section into a reusable `case-fhir-drift-banner.tsx` so the
Cases tab can render the same banner on the patient chart for any
case with an unresolved drift log (the chart surface is Sprint 0.18's
proactive-nudge consumer; for this sprint we just provide the component).

### State-builder integration — additive

`src/services/copilot/state-builder.ts` extends `observedPatternsJson`
with a new pattern kind:

```ts
{
  kind: 'case_fhir_status_drift',
  caseManagementId: string,
  fhirConditionId: string,
  driftKind: 'STATUS' | 'ICD',
  detectedAt: string,
  driftLogId: string,
}
```

Populated for every `CaseFhirDriftLog` row where `resolvedAt IS NULL`
for the (patient × clinician) pair. Bump `generatorVersion` (e.g.
`'state-builder-v3'`) so existing rows re-build on the next event.

### Audit additions

Append-only to `AuditAction`:

| Action | When | Metadata (PHI-free) |
|--------|------|---------------------|
| `CASE_FHIR_DRIFT_DETECTED` | Worker writes a `CaseFhirDriftLog` row | `{ driftLogId, caseManagementId, fhirConditionId, driftKind, personaVersion }` |
| `CASE_ROUTER_RECONCILE_PROPOSED` | Worker's proposal has action='reconcile' | `{ caseRouterRunId, driftLogId, optionsCount, personaVersion }` |
| `CASE_FHIR_DRIFT_RESOLVED` | Accept endpoint resolved a drift log | `{ driftLogId, caseManagementId, resolutionKind, personaVersion }` |

All three carry `personaVersion: 'miss-cleo-v1'`.

## Implementation steps

1. **Schema migration** — add `CaseFhirDriftLog` + `CaseFhirDriftKind`
   enum. `npx prisma migrate dev --name sprint_0_16_fhir_reconciliation`.
   Reseed clean (rule 4).
2. **Drift detector** (`src/services/copilot/case-router-fhir.ts`):
   - `detectDriftSignals(cases, conditions)` — pure function.
   - Unit tests for the full detection-rules table above.
3. **Worker wiring** (`src/workers/case-router/handler.ts`):
   - Call detector after FHIR fetch (from 0.15).
   - For each signal: insert `CaseFhirDriftLog` + emit
     `CASE_FHIR_DRIFT_DETECTED`.
   - Pass `driftSignals` to agent inputs.
4. **Agent extension** (`src/services/copilot/case-router.ts`):
   - Zod schema: add `'reconcile'` action + `reconcileProposal`
     payload.
   - System prompt: add the drift-handling block (gated on
     `driftSignals.length > 0`).
5. **Accept endpoint** (`/api/notes/[id]/case-router/accept`):
   - Add the `reconcile` branch with the 5 resolution-kind handlers.
   - Atomic case mutation + drift-log resolution + audit (rule 8 —
     never swallow).
6. **Review panel**
   (`src/app/(clinical)/review/[noteId]/_components/case-routing-panel.tsx`):
   - Render the amber conflict banner variant when action='reconcile'.
   - Render the 2-4 resolution options as radios.
   - Pre-select `recommendedOptionIndex` when present.
7. **Reusable banner component**
   (`src/app/(clinical)/patients/[id]/_components/case-fhir-drift-banner.tsx`):
   - Extract the banner content so the Cases tab can render the same
     visual for unresolved drift logs.
8. **State-builder** (`src/services/copilot/state-builder.ts`):
   - Add `case_fhir_status_drift` pattern population from unresolved
     drift logs.
   - Bump `generatorVersion`.
9. **Audit actions** appended to `src/lib/audit/actions.ts`.
10. **Tests**:
    - `test/services/copilot/case-router-drift-detection.test.ts` —
      pure function over the rules table.
    - `test/workers/case-router-handler.test.ts` (extend) — drift
      detected → log row written + audit + agent input populated.
    - `test/services/copilot/case-router-agent.test.ts` (extend) — Zod
      validates `reconcile` + each resolution kind; system prompt
      includes the drift block only when signals are present.
    - `test/api/case-router-accept.test.ts` (extend) — each of the 5
      resolution kinds: case mutation + drift-log resolution +
      audit row.
    - `test/components/case-routing-panel.test.tsx` (extend) — amber
      banner renders for `reconcile`; resolution radios; pre-selection
      from `recommendedOptionIndex`.
11. **Verify** — see *Verify when done* below.

## Out of scope (deliberate)

- **FHIR write-back.** Sprint 0.17. When a clinician picks
  `close-case` in this sprint, the OmniScribe case closes but the FHIR
  Condition is NOT updated. Drift may technically still exist if the
  Condition flips back; the next routing run will surface it again.
- **Background drift sweep.** No nightly job in this sprint. Drift is
  detected only when the clinician records a visit on the patient.
  Sprint 0.18 (proactive nudges) adds the background sweep.
- **Cross-resource drift.** Conditions only. Allergy + Medication +
  Observation drift detection deferred.
- **Drift on PENDING_ROUTER or CANCELLED cases.** Skipped — those
  states aren't clinician-managed.
- **Recorder change / onset date change.** Two `CaseFhirDriftKind`
  values for now; future kinds append.
- **Multiple drifts on one case.** If a case has BOTH status and ICD
  drift, two `CaseFhirDriftLog` rows are written and the agent's
  proposal's `summary` mentions both, but the resolution options
  still resolve one driftLogId at a time. Phase 2 of this sprint could
  add multi-resolve UI.

## Verify when done

- [ ] `prisma migrate` applies clean; `prisma db seed` clean.
- [ ] On a FHIR-linked patient with a mirrored case whose Condition is
      `resolved` (and case is `ACTIVE`), the worker writes a
      `CaseFhirDriftLog` row with `driftKind='STATUS'` and emits
      `CASE_FHIR_DRIFT_DETECTED`.
- [ ] Miss Cleo's proposal carries `action='reconcile'` with 2-4
      ranked resolution options, and emits
      `CASE_ROUTER_RECONCILE_PROPOSED`.
- [ ] The review panel renders the amber drift banner with the
      agent's `summary` and the resolution radios. The
      `recommendedOptionIndex` is pre-selected when present.
- [ ] Confirming each resolution kind (`reopen-case`, `open-new-case`,
      `close-case`, `attach-as-is`, `update-case-icd`) executes the
      correct case mutation AND atomically marks the drift log
      resolved with the chosen action. `CASE_FHIR_DRIFT_RESOLVED`
      fires.
- [ ] On a non-mirrored case (no `mirrorsFhirConditionId`), drift
      detection is skipped — behavior identical to Sprint 0.15.
- [ ] On a FHIR-unhealthy run (FHIR fetcher emits
      `CASE_ROUTER_FHIR_UNAVAILABLE` from 0.15), drift detection is
      also skipped — no log rows written, no `reconcile` proposal.
- [ ] `MissCleoPatientState.observedPatternsJson` lists unresolved
      drift logs as the new `case_fhir_status_drift` kind. The
      "Cleo's read" card on the chart Overview surfaces the drift
      count.
- [ ] `npm run typecheck` clean. `npm run lint` clean on touched
      files. `npm test` clean.
- [ ] Three-lens in PR body.

## Three-lens

- **Clinician** — The system catches the EHR-vs-OmniScribe drift the
  clinician would otherwise miss, surfaces the *what* and the *when*,
  offers explicit clinical paths, and never makes the call for them.
  Reconciling becomes one tap with the right framing.
- **Compliance** — Every drift event is recorded in
  `CaseFhirDriftLog` with snapshots of both sides at detection
  time. The clinician's resolution is recorded alongside. Future
  audits can reconstruct *"why did this case close on this date?"*
  with a single join — drift detected, resolution chosen, mutation
  applied.
- **Auditor** — `CASE_FHIR_DRIFT_DETECTED` distinguishes
  *"system saw the drift"* from `CASE_FHIR_DRIFT_RESOLVED`
  *"clinician resolved it on a specific note's review"*. Open drifts
  (detected but unresolved) become a queryable cohort — useful for
  org-level data-quality monitoring.

## Downstream impact

- **Sprint 0.17 (FHIR Phase D₃ — write-back)** — adds the
  bidirectional half: when a clinician picks `close-case` or
  `update-case-icd` in *this* sprint's reconcile flow, an optional
  "Also update the EHR Condition?" sub-checkbox appears, mirroring
  the change back. Org-level policy gate `fhirWriteBackPolicy`.
- **Sprint 0.18 (proactive nudges)** — the Cases tab surfaces the
  reusable `case-fhir-drift-banner.tsx` on cards with unresolved
  drift logs. A background sweep job (small BullMQ cron) runs the
  detector periodically so drift surfaces even without a recording.
  `CASE_FHIR_DRIFT_DETECTED` audit rows get a non-null `detectedByRunId
  = null` path for sweep-detected events; the column already
  tolerates null (added in this sprint).
- **Future cross-resource drift** — same shape extends to
  `CaseFhirDriftKind` (append `ALLERGY`, `MEDICATION`); the
  reconciliation mechanics are identical. The data model lands now
  in a way that future kinds add additively without rewriting.
