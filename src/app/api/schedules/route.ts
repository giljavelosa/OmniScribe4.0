import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { VisitType } from '@prisma/client';

export const runtime = 'nodejs';

const createSchema = z.object({
  patientId: z.string().min(1),
  clinicianOrgUserId: z.string().min(1),
  siteId: z.string().min(1),
  roomId: z.string().optional(),
  visitType: z.enum(VisitType),
  scheduledStart: z.string().min(1),
  scheduledEnd: z.string().min(1),
  notes: z.string().optional(),
});

export async function GET(req: Request) {
  const guard = await requireFeatureAccess('VISITS_CREATE');
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const url = new URL(req.url);
  const dateStr = url.searchParams.get('date');
  const clinicianId = url.searchParams.get('clinicianId') ?? undefined;

  const where = {
    orgId: authorizationUser.orgId,
    ...(clinicianId ? { clinicianOrgUserId: clinicianId } : {}),
    ...(dateStr ? dateRange(dateStr) : {}),
  };

  const schedules = await prisma.schedule.findMany({
    where,
    orderBy: { scheduledStart: 'asc' },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
      encounter: { select: { id: true, status: true } },
    },
  });
  return NextResponse.json({ data: schedules });
}

export async function POST(req: Request) {
  const guard = await requireFeatureAccess('VISITS_CREATE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const data = parsed.data;
  const start = new Date(data.scheduledStart);
  const end = new Date(data.scheduledEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return NextResponse.json({ error: { code: 'bad_request', message: 'Invalid time range.' } }, { status: 400 });
  }

  // Patient must belong to the same org (defense in depth).
  const patient = await prisma.patient.findFirst({
    where: { id: data.patientId, orgId: authorizationUser.orgId, isDeleted: false },
  });
  if (!patient) return NextResponse.json({ error: { code: 'patient_not_found' } }, { status: 404 });

  const schedule = await prisma.schedule.create({
    data: {
      orgId: authorizationUser.orgId,
      patientId: data.patientId,
      clinicianOrgUserId: data.clinicianOrgUserId,
      siteId: data.siteId,
      roomId: data.roomId,
      visitType: data.visitType,
      scheduledStart: start,
      scheduledEnd: end,
      notes: data.notes,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'SCHEDULE_CREATED',
    resourceType: 'Schedule',
    resourceId: schedule.id,
    metadata: { visitType: data.visitType, durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000) },
  });

  return NextResponse.json({ data: { id: schedule.id } });
}

function dateRange(dateStr: string) {
  const dayStart = new Date(dateStr);
  if (Number.isNaN(dayStart.getTime())) return {};
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { scheduledStart: { gte: dayStart, lt: dayEnd } };
}
