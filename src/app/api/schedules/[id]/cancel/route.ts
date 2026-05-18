import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { ScheduleStatus } from '@prisma/client';

export const runtime = 'nodejs';

const bodySchema = z.object({ reason: z.string().min(1) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const { id } = await params;
  const schedule = await prisma.schedule.findFirst({ where: { id, orgId: authorizationUser.orgId } });
  if (!schedule) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  await prisma.schedule.update({ where: { id }, data: { status: ScheduleStatus.CANCELLED } });

  // Spec: do NOT cancel any associated Note (Notes have their own lifecycle).

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'SCHEDULE_CANCELLED',
    resourceType: 'Schedule',
    resourceId: id,
    metadata: { reason: parsed.data.reason, fromStatus: schedule.status },
  });

  return NextResponse.json({ data: { ok: true } });
}
