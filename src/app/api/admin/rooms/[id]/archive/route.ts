import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

const bodySchema = z.object({
  action: z.enum(['archive', 'unarchive']),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const room = await prisma.room.findUnique({
    where: { id },
    include: { site: { select: { orgId: true, name: true } } },
  });
  if (!room || room.site.orgId !== authorizationUser.orgId) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(room.site.orgId, authorizationUser.orgId);

  const archiving = parsed.data.action === 'archive';
  if (archiving === room.isArchived) {
    return NextResponse.json(
      { error: { code: archiving ? 'already_archived' : 'already_active' } },
      { status: 409 },
    );
  }

  const updated = await prisma.room.update({
    where: { id },
    data: { isArchived: archiving, archivedAt: archiving ? new Date() : null },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: archiving ? 'ROOM_ARCHIVED' : 'ROOM_UNARCHIVED',
    resourceType: 'Room',
    resourceId: updated.id,
    metadata: { siteId: room.siteId, siteName: room.site.name, name: updated.name },
  });

  return NextResponse.json({ data: updated });
}
