import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { PERSONA_VERSION } from '@/services/copilot/persona';

export const runtime = 'nodejs';

/**
 * POST /api/cases/[id]/writeback/cancel — Sprint 0.17.
 *
 * Transitions PROPOSED or FAILED → CANCELLED. Cannot cancel EXECUTING
 * (the worker is mid-write — let it finish; SUCCEEDED is terminal,
 * CANCELLED is terminal). Returns 409 when the state machine refuses.
 *
 * `cancelReason: 'clinician'` distinguishes this path from the
 * worker's re-check-cancel (`worker_recheck`) and the org-toggle
 * batch cancel (`org_disabled`) in the audit metadata.
 *
 * Anti-regression rule 8: audit OUTSIDE any swallowing try-catch.
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

  // Idempotent — already cancelled.
  if (proposal.status === 'CANCELLED') {
    return NextResponse.json({ data: { ok: true, status: 'CANCELLED' } });
  }
  if (proposal.status !== 'PROPOSED' && proposal.status !== 'FAILED') {
    return NextResponse.json(
      { error: { code: 'invalid_state', status: proposal.status } },
      { status: 409 },
    );
  }

  await prisma.fhirWriteBackProposal.update({
    where: { id: proposal.id },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledByUserId: user.id,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: proposal.orgId,
    action: 'FHIR_WRITEBACK_CANCELLED',
    resourceType: 'FhirWriteBackProposal',
    resourceId: proposal.id,
    metadata: {
      proposalId: proposal.id,
      caseManagementId: proposal.caseManagementId,
      cancelReason: 'clinician',
      personaVersion: PERSONA_VERSION,
    },
  });

  return NextResponse.json({ data: { ok: true, status: 'CANCELLED' } });
}
