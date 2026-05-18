import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { ScheduleStatus, VisitType } from '@prisma/client';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    status: z.enum(ScheduleStatus).optional(),
    scheduledStart: z.string().optional(),
    scheduledEnd: z.string().optional(),
    visitType: z.enum(VisitType).optional(),
    roomId: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no_fields' });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('VISITS_CREATE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const { id } = await params;
  const before = await prisma.schedule.findFirst({
    where: { id, orgId: authorizationUser.orgId },
  });
  if (!before) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  const updateData: Record<string, unknown> = {};
  if (parsed.data.status) updateData.status = parsed.data.status;
  if (parsed.data.visitType) updateData.visitType = parsed.data.visitType;
  if (parsed.data.scheduledStart) updateData.scheduledStart = new Date(parsed.data.scheduledStart);
  if (parsed.data.scheduledEnd) updateData.scheduledEnd = new Date(parsed.data.scheduledEnd);
  if (parsed.data.roomId !== undefined) updateData.roomId = parsed.data.roomId;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

  await prisma.schedule.update({ where: { id }, data: updateData });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'SCHEDULE_UPDATED',
    resourceType: 'Schedule',
    resourceId: id,
    metadata: {
      changedFields: Object.keys(parsed.data),
      ...(parsed.data.status ? { statusFrom: before.status, statusTo: parsed.data.status } : {}),
    },
  });

  return NextResponse.json({ data: { ok: true } });
}
