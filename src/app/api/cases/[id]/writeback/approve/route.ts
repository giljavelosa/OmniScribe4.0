import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { enqueueFhirWriteback } from '@/lib/queue';
import { PERSONA_VERSION } from '@/services/copilot/persona';

export const runtime = 'nodejs';

/**
 * POST /api/cases/[id]/writeback/approve — Sprint 0.17.
 *
 * The clinician taps Confirm in the inline review-panel
 * `<AlertDialog>`. We flip the proposal from PROPOSED → APPROVED + emit
 * `FHIR_WRITEBACK_APPROVED` + enqueue the worker job.
 *
 * Idempotent (decision 2): repeated calls on a row that's already in
 * an in-flight or terminal state return 200 with the current status —
 * no second audit, no second enqueue. The unique BullMQ jobId
 * (`writeback:{proposalId}`) means a duplicate enqueue collapses to
 * the same Redis entry; same for the unique `idempotencyKey` at the
 * FHIR layer.
 *
 * Anti-regression rule 8: audit is OUTSIDE any swallowing try-catch.
 * A throw from `writeAuditLog` (e.g. PHI guard) surfaces as a 500 so
 * a regression doesn't silently land bad metadata.
 */

const bodySchema = z.object({
  proposalId: z.string().min(1).max(64),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_EDIT', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id: caseId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const proposal = await prisma.fhirWriteBackProposal.findUnique({
    where: { id: parsed.data.proposalId },
    select: {
      id: true,
      orgId: true,
      caseManagementId: true,
      status: true,
    },
  });
  if (!proposal || proposal.caseManagementId !== caseId) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(proposal.orgId, authorizationUser.orgId);

  // Idempotent — already moved past PROPOSED. We return 200 with the
  // current status so a duplicate click (e.g. double-tap) is a no-op
  // from the UI's perspective. No second audit, no second enqueue.
  if (
    proposal.status === 'APPROVED' ||
    proposal.status === 'EXECUTING' ||
    proposal.status === 'SUCCEEDED'
  ) {
    return NextResponse.json({ data: { ok: true, status: proposal.status } });
  }
  // FAILED / CANCELLED → can't re-approve. Cancel + propose afresh, or
  // use the /retry route for TRANSIENT failures.
  if (proposal.status !== 'PROPOSED') {
    return NextResponse.json(
      { error: { code: 'invalid_state', status: proposal.status } },
      { status: 409 },
    );
  }

  // PROPOSED → APPROVED. We don't bundle the audit inside the same tx
  // as the enqueue (BullMQ is out-of-band by definition); the audit
  // is unconditional + the enqueue follows with the same proposalId.
  await prisma.fhirWriteBackProposal.update({
    where: { id: proposal.id },
    data: {
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedByUserId: user.id,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: proposal.orgId,
    action: 'FHIR_WRITEBACK_APPROVED',
    resourceType: 'FhirWriteBackProposal',
    resourceId: proposal.id,
    metadata: {
      proposalId: proposal.id,
      caseManagementId: proposal.caseManagementId,
      personaVersion: PERSONA_VERSION,
    },
  });

  // Enqueue the worker. Wrapped so a Redis hiccup doesn't 500 the
  // approve — the row is already in APPROVED state; the next pickup
  // (manual re-enqueue or a follow-on event) will execute. Same
  // posture as the Sprint 0.14 cleo-state enqueue at the end of the
  // accept route.
  try {
    await enqueueFhirWriteback({ proposalId: proposal.id });
  } catch (e) {
    console.warn(
      '[cases/writeback/approve] enqueue failed:',
      e instanceof Error ? e.message : e,
    );
  }

  return NextResponse.json({ data: { ok: true, status: 'APPROVED' } });
}
