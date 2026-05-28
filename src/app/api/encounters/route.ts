import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { canActAtSite, getClinicianSiteIds } from '@/lib/authz/site-scope';
import { checkClinicianSeat, seatRequiredResponse } from '@/lib/authz/seat';
import { checkVisitCapacity, visitCapacityRequiredResponse } from '@/lib/billing/capacity-gate';
import { writeAuditLog } from '@/lib/audit/log';
import { startVisit } from '@/lib/encounters/start';
import { DivisionResolutionError } from '@/lib/divisions/resolve';
import { CaseResolutionError } from '@/lib/case-management/resolve';
import { assertCaseIsOpen } from '@/lib/case-management/validate';
import { CaseDivisionDeniedError } from '@/lib/case-access';
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
  /**
   * Sprint 0.13 — optional. When omitted, the server auto-creates a
   * `PENDING_ROUTER` case and binds the encounter to it; Miss Cleo's
   * case-router worker proposes the destination at review time. When
   * supplied, this is the override path (e.g. the chart hero's
   * "Continue this case" button or the picker's manual override).
   */
  caseManagementId: z.string().min(1).optional(),
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

  // Seat gate — a clinician needs an assigned seat to record. Inert when
  // Stripe billing isn't configured; org admins bypass.
  const seatGate = await checkClinicianSeat(authorizationUser.orgUserId);
  if (!seatGate.ok) return seatRequiredResponse();

  const capacityGate = await checkVisitCapacity(authorizationUser.orgId, authorizationUser.orgUserId);
  if (!capacityGate.ok) return visitCapacityRequiredResponse(capacityGate.reason);

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

  // Sprint 0.13 — caseManagementId is optional. When provided (override path,
  // chart hero shortcut, etc.) we still validate it; when omitted, startVisit
  // auto-creates a PENDING_ROUTER case in the same tx.
  if (data.caseManagementId) {
    const caseRow = await prisma.caseManagement.findFirst({
      where: {
        id: data.caseManagementId,
        orgId: authorizationUser.orgId,
        patientId: patient.id,
      },
      select: { id: true, status: true },
    });
    if (!caseRow) {
      return NextResponse.json(
        { error: { code: 'case_not_found', message: 'Case management not found.' } },
        { status: 404 },
      );
    }
    try {
      assertCaseIsOpen(caseRow.status);
    } catch {
      return NextResponse.json(
        { error: { code: 'case_not_active', message: 'Case management is not active.' } },
        { status: 409 },
      );
    }
  }

  let result: { encounter: { id: string }; note: { id: string } };
  try {
    result = await prisma.$transaction(async (tx) =>
      startVisit({
        tx,
        orgId: authorizationUser.orgId,
        patientId: patient.id,
        clinicianOrgUserId: authorizationUser.orgUserId,
        siteId,
        roomId: data.roomId,
        departmentId: data.departmentId,
        caseManagementId: data.caseManagementId ?? null,
        episodeOfCareId: data.episodeOfCareId,
        actingUserId: user.id,
        pickerSource: data.pickerSource,
        dateOfService: lateEntry.dateOfService,
        isLateEntry: lateEntry.isLateEntry,
        lateEntryDaysGap: lateEntry.lateEntryDaysGap,
      }),
    );
  } catch (err) {
    if (err instanceof CaseResolutionError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 400 },
      );
    }
    if (err instanceof DivisionResolutionError) {
      return NextResponse.json(
        {
          error: {
            code: err.code,
            message:
              err.code === 'profession_other_blocked'
                ? 'Your profession is set to "Other" — please update it on your profile before recording.'
                : 'Could not derive a note division for this visit.',
          },
        },
        { status: 422 },
      );
    }
    if (err instanceof CaseDivisionDeniedError) {
      // Unit 49 — clinician attempted to attach a visit to a case in a
      // different division. Audit the blocked attempt (rule 8 — not
      // wrapped in swallowing try-catch) and return 403.
      await writeAuditLog({
        userId: user.id,
        orgId: authorizationUser.orgId,
        action: 'CASE_DIVISION_BLOCKED',
        resourceType: 'CaseManagement',
        resourceId: err.caseId,
        metadata: {
          caseId: err.caseId,
          clinicianDivision: err.clinicianDivision,
          caseDivision: err.caseDivision,
          route: 'encounters-start',
        },
      });
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Case belongs to a different division.' } },
        { status: 403 },
      );
    }
    throw err;
  }

  return NextResponse.json({
    data: { encounterId: result.encounter.id, noteId: result.note.id },
  });
}
