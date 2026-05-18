import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { diffForAudit } from '@/lib/audit/diff';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no_fields' });

const ROOM_FIELDS = ['name'] as const;

async function loadRoomScoped(
  id: string,
  orgId: string,
): Promise<{ room: Awaited<ReturnType<typeof prisma.room.findUnique>> | null; siteOrgId: string | null }> {
  const room = await prisma.room.findUnique({
    where: { id },
    include: { site: { select: { orgId: true } } },
  });
  if (!room || room.site.orgId !== orgId) return { room: null, siteOrgId: null };
  return { room, siteOrgId: room.site.orgId };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
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
  const { room: before, siteOrgId } = await loadRoomScoped(id, authorizationUser.orgId);
  if (!before || !siteOrgId) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(siteOrgId, authorizationUser.orgId);

  const after = await prisma.room.update({
    where: { id },
    data: { name: parsed.data.name ?? before.name },
  });

  const changes = diffForAudit(
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>,
    ROOM_FIELDS,
  );
  if (Object.keys(changes).length > 0) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'ROOM_UPDATED',
      resourceType: 'Room',
      resourceId: after.id,
      metadata: { siteId: after.siteId, changes },
    });
  }

  return NextResponse.json({ data: after });
}
