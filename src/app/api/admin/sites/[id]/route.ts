import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Division } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { diffForAudit } from '@/lib/audit/diff';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    address: z.string().max(280).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    primaryDivision: z.enum(Division).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no_fields' });

const SITE_FIELDS = ['name', 'address', 'phone', 'primaryDivision'] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const { id } = await params;
  const site = await prisma.site.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    include: {
      rooms: { orderBy: [{ isArchived: 'asc' }, { name: 'asc' }] },
      _count: { select: { patients: true, departments: true } },
    },
  });
  if (!site) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(site.orgId, authorizationUser.orgId);

  return NextResponse.json({ data: site });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const before = await prisma.site.findFirst({
    where: { id, orgId: authorizationUser.orgId },
  });
  if (!before) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(before.orgId, authorizationUser.orgId);

  const after = await prisma.site.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.address !== undefined ? { address: parsed.data.address } : {}),
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
      ...(parsed.data.primaryDivision !== undefined
        ? { primaryDivision: parsed.data.primaryDivision }
        : {}),
    },
  });

  const changes = diffForAudit(
    before as Record<string, unknown>,
    after as Record<string, unknown>,
    SITE_FIELDS,
  );
  if (Object.keys(changes).length > 0) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'SITE_UPDATED',
      resourceType: 'Site',
      resourceId: after.id,
      metadata: { changes },
    });
  }

  return NextResponse.json({ data: after });
}
