import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { canActAtSite, getClinicianSiteIds } from '@/lib/authz/site-scope';
import { startVisit } from '@/lib/encounters/start';

export const runtime = 'nodejs';

const bodySchema = z.object({
  patientId: z.string().min(1),
  siteId: z.string().optional(),
  roomId: z.string().optional(),
  departmentId: z.string().optional(),
  episodeOfCareId: z.string().optional(),
  /**
   * Where the episode link decision came from. Recorded in the
   * ENCOUNTER_CREATED audit metadata so the auditor lens can quantify how
   * often the picker actually fired vs. auto-link vs. clinician-skip.
   * Optional — omitted from legacy callers; defaults to 'unspecified' in
   * audit metadata.
   */
  pickerSource: z
    .enum(['picker', 'auto-single', 'auto-none', 'manual-skip', 'inherited-schedule'])
    .optional(),
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

  // Multi-site enrollment guard. For clinicians (and SITE_ADMIN / VIEWER) we
  // resolve the caller's site scope before picking the siteId. ORG_ADMIN+ get
  // scope 'all' implicitly and bypass below. If the caller has exactly one
  // enrolled site and no explicit siteId/patient.siteId hint, we auto-fall
  // back to that single enrollment — same UX the episode-picker uses for
  // single-episode patients.
  const siteScope = await getClinicianSiteIds(
    authorizationUser.orgUserId,
    authorizationUser.orgId,
  );

  let siteId = data.siteId ?? patient.siteId;
  if (!siteId && siteScope.scope === 'enrolled' && siteScope.siteIds.length === 1) {
    siteId = siteScope.siteIds[0]!;
  }
  if (!siteId) {
    return NextResponse.json(
      { error: { code: 'site_required', message: 'Patient has no default site; provide siteId.' } },
      { status: 400 },
    );
  }

  if (!canActAtSite(siteScope, siteId)) {
    return NextResponse.json(
      {
        error: {
          code: 'site_not_enrolled',
          message:
            'You are not enrolled at this site. Ask your admin to add you on the Team members page.',
        },
      },
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
      pickerSource: data.pickerSource,
    }),
  );

  return NextResponse.json({ data: { encounterId: encounter.id, noteId: note.id } });
}
