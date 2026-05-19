import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { canActAtSite, getClinicianSiteIds } from '@/lib/authz/site-scope';
import { startVisit } from '@/lib/encounters/start';
import {
  evaluateDateOfService,
  LATE_ENTRY_MAX_DAYS,
} from '@/lib/encounters/late-entry';

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
  /**
   * Late-entry charting (spec: context/specs/late-entry-charting.md).
   *
   * Optional ISO 8601 string. If unset OR same calendar day as today, the
   * note is created as a normal same-day visit. If backdated 1..30 days,
   * the new Note carries isLateEntry=true + lateEntryDaysGap. Anything
   * else (future date, >30 days back, unparseable) is rejected here so
   * downstream code can assume the value is already validated.
   */
  dateOfService: z.string().datetime().optional(),
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
    // Fall back to the first non-archived org site as a sensible default.
    // Multi-site orgs that need explicit per-visit choice should call the
    // endpoint with siteId; the UI picker (post #81) will do that going
    // forward. This fallback prevents "site_required" dead-ends when the
    // patient just hasn't been assigned a default yet.
    const site = await prisma.site.findFirst({
      where: { orgId: authorizationUser.orgId, archivedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (site) {
      siteId = site.id;
    } else {
      return NextResponse.json(
        { error: { code: 'site_required', message: 'No active sites in your organization. Create a site first.' } },
        { status: 400 },
      );
    }
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

  // Late-entry validation. We pre-compute here so startVisit() doesn't have to
  // re-derive (or re-validate) — it just persists the resolved values.
  let lateEntry: {
    dateOfService: Date | null;
    isLateEntry: boolean;
    lateEntryDaysGap: number | null;
  } = { dateOfService: null, isLateEntry: false, lateEntryDaysGap: null };
  if (data.dateOfService) {
    const evalRes = evaluateDateOfService({ iso: data.dateOfService, now: new Date() });
    if (!evalRes.ok) {
      if (evalRes.reason === 'future_date') {
        return NextResponse.json(
          {
            error: {
              code: 'date_of_service_future',
              message: 'Visit date cannot be in the future.',
            },
          },
          { status: 400 },
        );
      }
      if (evalRes.reason === 'too_far_back') {
        return NextResponse.json(
          {
            error: {
              code: 'date_of_service_too_old',
              message: `Visit date cannot be more than ${LATE_ENTRY_MAX_DAYS} days ago.`,
            },
          },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: { code: 'date_of_service_invalid', message: 'Visit date is invalid.' } },
        { status: 400 },
      );
    }
    lateEntry = {
      dateOfService: evalRes.dateOfService,
      isLateEntry: evalRes.isLateEntry,
      lateEntryDaysGap: evalRes.isLateEntry ? evalRes.lateEntryDaysGap : null,
    };
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
      dateOfService: lateEntry.dateOfService,
      isLateEntry: lateEntry.isLateEntry,
      lateEntryDaysGap: lateEntry.lateEntryDaysGap,
    }),
  );

  return NextResponse.json({ data: { encounterId: encounter.id, noteId: note.id } });
}
