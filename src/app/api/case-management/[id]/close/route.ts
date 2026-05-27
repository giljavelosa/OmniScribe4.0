import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CaseManagementStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { singleFieldChange } from '@/lib/audit/diff';
import { assertOrgScoped } from '@/lib/phi-access';
import { assertCanContinueCase, CaseDivisionDeniedError } from '@/lib/case-access';

export const runtime = 'nodejs';

const bodySchema = z.object({
  closeReason: z.string().max(500).optional().nullable(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const existing = await prisma.caseManagement.findFirst({
    where: { id, orgId: authorizationUser.orgId },
  });
  if (!existing) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(existing.orgId, authorizationUser.orgId);

  // Unit 49 — division gate on close. Closing is a write mutation, so
  // only same-division (or MULTI) clinicians may perform it.
  try {
    assertCanContinueCase(existing, authorizationUser);
  } catch (err) {
    if (err instanceof CaseDivisionDeniedError) {
      await writeAuditLog({
        userId: user.id,
        orgId: authorizationUser.orgId,
        action: 'CASE_DIVISION_BLOCKED',
        resourceType: 'CaseManagement',
        resourceId: err.caseId,
        metadata: {
          caseId: err.caseId,
          clinicianDivision: err.clinicianDivision,
          caseDivision: err.caseDivision,
          route: 'case-close',
        },
      });
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Case belongs to a different division.' } },
        { status: 403 },
      );
    }
    throw err;
  }

  if (existing.status === CaseManagementStatus.CANCELLED) {
    return NextResponse.json(
      { error: { code: 'cancelled', message: 'Case is cancelled.' } },
      { status: 409 },
    );
  }

  const updated = await prisma.caseManagement.update({
    where: { id },
    data: {
      status: CaseManagementStatus.CLOSED,
      closedAt: new Date(),
      closedByOrgUserId: authorizationUser.orgUserId,
      closeReason: parsed.data.closeReason?.trim() ?? null,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'CASE_MANAGEMENT_CLOSED',
    resourceType: 'CaseManagement',
    resourceId: id,
    metadata: {
      patientId: existing.patientId,
      changes: singleFieldChange('status', existing.status, CaseManagementStatus.CLOSED),
    },
  });

  return NextResponse.json({ data: updated });
}
