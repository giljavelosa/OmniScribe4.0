import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { startVisit } from '@/lib/encounters/start';

export const runtime = 'nodejs';

const bodySchema = z.object({
  patientId: z.string().min(1),
  siteId: z.string().optional(),
  roomId: z.string().optional(),
  departmentId: z.string().optional(),
  episodeOfCareId: z.string().optional(),
});

export async function POST(req: Request) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const data = parsed.data;

  const patient = await prisma.patient.findFirst({
    where: { id: data.patientId, orgId: authorizationUser.orgId, isDeleted: false },
    select: { id: true, siteId: true },
  });
  if (!patient) return NextResponse.json({ error: { code: 'patient_not_found' } }, { status: 404 });

  const siteId = data.siteId ?? patient.siteId;
  if (!siteId) {
    return NextResponse.json(
      { error: { code: 'site_required', message: 'Patient has no default site; provide siteId.' } },
      { status: 400 },
    );
  }

  const { encounter, note } = await prisma.$transaction(async (tx) =>
    startVisit({
      tx,
      orgId: authorizationUser.orgId,
      patientId: patient.id,
      clinicianOrgUserId: authorizationUser.orgUserId,
      siteId,
      roomId: data.roomId,
      departmentId: data.departmentId,
      episodeOfCareId: data.episodeOfCareId,
      actingUserId: user.id,
    }),
  );

  return NextResponse.json({ data: { encounterId: encounter.id, noteId: note.id } });
}
