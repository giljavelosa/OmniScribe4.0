import { NextResponse } from 'next/server';
import { z } from 'zod';
import { OrgRole, Division } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { diffForAudit } from '@/lib/audit/diff';

export const runtime = 'nodejs';

/** Roles assignable via this endpoint. Mirrors INVITABLE_ROLES on
 *  /api/admin/invites — ORG_ADMIN is intentionally excluded
 *  so an invited VIEWER cannot be promoted to admin via PATCH (which would
 *  defeat the invite-level whitelist). Those elevations only happen at
 *  org-provisioning time. */
const ASSIGNABLE_ROLES: OrgRole[] = [OrgRole.CLINICIAN, OrgRole.VIEWER, OrgRole.SITE_ADMIN];

const patchSchema = z
  .object({
    isActive: z.boolean().optional(),
    canManagePatients: z.boolean().optional(),
    role: z
      .enum(OrgRole)
      .refine((r) => ASSIGNABLE_ROLES.includes(r), {
        message: 'Only Clinician, Non-clinician, and Site admin roles can be assigned.',
      })
      .optional(),
    division: z.enum(Division).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no_fields' });

const ORG_USER_FIELDS = ['isActive', 'canManagePatients', 'role', 'division'] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const data = parsed.data;

  const { id: targetUserId } = await params;
  const before = await prisma.orgUser.findFirst({
    where: { userId: targetUserId, orgId: authorizationUser.orgId },
  });
  if (!before) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const after = await prisma.orgUser.update({
    where: { id: before.id },
    data: {
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.canManagePatients !== undefined
        ? { canManagePatients: data.canManagePatients }
        : {}),
      ...(data.role !== undefined ? { role: data.role } : {}),
      ...(data.division !== undefined ? { division: data.division } : {}),
    },
  });

  const changes = diffForAudit(
    before as Record<string, unknown>,
    after as Record<string, unknown>,
    ORG_USER_FIELDS,
  );

  if (data.isActive === false) {
    // Wipe sessions on deactivation so the user is signed out immediately.
    await prisma.userSession.deleteMany({ where: { userId: targetUserId } });
    await writeAuditLog({
      userId: targetUserId,
      orgId: orgUser.orgId,
      actingUserId: user.id,
      action: 'USER_DEACTIVATED',
      resourceType: 'OrgUser',
      resourceId: before.id,
      metadata: { changes },
    });
  } else if (Object.keys(changes).length > 0) {
    // Role change is a higher-severity event than a generic update; emit a
    // dedicated USER_ROLE_CHANGED row when role moved, in addition to the
    // standard USER_UPDATED.
    if (changes.role) {
      await writeAuditLog({
        userId: targetUserId,
        orgId: orgUser.orgId,
        actingUserId: user.id,
        action: 'USER_ROLE_CHANGED',
        resourceType: 'OrgUser',
        resourceId: before.id,
        metadata: { from: changes.role.before, to: changes.role.after },
      });
    }
    await writeAuditLog({
      userId: targetUserId,
      orgId: orgUser.orgId,
      actingUserId: user.id,
      action: 'USER_UPDATED',
      resourceType: 'OrgUser',
      resourceId: before.id,
      metadata: { changes },
    });
  }

  return NextResponse.json({ data: { ok: true } });
}
