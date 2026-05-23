# Sprint 0.17: FHIR Phase D₃ — Case → Condition write-back

> The first sprint in which OmniScribe **mutates the EHR**. When a
> clinician opens a new coded case (Sprint 0.15's
> `open-new-from-condition` OR a plain Sprint 0.13 `open-new` with a
> later ICD pick) **or** resolves a Sprint 0.16 drift (status flip /
> ICD change), Miss Cleo proposes a matching FHIR `Condition` write —
> create-new or PATCH-existing — and surfaces it as an explicit
> opt-in panel on the review screen. The clinician approves each
> write individually; nothing is autonomous. Writes are executed by
> a dedicated BullMQ worker against the org's verified FHIR endpoint
> with idempotent request ids, full audit, and graceful failure
> handling (OS state is the source of truth — a failed EHR write
> never undoes the OS-side change).

## Context — read first

- `CLAUDE.md` — agent rules. The ones that matter most this sprint:
  - **Rule 20** — copilot reads only SIGNED/TRANSFERRED notes,
    confirmed FollowUps, and verified FHIR. This sprint extends
    rule 20's *write* side: writes target ONLY the verified FHIR
    endpoint linked via `OrgEhrConnection` + `PatientFhirIdentity`;
    the worker NEVER writes to a Condition the patient is not
    linked to.
  - **Rule 24** — data only, no clinical recommendations. The
    write-back is *proposed* by Cleo and *executed* by the clinician
    via explicit click. The agent NEVER auto-writes; it constructs
    the payload + cites the source (OS case ID + the resolution
    that triggered it) + waits for an `APPROVED` row.
  - **Rule 8** — audit-log writes never swallowed. Every write
    attempt (success or failure) writes a `FHIR_WRITEBACK_*` audit
    row outside the swallowing try-catch.
  - **Rule 10** — BullMQ jobs retry 3× exponential. The write-back
    worker uses the standard retry path for *transient* failures
    (5xx, network timeout) and fail-closed without retry for
    *permanent* failures (4xx auth, 409 version conflict).
  - **Rule 22** — `<AlertDialog>` not native `confirm()` on clinical
    surfaces. The write-back approval modal is an `<AlertDialog>`.
  - **Rule 23** — `<StatusBadge>` / `<StatusBanner>` for any status
    color (write-back queue badges).
- `context/specs/sprint-0-fhir-case-router.md` — Sprint 0.15.
  Established `OrgEhrConnection`, `PatientFhirIdentity`,
  `mirrorsFhirConditionId`, and the *read* direction of FHIR.
- `context/specs/sprint-0-fhir-reconciliation.md` — Sprint 0.16.
  Established `CaseFhirDriftLog` and the `reconcile` action. The
  drift-resolution branches in the accept endpoint are the primary
  hooks Sprint 0.17 extends.
- `context/specs/sprint-0-case-router-agent.md` — Sprint 0.13.
  Established `CaseRouterRun` + the four base actions (`attach`,
  `attach-with-secondary`, `open-new`, `open-new-from-condition`).
- Existing FHIR client — `src/services/fhir/patient-client.ts`. So
  far this client is **read-only** (`Patient.read`, `Condition.list`).
  This sprint adds the first write method: `Condition.create` and
  `Condition.patch`. Lives under the same auth + token-refresh
  wrapper.

## Files this sprint touches

Schema + migration:
- `prisma/schema.prisma` — new `FhirWriteBackProposal` model + new
  `FhirWriteBackStatus` and `FhirWriteBackOperation` enums. Additive
  only.
- A new Prisma migration directory:
  `prisma/migrations/<ts>_sprint_0_17_fhir_writeback/`.

FHIR client (write extension):
- `src/services/fhir/patient-client.ts` — new methods
  `createCondition(orgId, payload, requestId)` and
  `patchCondition(orgId, conditionId, jsonPatch, version, requestId)`.
  Both go through the same OAuth + token-refresh wrapper used by the
  read methods. Both honor a per-request `If-Match: <version>` header
  for the PATCH path (concurrency control) and an
  `X-Request-Id: <stable>` header for vendor-side idempotency where
  supported (Epic / Cerner both honor this; the fallback is OS-side
  dedup via the `idempotencyKey` column).

Write-back service:
- `src/services/fhir/case-writeback.ts` (NEW) — pure payload builders
  + a thin orchestration layer. Exports:
  - `buildCreateConditionPayload(case, patient, clinician)` — returns
    a FHIR R4 Condition resource (no IDs) ready to POST.
  - `buildPatchOperations(case, existingCondition, kind)` — returns
    a JSON Patch array for status flips and ICD updates.
  - `proposeWriteBack(input)` — pure function: takes a case + a
    trigger (`'open-new'` | `'drift-resolution'`) + the existing
    Condition (or null for create) and returns a structured
    `WriteBackProposal` object ready to insert into
    `FhirWriteBackProposal`.

Worker:
- `src/workers/fhir-writeback/handler.ts` (NEW) — BullMQ job handler.
  Reads `FhirWriteBackProposal.status = APPROVED`, executes the
  CREATE or PATCH, persists the returned FHIR id + version on the
  proposal, flips status to `SUCCEEDED` or `FAILED`, writes the
  matching audit row. Failure path includes a `failureKind`
  discriminator (`transient` / `permanent`) so the UI can suggest
  retry vs. cancel.
- `src/workers/index.ts` — register the new queue.
- `src/lib/queue.ts` — add `enqueueFhirWriteback(proposalId)` helper.

API:
- `src/app/api/cases/[id]/writeback/approve/route.ts` (NEW) — flips
  `FhirWriteBackProposal.status` from `PROPOSED` to `APPROVED`
  (atomic with audit row), enqueues the worker job. Idempotent —
  repeated calls on an already-approved proposal return 200 + the
  same enqueue result.
- `src/app/api/cases/[id]/writeback/cancel/route.ts` (NEW) — flips
  to `CANCELLED` if status is `PROPOSED` or `FAILED`. Cannot cancel
  `EXECUTING` or `SUCCEEDED` (409 + reason).
- `src/app/api/cases/[id]/writeback/retry/route.ts` (NEW) — for a
  `FAILED` proposal with `failureKind === 'transient'`, resets
  status to `APPROVED` and re-enqueues. Permanent failures cannot
  be retried (409 + a hint to cancel + open a new proposal).

Accept endpoint extension:
- `src/app/api/notes/[id]/case-router/accept/route.ts` — when the
  clinician confirms an `open-new` (Sprint 0.13) or
  `open-new-from-condition` (Sprint 0.15) action AND the org has
  write-back enabled AND the case ended up with a coded ICD, insert
  a `FhirWriteBackProposal` row in the same tx as the case mutation.
  When the clinician confirms a `reconcile` resolution that produced
  a status / ICD change AND the case is mirrored AND write-back is
  enabled, do the same. The proposal is inserted at `PROPOSED`
  status — it does NOT auto-approve.

UI surfaces:
- `src/app/(clinical)/review/[noteId]/_components/case-routing-panel.tsx`
  — after a successful confirm of any write-back-eligible action,
  render a new inline section "*Write to EHR?*" with a Yes / Not now
  pair. Selecting Yes opens an `<AlertDialog>` summarizing the
  payload + a final Confirm button.
- `src/app/(clinical)/patients/[id]/_components/cases-panel.tsx` —
  each case row gains a small write-back-status chip when there's a
  non-terminal proposal: `EHR sync pending` (`PROPOSED`),
  `EHR write queued` (`APPROVED` / `EXECUTING`),
  `EHR write failed — retry` (`FAILED` + `transient`),
  `EHR write blocked — review` (`FAILED` + `permanent`).
  `SUCCEEDED` is silent (already verified at the next read sync).
- New shared component: `src/components/fhir/writeback-status-chip.tsx`
  — `<StatusBadge>` wrapper, used by cases-panel + (later) the
  org-admin queue page.
- New shared component: `src/components/fhir/writeback-confirm-dialog.tsx`
  — `<AlertDialog>` with the payload summary + Confirm + Cancel.

Org-settings UI (master toggle):
- `src/app/(admin)/settings/ehr/_components/writeback-toggle.tsx`
  (NEW) — per-org master switch. Defaults OFF. Disabling cancels all
  `PROPOSED` and `APPROVED` proposals (transition to `CANCELLED`).
- The toggle stores its state on `OrgEhrConnection.writebackEnabled`
  (new column — see Schema).

State-builder (cross-cutting):
- `src/services/copilot/state-builder.ts` — no functional change
  for Sprint 0.17 (write-back state is not exposed to the agent;
  it's a system-of-record concern, not a clinical-reasoning input).
  Generator version stays `cleo-state-v3` from Sprint 0.16.

Audit:
- `src/lib/audit/actions.ts` — append five new actions
  (`FHIR_WRITEBACK_PROPOSED`, `FHIR_WRITEBACK_APPROVED`,
  `FHIR_WRITEBACK_SUCCEEDED`, `FHIR_WRITEBACK_FAILED`,
  `FHIR_WRITEBACK_CANCELLED`). All PHI-free metadata — the FHIR
  resource ID is an EHR-side identifier, not Safe Harbor PHI.

## Goal

Three flows ship in this sprint:

1. **Create-on-open** — Clinician confirms an `open-new` or
   `open-new-from-condition` action AND opts in to "Write to EHR" →
   a `FhirWriteBackProposal` for `CREATE` is queued → worker POSTs
   `Condition` to the FHIR server → the returned id is stored on the
   OS-side case as `mirrorsFhirConditionId` (the bidirectional link
   finally closes).

2. **Patch-on-status-change** — Clinician resolves a Sprint 0.16
   STATUS drift by closing the OS case → if the mirrored Condition
   is still `active`, propose a PATCH to flip `clinicalStatus` to
   `resolved` → clinician confirms → worker PATCHes the EHR.

3. **Patch-on-ICD-change** — Clinician resolves an ICD drift with
   `update-case-icd` → propose a PATCH on `Condition.code` →
   clinician confirms → worker PATCHes.

The OS-side mutation always happens FIRST (in the existing accept
endpoint's tx). The FHIR write is a follow-on, executed by the
worker, with the OS state as the source of truth. If the FHIR write
fails, the OS state is unaffected and the proposal moves to
`FAILED` for clinician review.

## Decisions

1. **Opt-in at three gates.** Write-back requires (a) org-level
   `OrgEhrConnection.writebackEnabled = true` (admin toggle), (b)
   per-write clinician explicit click in the review panel, (c) a
   confirmation `<AlertDialog>` with the payload summary. No single
   default-on path. **Rationale:** the first sprint that mutates
   the EHR — three explicit gates is appropriate friction.

2. **Idempotency via `idempotencyKey`.** Every proposal gets a
   stable random `idempotencyKey` (cuid2) at insertion time, sent
   as the `X-Request-Id` header on the FHIR write. If the worker
   crashes mid-write and BullMQ retries, the EHR sees the same key
   and (where supported) returns the same resource. Where not
   supported, the OS-side dedup on `idempotencyKey` prevents
   double-insertion of the proposal. **Rationale:** rule 10
   retries × an HTTP write must not double-mutate.

3. **Source of truth is OS.** The accept-endpoint tx commits the
   OS-side case mutation BEFORE inserting the `FhirWriteBackProposal`.
   The proposal sits at `PROPOSED` waiting for clinician approval.
   If the clinician approves but the FHIR write fails, the proposal
   moves to `FAILED`; the OS-side state is unchanged — the case is
   still ACTIVE / CLOSED / new-ICD'd as the clinician resolved.
   **Rationale:** EHR availability cannot block clinical workflow.

4. **No deletes.** Closing an OS case never DELETEs the Condition.
   We PATCH `clinicalStatus` from `active` → `resolved`. The history
   stays in the EHR. **Rationale:** clinical history is forever; OS
   doesn't get to erase EHR records.

5. **PATCH uses JSON Patch (RFC 6902).** Where the vendor supports
   `Content-Type: application/json-patch+json`, the worker sends a
   minimal patch (just `clinicalStatus` or just `code`). Vendors
   that don't support JSON Patch fall back to a full
   resource PUT (Epic supports JSON Patch since 2020; Cerner partial).
   `OrgEhrConnection.fhirCapabilities.supportsJsonPatch` (existing
   field from the F3 sync) gates this. **Rationale:** minimal
   patches reduce conflict surface; we already capability-check at
   sync time.

6. **`If-Match` for concurrency.** PATCH requests include
   `If-Match: W/"<version>"` where `version` is the
   `meta.versionId` from the cached Condition fetched at drift-
   detection time (Sprint 0.16). If the EHR returns 412
   `Precondition Failed`, the worker writes `FAILED` with
   `failureKind: 'conflict'` and surfaces "EHR was modified — open a
   new proposal to retry". **Rationale:** between Cleo's read and
   the clinician's approval, the EHR may have changed; we don't
   silently overwrite.

7. **Failure taxonomy.** Worker classifies failures into
   `{ transient | permanent | conflict }`. Transient = network
   timeout / 5xx / connection refused — UI offers Retry (which
   re-enqueues). Permanent = 401/403 (auth) / 422 (validation) — UI
   offers Cancel + Open new proposal (auth issues are surfaced to
   the org admin separately). Conflict = 412 (version) — UI surfaces
   the new state + offers to re-read + propose afresh. **Rationale:**
   rule 10 retries are for transients only; permanents must not
   burn the retry budget.

8. **Write-back never happens for `attach` / `attach-with-secondary`.**
   Those actions don't create a new clinical assertion in OS — they
   re-bind an encounter to an existing case. The mirrored Condition
   (if any) is already correct from a prior write. The write-back
   gate evaluates only `open-new` / `open-new-from-condition` /
   `reconcile-with-mutation`. **Rationale:** noise reduction; the
   only writes that should hit the EHR are the ones that genuinely
   change clinical state.

9. **No write-back for `attach-as-is` reconciliation.** When the
   clinician chooses to attach despite the drift (Sprint 0.16), the
   OS state moves to match the EHR — no EHR write needed. Only the
   four mutating resolutions (`reopen-case`, `close-case`,
   `open-new-case`, `update-case-icd`) gate write-back. **Rationale:**
   `attach-as-is` is "accept the drift" — the EHR is unchanged by
   definition.

10. **Backward compatibility.** When `writebackEnabled = false` (the
    default for every existing org), the accept endpoint's behavior
    is byte-identical to Sprint 0.16 — no proposal row inserted, no
    write-back UI section rendered, no audit emissions, no worker
    jobs enqueued. The new column defaults FALSE in the migration.
    Verified by a worker test + an accept-endpoint test.

11. **`mirrorsFhirConditionId` is back-filled on SUCCEEDED CREATE.**
    When the worker finishes a `CREATE` successfully, it stamps the
    returned FHIR id onto the OS case's `mirrorsFhirConditionId`.
    This means a Sprint-0.16 drift detection on the next routing run
    will work for cases born in OS that wrote back to the EHR.
    **Rationale:** the bidirectional link closes only after the
    write succeeds — until then, the case is OS-only and not yet
    eligible for drift detection.

12. **Persona version stamp persists.** Every audit row carries
    `personaVersion: 'miss-cleo-v1'` (Sprint 0.12 lineage). Write-
    back is presented in the UI as a Cleo-mediated action ("Cleo
    will write this to your EHR for you"), so the persona-version
    tag stays consistent with the routing / reconciliation pipeline.

## Schema migration

`prisma/schema.prisma` — additions only:

```prisma
enum FhirWriteBackOperation {
  CREATE  // POST a new Condition
  PATCH   // PATCH an existing Condition (status or ICD change)
}

enum FhirWriteBackStatus {
  PROPOSED   // Inserted by accept endpoint; awaiting clinician click
  APPROVED   // Clinician clicked Confirm; queued for worker
  EXECUTING  // Worker has picked up the job
  SUCCEEDED  // Worker wrote successfully; FHIR id stored
  FAILED     // Worker failed; failureKind set
  CANCELLED  // Clinician cancelled OR org-level toggle was flipped off
}

enum FhirWriteBackFailureKind {
  TRANSIENT  // Network / 5xx / timeout — retryable
  PERMANENT  // 401 / 403 / 422 — not retryable
  CONFLICT   // 412 (If-Match precondition) — not retryable; propose afresh
}

model FhirWriteBackProposal {
  id                String                   @id @default(cuid())
  orgId             String
  caseManagementId  String
  patientId         String
  proposedByUserId  String                   // Clinician who confirmed the case action
  // Trigger lineage:
  triggerKind       String                   // 'open-new' | 'open-new-from-condition' | 'reconcile-with-mutation'
  caseRouterRunId   String?                  // The routing run that surfaced the underlying action (nullable for back-fill scenarios)
  driftLogId        String?                  // The drift log resolved (only set for reconcile triggers)
  // Payload:
  operation         FhirWriteBackOperation
  fhirConditionId   String?                  // Null for CREATE; populated for PATCH
  payloadJson       Json                     // The Condition resource (CREATE) OR the JSON Patch array (PATCH)
  ifMatchVersion    String?                  // The `meta.versionId` captured at proposal time (PATCH only)
  idempotencyKey    String                   @unique
  // Status:
  status            FhirWriteBackStatus      @default(PROPOSED)
  proposedAt        DateTime                 @default(now())
  approvedAt        DateTime?
  approvedByUserId  String?
  executingAt       DateTime?
  succeededAt       DateTime?
  failedAt          DateTime?
  cancelledAt       DateTime?
  cancelledByUserId String?
  // Outcome (populated by worker):
  resultFhirId      String?                  // The id the EHR returned (CREATE) or echoed (PATCH)
  resultFhirVersion String?                  // The new versionId after a successful PATCH
  failureKind       FhirWriteBackFailureKind?
  failureMessage    String?                  // Sanitized — no PHI
  failureCount      Int                      @default(0)

  @@index([orgId, status])
  @@index([caseManagementId])
  @@index([patientId, status])
  @@index([proposedAt])
}
```

`OrgEhrConnection` extension:

```prisma
// Existing model — add:
writebackEnabled  Boolean  @default(false)
writebackEnabledAt DateTime?
writebackEnabledByUserId String?
```

Migration directory:
`prisma/migrations/20260524000000_sprint_0_17_fhir_writeback/migration.sql`.

`npx prisma db seed` must remain clean (rule 4). The seed fixtures
do NOT need to populate any `FhirWriteBackProposal` rows; an empty
table is the correct steady state.

## Service code

### `src/services/fhir/case-writeback.ts` (new)

Pure functions only. No DB calls. No HTTP. Returns plain data the
caller (the accept endpoint and the worker) wraps in Prisma /
fetch calls.

```ts
export type CaseWriteBackTrigger =
  | { kind: 'open-new'; caseRouterRunId: string }
  | { kind: 'open-new-from-condition'; caseRouterRunId: string }
  | {
      kind: 'reconcile-with-mutation';
      caseRouterRunId: string;
      driftLogId: string;
      resolution:
        | 'reopen-case'
        | 'close-case'
        | 'open-new-case'
        | 'update-case-icd';
    };

export interface BuildPayloadInput {
  case: {
    id: string;
    primaryIcd: string;
    primaryIcdLabel: string;
    status: 'ACTIVE' | 'CLOSED' | 'CANCELLED' | 'PENDING_ROUTER';
    mirrorsFhirConditionId: string | null;
  };
  patient: { id: string; fhirPatientId: string };
  clinician: { orgUserId: string; recorderRefDisplay: string };
  existingCondition: FhirConditionShape | null; // For PATCH; null for CREATE
  trigger: CaseWriteBackTrigger;
}

export function buildCreateConditionPayload(input: BuildPayloadInput): FhirCreateConditionPayload {
  // Builds a FHIR R4 Condition resource:
  //   resourceType, subject.reference, code (with `coding[].system =
  //   'http://hl7.org/fhir/sid/icd-10-cm'`, `.code`, `.display`),
  //   clinicalStatus (active/resolved per case.status), recorder
  //   (from clinician), recordedDate (now), meta.tag with an
  //   omniscribe-origin extension so the EHR-side resource is
  //   identifiable as OS-originated.
}

export function buildPatchOperations(input: BuildPayloadInput): JsonPatchOp[] {
  // Returns RFC 6902 JSON Patch:
  //   - For status flip: `[{ op: 'replace', path: '/clinicalStatus',
  //                          value: { coding: [{ system, code }] } }]`
  //   - For ICD update: `[{ op: 'replace', path: '/code',
  //                          value: { coding: [{ system, code, display }] } }]`
  //   - For combined: both ops in order.
  // Only fields that actually changed are included; no full-resource overwrite.
}

export function proposeWriteBack(input: BuildPayloadInput): {
  operation: 'CREATE' | 'PATCH';
  payloadJson: unknown;
  ifMatchVersion: string | null;
  idempotencyKey: string; // cuid2
} {
  // Decides CREATE vs PATCH from input.case.mirrorsFhirConditionId,
  // builds the payload via the two functions above, generates the
  // idempotencyKey. Returns the row-shaped data ready for Prisma create.
}
```

Unit tests live in
`test/services/fhir/case-writeback.test.ts` — 20+ cases:
- CREATE for `open-new` with ICD, ACTIVE → `clinicalStatus = active`
- CREATE includes `omniscribe-origin` extension
- CREATE rejects when `patient.fhirPatientId` is null (defense; the
  accept endpoint should already gate)
- PATCH status flip ACTIVE → CLOSED → JSON Patch length = 1
- PATCH ICD update → JSON Patch on `/code` only
- PATCH combined status + ICD (reconcile resolution that mutates
  both) → two ops in deterministic order
- `idempotencyKey` is unique per call (32-char cuid2 shape)
- All ICDs come from the OS case — no hallucination from FHIR-side
  data (defense in depth against rule 20 violations).

### `src/services/fhir/patient-client.ts` (extend)

Two new methods, same auth wrapper as the existing read methods:

```ts
async createCondition(
  orgId: string,
  payload: FhirCreateConditionPayload,
  options: { requestId: string },
): Promise<{ ok: true; fhirId: string; versionId: string } | { ok: false; failureKind: FailureKind; status: number; message: string }> {
  // POST {baseUrl}/Condition
  // Headers: Authorization, X-Request-Id, Content-Type: application/fhir+json
  // 201 → parse Location header → return id + versionId
  // 4xx → failureKind: 'permanent' (or 'conflict' for 412)
  // 5xx / network → failureKind: 'transient'
  // Returns NEVER throws — caller maps to FhirWriteBackFailureKind enum.
}

async patchCondition(
  orgId: string,
  fhirConditionId: string,
  jsonPatch: JsonPatchOp[],
  ifMatchVersion: string,
  options: { requestId: string },
): Promise<{ ok: true; versionId: string } | { ok: false; failureKind: FailureKind; status: number; message: string }> {
  // PATCH {baseUrl}/Condition/{id}
  // Headers: Authorization, X-Request-Id, If-Match: W/"{version}",
  //          Content-Type: application/json-patch+json
  // Returns the same shape as createCondition.
}
```

The "never throws" contract is important. Worker-level errors are
caught and converted to `failureKind`; the worker writes the
`FAILED` row and the audit log without going through a swallowing
try-catch (rule 8 satisfied).

## Worker

`src/workers/fhir-writeback/handler.ts` (new):

```ts
// Job payload: { proposalId: string }

export async function handle(job: Job<{ proposalId: string }>) {
  const proposal = await prisma.fhirWriteBackProposal.findUnique({
    where: { id: job.data.proposalId },
    include: { case: true, patient: true, /* … */ },
  });

  if (!proposal) {
    // Should never happen if approve enqueued correctly; log and drop.
    return;
  }

  if (proposal.status !== 'APPROVED') {
    // Cancelled between approve and job pickup; drop.
    return;
  }

  // Defense in depth: re-check the org-level toggle (admin may have
  // disabled writeback after this job was enqueued).
  const conn = await prisma.orgEhrConnection.findUnique({
    where: { orgId: proposal.orgId },
  });
  if (!conn?.writebackEnabled) {
    await prisma.fhirWriteBackProposal.update({
      where: { id: proposal.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), failureMessage: 'org_writeback_disabled' },
    });
    await writeAuditLog({
      action: 'FHIR_WRITEBACK_CANCELLED',
      // ...
    });
    return;
  }

  await prisma.fhirWriteBackProposal.update({
    where: { id: proposal.id },
    data: { status: 'EXECUTING', executingAt: new Date() },
  });

  const result = proposal.operation === 'CREATE'
    ? await fhirClient.createCondition(proposal.orgId, proposal.payloadJson as FhirCreateConditionPayload, { requestId: proposal.idempotencyKey })
    : await fhirClient.patchCondition(proposal.orgId, proposal.fhirConditionId!, proposal.payloadJson as JsonPatchOp[], proposal.ifMatchVersion!, { requestId: proposal.idempotencyKey });

  if (result.ok) {
    await prisma.$transaction([
      prisma.fhirWriteBackProposal.update({
        where: { id: proposal.id },
        data: {
          status: 'SUCCEEDED',
          succeededAt: new Date(),
          resultFhirId: result.fhirId ?? proposal.fhirConditionId,
          resultFhirVersion: result.versionId,
        },
      }),
      // For CREATE: back-fill the OS case with the new mirror id (decision 11).
      ...(proposal.operation === 'CREATE'
        ? [
            prisma.caseManagement.update({
              where: { id: proposal.caseManagementId },
              data: { mirrorsFhirConditionId: result.fhirId },
            }),
          ]
        : []),
    ]);
    await writeAuditLog({ action: 'FHIR_WRITEBACK_SUCCEEDED', /* … */ });
    return;
  }

  // Failure path — rule 8: audit OUTSIDE the swallowing try-catch.
  await prisma.fhirWriteBackProposal.update({
    where: { id: proposal.id },
    data: {
      status: 'FAILED',
      failedAt: new Date(),
      failureKind: result.failureKind,
      failureMessage: result.message,
      failureCount: { increment: 1 },
    },
  });
  await writeAuditLog({
    action: 'FHIR_WRITEBACK_FAILED',
    metadata: { proposalId: proposal.id, operation: proposal.operation, failureKind: result.failureKind, status: result.status, personaVersion: 'miss-cleo-v1' },
  });

  // Only TRANSIENT failures throw so BullMQ retries (rule 10).
  // PERMANENT and CONFLICT fail-closed without retry.
  if (result.failureKind === 'TRANSIENT') {
    throw new Error(`fhir-writeback-transient: ${result.message}`);
  }
}
```

Worker registration in `src/workers/index.ts`:

```ts
new Worker('fhir-writeback', async (job) => {
  await import('./fhir-writeback/handler').then(m => m.handle(job));
}, {
  connection: redis,
  concurrency: 2, // Conservative — EHR write QPS often gated by vendor
  // Default rule-10 retry: attempts: 3, backoff: { type: 'exponential', delay: 5_000 }
});
```

`src/lib/queue.ts` — new helper:

```ts
const fhirWritebackQueue = new Queue('fhir-writeback', defaultOptions);

export async function enqueueFhirWriteback(proposalId: string) {
  return fhirWritebackQueue.add(
    'writeback',
    { proposalId },
    {
      // Idempotent — re-enqueue on the same proposal collapses to the same job.
      jobId: `writeback:${proposalId}`,
    },
  );
}
```

Worker tests in `test/workers/fhir-writeback-handler.test.ts` (10+
cases):
- Happy path CREATE → SUCCEEDED + case.mirrorsFhirConditionId set
- Happy path PATCH status → SUCCEEDED + resultFhirVersion updated
- Happy path PATCH ICD → SUCCEEDED
- Org toggle off between approve and pickup → CANCELLED + audit
- Proposal already CANCELLED → drop silently (no audit, no FHIR call)
- TRANSIENT failure → FAILED + throws (BullMQ retries)
- PERMANENT failure (403) → FAILED + does NOT throw (no retry)
- CONFLICT failure (412) → FAILED + does NOT throw
- Audit row written for every terminal status (rule 8)
- `failureCount` increments on each retry attempt

## API endpoints

### `POST /api/cases/[id]/writeback/approve`

Body: `{ proposalId: string }`.

```ts
export async function POST(req, { params }) {
  const { user } = await requireFeatureAccess(/* … */);
  const { proposalId } = await req.json();

  const proposal = await prisma.fhirWriteBackProposal.findUnique({
    where: { id: proposalId },
  });
  if (!proposal || proposal.caseManagementId !== params.id) return notFound();

  // Idempotent — already approved returns 200 + the existing enqueue.
  if (proposal.status === 'APPROVED' || proposal.status === 'EXECUTING' || proposal.status === 'SUCCEEDED') {
    return Response.json({ ok: true, status: proposal.status });
  }
  if (proposal.status !== 'PROPOSED') {
    return Response.json({ ok: false, error: 'invalid_state', status: proposal.status }, { status: 409 });
  }

  await prisma.fhirWriteBackProposal.update({
    where: { id: proposal.id },
    data: { status: 'APPROVED', approvedAt: new Date(), approvedByUserId: user.id },
  });

  await writeAuditLog({ action: 'FHIR_WRITEBACK_APPROVED', /* … */ });
  await enqueueFhirWriteback(proposal.id);

  return Response.json({ ok: true });
}
```

Same shape for `cancel` and `retry`. Cancel transitions
`PROPOSED` / `FAILED` → `CANCELLED`. Retry transitions
`FAILED + transient` → `APPROVED` + re-enqueues. Both write audit
rows.

API tests in `test/api/case-writeback-approve.test.ts`,
`test/api/case-writeback-cancel.test.ts`,
`test/api/case-writeback-retry.test.ts`.

## Accept endpoint extension

`src/app/api/notes/[id]/case-router/accept/route.ts` — in each of
the four mutating branches that already exist (open-new,
open-new-from-condition, reconcile.reopen-case, reconcile.close-case,
reconcile.open-new-case, reconcile.update-case-icd), after the
existing case mutation tx, if (a)
`OrgEhrConnection.writebackEnabled` is true AND (b) the case has
coded ICD AND (c) for PATCH triggers, the case is already mirrored
(`mirrorsFhirConditionId IS NOT NULL`), construct a write-back
proposal via `proposeWriteBack` and insert the row in the SAME tx.

The proposal is inserted at `PROPOSED`. Audit row
`FHIR_WRITEBACK_PROPOSED` written inside the tx so it rolls back
together with the case mutation if anything throws.

The response body gains an optional `writeBackProposal` field:

```ts
{
  ok: true,
  caseId: '...',
  writeBackProposal: { // present only if a proposal was inserted
    id: 'wbp_...',
    operation: 'CREATE' | 'PATCH',
    summary: 'Will create a new Condition in your EHR with ICD F33.1' // human-readable, PHI-free
  } | null
}
```

The UI uses `writeBackProposal` (when present) to render the
"Write to EHR?" inline section. When the org has writeback
disabled or the action isn't eligible, the field is null and the
UI section is not rendered (backward compat — Sprint 0.16 behavior).

## UI

### Review panel inline section

After a confirm of any write-back-eligible action, the existing
"✓ Confirmed" success state grows a sibling section:

```
✓ Confirmed: Major depressive disorder (F33.1) is your active case.

────────────────────────────────────────────
  Cleo can also write this back to your EHR.

  [Preview] – opens AlertDialog with the FHIR Condition payload + ICD + status

  [Yes, write to EHR]   [Not now]
────────────────────────────────────────────
```

Pressing "Yes" opens the `<AlertDialog>`:

```
  Write Condition to your EHR?

  Cleo will create a new Condition resource in your EHR system
  with these details:

  · ICD-10-CM:    F33.1
  · Label:        Major depressive disorder, recurrent, moderate
  · Status:       active
  · Recorder:     Dr. Mitchell

  You can review the result in the EHR after the write completes
  (usually within a few seconds). If the write fails, the OS-side
  case is unaffected and you can retry from the patient's chart.

  [Confirm]   [Cancel]
```

`Confirm` POSTs to `/api/cases/[id]/writeback/approve`. UI flips
the section to a "EHR write queued" badge with a spinner. The
patient-chart cases-panel chip updates on the next poll
(SSR + revalidation pattern, same as existing chart data).

### Cases-panel chip

```tsx
{caseRow.writebackStatus && (
  <WritebackStatusChip status={caseRow.writebackStatus} failureKind={caseRow.writebackFailureKind} />
)}
```

`<WritebackStatusChip>` is a `<StatusBadge>` wrapper:
- `PROPOSED` → variant="neutral", text="EHR sync pending"
- `APPROVED` / `EXECUTING` → variant="info", text="EHR write queued"
- `FAILED` + `TRANSIENT` → variant="warning", text="EHR write failed — retry", clickable opens a small retry confirm
- `FAILED` + `PERMANENT` → variant="error", text="EHR write blocked — review", links to a detail drawer
- `SUCCEEDED` / `CANCELLED` → no chip rendered (terminal silent)

### Org-settings master toggle

`src/app/(admin)/settings/ehr/_components/writeback-toggle.tsx` —
on the existing EHR settings page (added in Sprint 0.15), append a
new section:

```
   ┌──────────────────────────────────────────────┐
   │ Write-back to EHR                           │
   │                                              │
   │ When enabled, clinicians can opt in to       │
   │ pushing case updates back to your EHR.       │
   │ Each write requires explicit clinician       │
   │ confirmation. Disabling here cancels all     │
   │ pending writes.                              │
   │                                              │
   │ [ Off  ●     ]                              │
   └──────────────────────────────────────────────┘
```

Toggling on writes
`writebackEnabled = true` + `writebackEnabledAt = now()` +
`writebackEnabledByUserId = adminUser.id` + audit
`ORG_EHR_WRITEBACK_ENABLED`. Toggling off does the inverse +
batches all `PROPOSED` / `APPROVED` proposals for that org to
`CANCELLED` + audit each as `FHIR_WRITEBACK_CANCELLED` with
`cancelReason: 'org_disabled'`.

## Audit

`src/lib/audit/actions.ts` — append:

```ts
FHIR_WRITEBACK_PROPOSED      // Per proposal row inserted by accept endpoint
FHIR_WRITEBACK_APPROVED      // Per approve API call
FHIR_WRITEBACK_SUCCEEDED     // Per worker success
FHIR_WRITEBACK_FAILED        // Per worker failure
FHIR_WRITEBACK_CANCELLED     // Per cancel (clinician OR org-disable OR worker-time check)
```

Plus `ORG_EHR_WRITEBACK_ENABLED` and `ORG_EHR_WRITEBACK_DISABLED`
on the org-settings toggle (these belong to the admin audit cohort;
distinct from clinician-facing FHIR_WRITEBACK_*).

All metadata is PHI-free:
- `caseManagementId` is an OS-side id
- `fhirConditionId` / `resultFhirId` are EHR-side ids
- `failureKind` is a categorical enum
- `failureMessage` is the sanitized HTTP error (the FHIR client must
  strip any PHI before persisting; specifically reject any body
  containing patient identifiers)
- `personaVersion: 'miss-cleo-v1'` on every row

## Backward compatibility (decision 10 — verified)

Default org state: `writebackEnabled = false`. With this flag off:
- Accept endpoint runs Sprint 0.16's exact code path (no proposal
  insert, no audit, no enqueue).
- Cases-panel renders no chip (no proposals exist to render).
- Worker registers but has no jobs (queue is idle).
- Org-settings page shows the toggle in the off position; no other
  visible change.

This is verified by:
- A new accept-endpoint test "skips write-back when writeback
  disabled" that asserts zero `FhirWriteBackProposal` rows and zero
  `FHIR_WRITEBACK_*` audit emissions.
- A new worker test "no jobs are scheduled when writeback disabled"
  (more of a smoke than a deep behavioral test).
- Snapshot of the Sprint 0.16 accept-endpoint test suite — every
  prior test continues to pass with zero modifications (the new
  proposal-insert branch is fully gated on the toggle).

## Verify when done

1. **Migration** — `prisma migrate` clean; `prisma db seed` clean.
2. **Schema** — `FhirWriteBackProposal` + new enums + new
   `OrgEhrConnection` columns present; rollback path tested.
3. **Service unit tests** — `case-writeback.test.ts` covers CREATE,
   PATCH-status, PATCH-ICD, PATCH-combined, idempotencyKey shape, and
   defense rejections (20+ cases).
4. **Worker tests** — happy path CREATE / PATCH / status flip;
   TRANSIENT / PERMANENT / CONFLICT failures; org-disabled mid-flight;
   cancelled-mid-flight; failureCount increments; audit on every
   terminal status (10+ cases).
5. **API tests** — approve / cancel / retry — idempotency (repeated
   approve OK), state-machine 409s, audit row per call (12+ cases).
6. **Accept endpoint tests** — proposal inserted on each of the four
   eligible triggers; NOT inserted on `attach` / `attach-with-
   secondary` / `attach-as-is`; NOT inserted when org has writeback
   off; rolled back on tx throw.
7. **UI smoke** — review panel renders the "Write to EHR?" section
   conditionally on `writeBackProposal` in the response; cases-panel
   chip renders by status; org-settings toggle round-trip
   (enable → disable cancels proposals).
8. **Manual on dev** — set `OrgEhrConnection.writebackEnabled = true`
   on the seed org. Confirm an `open-new-from-condition` proposal,
   approve, verify worker writes a Condition to the mock FHIR
   server, verify the OS case's `mirrorsFhirConditionId` is back-
   filled. Then resolve a Sprint 0.16 drift with `close-case`,
   approve the PATCH, verify the mock FHIR Condition flipped to
   `resolved`. Then induce a 5xx from the mock; verify retry; verify
   permanent 403 surfaces the right chip.
9. **Three-lens** in PR body.
10. **Lint + typecheck + npm test** — all clean.

## Three-lens

- **Clinician** — write-back is a *help*, not a *task*: one explicit
  click after confirming the case action, one confirmation modal
  with the payload, and Cleo handles the rest. When the write fails,
  the OS-side workflow is unaffected — the clinician can finish the
  visit, sign the note, and decide later whether to retry the EHR
  push. The chart's cases-panel surfaces the status without becoming
  a todo list.

- **Compliance** — every write-back is a five-row audit trail:
  PROPOSED (when the accept endpoint inserted it), APPROVED (when
  the clinician clicked), SUCCEEDED or FAILED (when the worker
  finished), CANCELLED if applicable. The chain reconstructs *"who
  wrote what to which EHR resource, and when"* with one join. The
  `omniscribe-origin` extension on the FHIR resource lets an
  external auditor identify which Conditions originated in OS
  versus the EHR's native pathway.

- **Auditor** — the failure taxonomy is preserved end-to-end:
  TRANSIENT failures are retryable and don't pollute the permanent-
  failure cohort; PERMANENT and CONFLICT failures are surfaced as
  distinct categorical signals so an org-admin querying "which
  writes need attention" gets a precise list. The `idempotencyKey`
  + `If-Match` pattern means we can prove that no double-write
  occurred even under worker retry — the EHR-side resource history
  shows one POST or one PATCH per proposal.

## Anti-regression rules respected

- **Rule 4** — `npx prisma db seed` verified clean post-migration.
- **Rule 8** — every `FHIR_WRITEBACK_*` audit row is written
  OUTSIDE the swallowing try-catch in the worker. The
  accept-endpoint's `FHIR_WRITEBACK_PROPOSED` is INSIDE the
  case-mutation tx so a throw rolls both back together (atomic).
- **Rule 10** — only TRANSIENT failures throw; PERMANENT and
  CONFLICT fail-closed without burning the retry budget.
- **Rule 20** — writes target ONLY the verified FHIR endpoint
  bound to a verified `PatientFhirIdentity`. The worker fetches
  `OrgEhrConnection` and asserts `writebackEnabled` + a current
  token before each write. No live HTTP outside the worker.
- **Rule 22** — the write-back approval is an `<AlertDialog>`,
  not a native `confirm()`.
- **Rule 23** — `<StatusBadge>` for write-back-status chips; no
  hardcoded colors.
- **Rule 24** — Cleo PROPOSES the payload; the clinician APPROVES
  each write individually. No autonomous writes. The agent's role
  is to construct the resource — not to decide whether to send it.

## Out of scope (deferred to a later sprint)

- **Bulk back-fill of OS-only legacy cases to the EHR.** This sprint
  ships only the two natural triggers (open-new + reconcile-with-
  mutation). A future "Push existing OS cases to EHR" admin action is
  reserved for the org-admin sprint.
- **Two-way patient demographic sync.** Out of scope; this sprint
  only touches Conditions.
- **MedicationStatement / AllergyIntolerance write-back.** This
  sprint scopes to Conditions because of the Sprint 0.15/0.16
  groundwork. Medication and allergy write-back are explicitly
  deferred to Sprint 0.19+.
- **EHR-side webhook receiver.** When the EHR mutates a Condition
  out of band, we currently rely on the F3 sync to discover the
  change at the next routing run (Sprint 0.16 drift detection
  catches it). A push-based webhook receiver is out of scope.
- **Vendor-specific quirks (Epic R4-vs-STU3 differences, Cerner's
  Condition.code preferences).** The vendor-config in
  `OrgEhrConnection.fhirCapabilities` should already disambiguate;
  vendor-specific payload tweaks live in the FHIR client, not in
  the case-writeback service.
