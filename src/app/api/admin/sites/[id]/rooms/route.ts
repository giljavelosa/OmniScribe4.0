import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().min(1).max(80),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const { id: siteId } = await params;
  const site = await prisma.site.findFirst({
    where: { id: siteId, orgId: authorizationUser.orgId },
    select: { id: true, orgId: true },
  });
  if (!site) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(site.orgId, authorizationUser.orgId);

  const rooms = await prisma.room.findMany({
    where: { siteId },
    orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
  });
  return NextResponse.json({ data: rooms });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id: siteId } = await params;
  const site = await prisma.site.findFirst({
    where: { id: siteId, orgId: authorizationUser.orgId },
    select: { id: true, orgId: true, isArchived: true, name: true },
  });
  if (!site) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(site.orgId, authorizationUser.orgId);
  if (site.isArchived) {
    return NextResponse.json(
      { error: { code: 'site_archived', message: 'Cannot add rooms to an archived site.' } },
      { status: 409 },
    );
  }

  const room = await prisma.room.create({
    data: {
      siteId,
      name: parsed.data.name,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'ROOM_CREATED',
    resourceType: 'Room',
    resourceId: room.id,
    metadata: { siteId, siteName: site.name, name: room.name },
  });

  return NextResponse.json({ data: room }, { status: 201 });
}
