import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Division } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  address: z.string().max(280).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  primaryDivision: z.enum(Division).nullable().optional(),
});

/**
 * GET /api/admin/sites — list sites for the current org.
 * POST /api/admin/sites — create a site (ORG_ADMIN or SUPER_ADMIN).
 *
 * Both gated by TEAM_MEMBERS_MANAGE (same posture as user-mgmt) — sites are
 * org structural data, not patient data, so the closest existing capability
 * gate is the team-management one. SITE_ADMIN can READ their own site via
 * site detail, but cannot create new sites at the org level.
 */
export async function GET() {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const sites = await prisma.site.findMany({
    where: { orgId: authorizationUser.orgId },
    orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { rooms: true } } },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'SITES_LIST_VIEWED',
    resourceType: 'Site',
    resourceId: 'list',
    metadata: { listScope: 'sites', count: sites.length },
  });

  return NextResponse.json({
    data: sites.map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      phone: s.phone,
      primaryDivision: s.primaryDivision,
      isArchived: s.isArchived,
      archivedAt: s.archivedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
      roomCount: s._count.rooms,
    })),
  });
}

export async function POST(req: Request) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const site = await prisma.site.create({
    data: {
      orgId: authorizationUser.orgId,
      name: parsed.data.name,
      address: parsed.data.address ?? null,
      phone: parsed.data.phone ?? null,
      primaryDivision: parsed.data.primaryDivision ?? null,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'SITE_CREATED',
    resourceType: 'Site',
    resourceId: site.id,
    metadata: {
      name: site.name,
      primaryDivision: site.primaryDivision,
      hasAddress: !!site.address,
      hasPhone: !!site.phone,
    },
  });

  assertOrgScoped(site.orgId, authorizationUser.orgId);
  return NextResponse.json({ data: site }, { status: 201 });
}
