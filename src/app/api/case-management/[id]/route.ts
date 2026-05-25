import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { singleFieldChange } from '@/lib/audit/diff';
import { assertOrgScoped } from '@/lib/phi-access';
import { assertCanContinueCase, CaseDivisionDeniedError } from '@/lib/case-access';

export const runtime = 'nodejs';

const patchSchema = z.object({
  primaryIcd: z.string().max(16).optional().nullable(),
  primaryIcdLabel: z.string().min(1).max(280).optional(),
  secondaryIcd: z.string().max(16).optional().nullable(),
  secondaryIcdLabel: z.string().max(280).optional().nullable(),
  description: z.string().max(120).optional().nullable(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
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

  // Unit 49 — division gate. Only same-division (or MULTI) clinicians may
  // edit case metadata.
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
          route: 'case-edit',
        },
      });
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Case belongs to a different division.' } },
        { status: 403 },
      );
    }
    throw err;
  }

  const data = parsed.data;
  const updated = await prisma.caseManagement.update({
    where: { id },
    data: {
      ...(data.primaryIcd !== undefined ? { primaryIcd: data.primaryIcd } : {}),
      ...(data.primaryIcdLabel !== undefined
        ? { primaryIcdLabel: data.primaryIcdLabel.trim() }
        : {}),
      ...(data.secondaryIcd !== undefined ? { secondaryIcd: data.secondaryIcd } : {}),
      ...(data.secondaryIcdLabel !== undefined
        ? { secondaryIcdLabel: data.secondaryIcdLabel?.trim() ?? null }
        : {}),
      ...(data.description !== undefined
        ? { description: data.description?.trim() ?? null }
        : {}),
    },
  });

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (data.primaryIcd !== undefined && data.primaryIcd !== existing.primaryIcd) {
    Object.assign(changes, singleFieldChange('primaryIcd', existing.primaryIcd, data.primaryIcd));
  }
  if (
    data.primaryIcdLabel !== undefined &&
    data.primaryIcdLabel.trim() !== existing.primaryIcdLabel
  ) {
    Object.assign(
      changes,
      singleFieldChange('primaryIcdLabel', existing.primaryIcdLabel, data.primaryIcdLabel.trim()),
    );
  }

  if (Object.keys(changes).length > 0) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'CASE_MANAGEMENT_UPDATED',
      resourceType: 'CaseManagement',
      resourceId: id,
      metadata: { patientId: existing.patientId, changes },
    });
  }

  return NextResponse.json({ data: updated });
}
