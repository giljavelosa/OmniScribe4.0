import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    isActive: z.boolean().optional(),
    canManagePatients: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no_fields' });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const data = parsed.data;

  const { id: targetUserId } = await params;
  const target = await prisma.orgUser.findFirst({
    where: { userId: targetUserId, orgId: authorizationUser.orgId },
  });
  if (!target) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const before = { isActive: target.isActive, canManagePatients: target.canManagePatients };

  await prisma.orgUser.update({
    where: { id: target.id },
    data: {
      isActive: data.isActive ?? target.isActive,
      canManagePatients: data.canManagePatients ?? target.canManagePatients,
    },
  });

  if (data.isActive === false) {
    // Wipe sessions on deactivation so the user is signed out immediately.
    await prisma.userSession.deleteMany({ where: { userId: targetUserId } });
    await writeAuditLog({
      userId: targetUserId,
      orgId: orgUser.orgId,
      actingUserId: user.id,
      action: 'USER_DEACTIVATED',
      resourceType: 'OrgUser',
      resourceId: target.id,
      metadata: { before, after: { ...before, isActive: false } },
    });
  } else {
    await writeAuditLog({
      userId: targetUserId,
      orgId: orgUser.orgId,
      actingUserId: user.id,
      action: 'USER_UPDATED',
      resourceType: 'OrgUser',
      resourceId: target.id,
      metadata: { before, after: { isActive: data.isActive ?? before.isActive, canManagePatients: data.canManagePatients ?? before.canManagePatients } },
    });
  }

  return NextResponse.json({ data: { ok: true } });
}
