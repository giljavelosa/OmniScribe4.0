import type { Job } from 'bullmq';
import {
  Prisma,
  type FhirWriteBackFailureKind,
  type FhirWriteBackProposal,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { PERSONA_VERSION } from '@/services/copilot/persona';
import {
  createCondition,
  patchCondition,
  type FhirIdentitySnapshot,
  type CreateConditionResult,
  type PatchConditionResult,
} from '@/services/fhir/patient-client';
import type {
  FhirCreateConditionPayload,
  JsonPatchOp,
} from '@/services/fhir/case-writeback';

type FhirWriteBackJob = {
  proposalId: string;
};

/**
 * Sprint 0.17 — FHIR Phase D₃ write-back BullMQ worker.
 *
 * Pulls a `FhirWriteBackProposal` row (created by the accept endpoint,
 * approved by the clinician), executes the CREATE or PATCH against the
 * org's verified FHIR endpoint, and transitions the row to a terminal
 * state.
 *
 * Anti-regression rule 8: every status transition pairs with an audit
 * row. SUCCEEDED / FAILED / CANCELLED audits live OUTSIDE the
 * swallowing try-catch — the FHIR client returns `{ ok: false }`
 * rather than throwing for HTTP-level failures, so the handler's
 * audit calls are unconditionally reachable on the failure paths.
 *
 * Anti-regression rule 10: only TRANSIENT failures throw so BullMQ
 * retries (3 attempts × exponential backoff). PERMANENT (401/403/422)
 * and CONFLICT (412) failures complete the job without a retry — the
 * UI surfaces them as "blocked — review" / "EHR moved — propose
 * afresh". Burning the retry budget on a permanent auth failure
 * floods the audit log and never recovers.
 *
 * Anti-regression rule 20: the org's `writebackEnabled` flag is
 * re-checked at job pickup (the admin may have flipped the toggle
 * between approve and worker pickup). If disabled, the proposal is
 * CANCELLED + audited; no FHIR write fires.
 *
 * Decision 11 (back-fill mirror): a successful CREATE stamps the
 * returned FHIR id onto `CaseManagement.mirrorsFhirConditionId`. The
 * update + the status flip happen in a single `$transaction` so the
 * OS state never claims a SUCCEEDED write without the link row to
 * support it (Sprint 0.16 drift detection depends on this).
 *
 * Idempotency: the BullMQ jobId is `writeback:{proposalId}` (queue.ts)
 * so re-enqueue collapses to one Redis entry. The
 * `idempotencyKey` column is unique at the DB level. The FHIR call
 * sends it as `X-Request-Id` for vendor-side dedup where supported
 * (Epic / Cerner honor it).
 */
export async function handle(job: Job<FhirWriteBackJob>) {
  const { proposalId } = job.data;

  const proposal = await prisma.fhirWriteBackProposal.findUnique({
    where: { id: proposalId },
  });
  if (!proposal) {
    // The approve endpoint enqueued for an id that no longer exists.
    // Drop silently — no audit row because no proposal id to anchor
    // it to (the AuditLog resourceId is required on this action).
    console.warn(`[fhir-writeback] proposal ${proposalId} not found — dropping`);
    return { skipped: 'not_found' };
  }

  // The clinician may have cancelled (or the worker already finished
  // a prior attempt) — re-enqueue races collapse here.
  if (proposal.status !== 'APPROVED') {
    return { skipped: 'not_approved', status: proposal.status };
  }

  // Defense in depth: re-check the org-level toggle (the admin may
  // have flipped writebackEnabled to false between approve + pickup).
  // The org-settings disable path ALSO batch-cancels proposals, so
  // this branch is rare — but the data race is real and the cost of
  // a wrong write to the EHR is too high.
  const conn = await prisma.orgEhrConnection.findFirst({
    where: { orgId: proposal.orgId, enabled: true },
    select: { writebackEnabled: true },
  });
  if (!conn?.writebackEnabled) {
    await prisma.fhirWriteBackProposal.update({
      where: { id: proposal.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        failureMessage: 'org_writeback_disabled',
      },
    });
    await writeAuditLog({
      orgId: proposal.orgId,
      action: 'FHIR_WRITEBACK_CANCELLED',
      resourceType: 'FhirWriteBackProposal',
      resourceId: proposal.id,
      metadata: {
        proposalId: proposal.id,
        cancelReason: 'worker_recheck',
        personaVersion: PERSONA_VERSION,
      },
    });
    return { cancelled: 'org_writeback_disabled' };
  }

  // Mark EXECUTING before the upstream call so a worker crash leaves
  // the row in a recoverable state — the next worker pickup observes
  // EXECUTING and can no-op (we don't re-attempt EXECUTING from
  // within the handler; BullMQ's retry policy handles that side).
  await prisma.fhirWriteBackProposal.update({
    where: { id: proposal.id },
    data: { status: 'EXECUTING', executingAt: new Date() },
  });

  // Resolve the FHIR identity snapshot the patient-client needs. The
  // worker uses an admin-context identity scoped to the org (the
  // approving clinician isn't necessarily on shift when the worker
  // fires); for v1 we pick any active `FhirIdentity` row for the org
  // and the connection's ehrSystem. Multi-EHR orgs ride on the
  // ehrSystem indirection here.
  const identitySnapshot = await loadFhirIdentitySnapshot(proposal.orgId);
  if (!identitySnapshot) {
    // No usable identity — categorically permanent. Org admin needs
    // to (re)connect the EHR. We audit + fail-closed without a retry.
    await markFailed(proposal, {
      failureKind: 'PERMANENT',
      status: 0,
      message: 'no_active_fhir_identity',
    });
    return { failed: 'no_active_fhir_identity' };
  }

  const result = proposal.operation === 'CREATE'
    ? await createCondition({
        identity: identitySnapshot,
        payload: proposal.payloadJson as unknown as FhirCreateConditionPayload,
        requestId: proposal.idempotencyKey,
      })
    : await patchCondition({
        identity: identitySnapshot,
        fhirConditionId: proposal.fhirConditionId!,
        jsonPatch: proposal.payloadJson as unknown as JsonPatchOp[],
        ifMatchVersion: proposal.ifMatchVersion ?? '',
        requestId: proposal.idempotencyKey,
      });

  if (result.ok) {
    await markSucceeded(proposal, result);
    return { ok: true, fhirId: result.fhirId, versionId: result.versionId };
  }

  await markFailed(proposal, {
    failureKind: result.failureKind,
    status: result.status,
    message: result.message,
  });

  // Only TRANSIENT failures throw so BullMQ retries (rule 10).
  // PERMANENT + CONFLICT complete the job without burning the retry
  // budget — the UI offers explicit Cancel + Open new proposal paths.
  if (result.failureKind === 'TRANSIENT') {
    throw new Error(`fhir-writeback-transient: ${result.message}`);
  }
  return {
    failed: 'permanent_or_conflict',
    failureKind: result.failureKind,
  };
}

// =============================================================================
// Helpers — kept private to this file.
// =============================================================================

async function markSucceeded(
  proposal: FhirWriteBackProposal,
  result: CreateConditionResult | PatchConditionResult,
): Promise<void> {
  if (!result.ok) return; // type-narrow

  // For CREATE: stamp the EHR id onto the OS case so Sprint 0.16's
  // drift detection picks it up next routing run (decision 11). The
  // update + the status flip happen in one tx — never a SUCCEEDED
  // row that doesn't already have its mirror back-fill.
  const writes: Prisma.PrismaPromise<unknown>[] = [
    prisma.fhirWriteBackProposal.update({
      where: { id: proposal.id },
      data: {
        status: 'SUCCEEDED',
        succeededAt: new Date(),
        resultFhirId: result.fhirId || proposal.fhirConditionId,
        resultFhirVersion: result.versionId,
      },
    }),
  ];
  if (proposal.operation === 'CREATE' && result.fhirId) {
    writes.push(
      prisma.caseManagement.update({
        where: { id: proposal.caseManagementId },
        data: { mirrorsFhirConditionId: result.fhirId },
      }),
    );
  }
  await prisma.$transaction(writes);

  // Rule 8: audit is OUTSIDE any swallowing try-catch.
  await writeAuditLog({
    orgId: proposal.orgId,
    action: 'FHIR_WRITEBACK_SUCCEEDED',
    resourceType: 'FhirWriteBackProposal',
    resourceId: proposal.id,
    metadata: {
      proposalId: proposal.id,
      caseManagementId: proposal.caseManagementId,
      operation: proposal.operation,
      resultFhirId: result.fhirId || proposal.fhirConditionId,
      resultFhirVersion: result.versionId,
      personaVersion: PERSONA_VERSION,
    },
  });
}

async function markFailed(
  proposal: FhirWriteBackProposal,
  failure: { failureKind: FhirWriteBackFailureKind; status: number; message: string },
): Promise<void> {
  await prisma.fhirWriteBackProposal.update({
    where: { id: proposal.id },
    data: {
      status: 'FAILED',
      failedAt: new Date(),
      failureKind: failure.failureKind,
      failureMessage: failure.message.slice(0, 800),
      failureCount: { increment: 1 },
    },
  });
  await writeAuditLog({
    orgId: proposal.orgId,
    action: 'FHIR_WRITEBACK_FAILED',
    resourceType: 'FhirWriteBackProposal',
    resourceId: proposal.id,
    metadata: {
      proposalId: proposal.id,
      caseManagementId: proposal.caseManagementId,
      operation: proposal.operation,
      failureKind: failure.failureKind,
      status: failure.status,
      failureCount: proposal.failureCount + 1,
      personaVersion: PERSONA_VERSION,
    },
  });
}

/**
 * Resolve an active `FhirIdentity` for the org's enabled FHIR
 * connection. We pick any active token (the worker isn't acting as a
 * specific clinician — write-back is an org-scoped operation in v1).
 * Returns null when no usable identity exists — caller maps to a
 * PERMANENT failure (the org admin needs to (re)connect the EHR).
 */
async function loadFhirIdentitySnapshot(
  orgId: string,
): Promise<FhirIdentitySnapshot | null> {
  const conn = await prisma.orgEhrConnection.findFirst({
    where: { orgId, enabled: true },
    select: { ehrSystem: true },
  });
  if (!conn) return null;
  const identity = await prisma.fhirIdentity.findFirst({
    where: { orgId, ehrSystem: conn.ehrSystem },
    orderBy: { refreshedAt: 'desc' },
  });
  if (!identity) return null;
  return {
    id: identity.id,
    fhirBaseUrl: identity.fhirBaseUrl,
    ehrSystem: identity.ehrSystem,
    accessTokenEnc: identity.accessTokenEnc,
    refreshTokenEnc: identity.refreshTokenEnc,
    expiresAt: identity.expiresAt,
    scope: identity.scope,
  };
}
