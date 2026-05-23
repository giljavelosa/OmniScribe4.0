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
 * POST /api/cases/[id]/writeback/retry — Sprint 0.17.
 *
 * Re-attempts a FAILED proposal whose `failureKind = TRANSIENT`. The
 * row goes back to APPROVED and the worker job re-enqueues. PERMANENT
 * and CONFLICT failures CANNOT be retried — the response is 409 with
 * a hint to cancel + open a fresh proposal (decision 7 — retries are
 * for transients only).
 *
 * Counts as a clinician re-approval — we re-emit
 * `FHIR_WRITEBACK_APPROVED` so the audit trail shows the explicit
 * second click (the auditor lens can count "how often do clinicians
 * retry?" without scanning failure metadata).
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
      failureKind: true,
    },
  });
  if (!proposal || proposal.caseManagementId !== caseId) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(proposal.orgId, authorizationUser.orgId);

  if (proposal.status !== 'FAILED') {
    return NextResponse.json(
      { error: { code: 'invalid_state', status: proposal.status } },
      { status: 409 },
    );
  }
  if (proposal.failureKind !== 'TRANSIENT') {
    return NextResponse.json(
      {
        error: {
          code: 'not_retryable',
          failureKind: proposal.failureKind,
          hint: 'permanent_or_conflict_failures_require_a_fresh_proposal',
        },
      },
      { status: 409 },
    );
  }

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
      // Distinguish a retry from a first approve so the auditor lens
      // can count retry rates without scanning failure metadata.
      retry: true,
      personaVersion: PERSONA_VERSION,
    },
  });

  try {
    await enqueueFhirWriteback({ proposalId: proposal.id });
  } catch (e) {
    console.warn(
      '[cases/writeback/retry] enqueue failed:',
      e instanceof Error ? e.message : e,
    );
  }

  return NextResponse.json({ data: { ok: true, status: 'APPROVED' } });
}
