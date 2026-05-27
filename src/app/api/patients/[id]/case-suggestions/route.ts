import { NextResponse } from 'next/server';
import {
  EncounterIntent,
  type Division,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { nominateCases, type NominatorCase } from '@/services/copilot/case-nominator';
import { isFeatureEnabled, FEATURE_FLAG_KEYS } from '@/lib/feature-flags';

export const runtime = 'nodejs';

/**
 * Unit 49 §F — GET /api/patients/[id]/case-suggestions
 *
 * Returns Cleo's nominated case (+ ranked alternatives) for a pending
 * start-visit. The dialog calls this after `/proposed-intent` and wears
 * a `<CaseSuggestionBadge>` on the nominee.
 *
 * Inputs:
 *   - patientId    (path)
 *   - intent       (query, optional) — pass the intent from
 *                  `/proposed-intent`; the nominator boosts cases whose
 *                  ICD prefix has affinity for the intent. Omitting it
 *                  falls back to clinician-aware recency only.
 *
 * Auth: VISITS_CREATE (same gate as `/proposed-intent` since both feed
 * the start-visit dialog).
 *
 * Feature flag gate: when `cleo.caseRule.v1` is OFF for the org, this
 * endpoint returns `{ data: { nominee: null, ranked: [], flagOff: true } }`
 * with HTTP 200 so the dialog can silently skip rendering the badge.
 * We choose 200 + flag-off marker (vs. 404) so the dialog can call the
 * endpoint unconditionally without branching its fetch logic on flag
 * state — keeps the client side dumb.
 *
 * Division filter: existing Unit 49 PR1 case loading already filters
 * cases to `division IN (viewer, MULTI)`; we replicate the same filter
 * here so the nominator never picks a case the clinician couldn't
 * actually attach a visit to.
 *
 * Always 200 — graceful degradation on any internal error returns
 * `{ nominee: null, ranked: [], error: 'fallback' }` so the dialog
 * keeps opening (visit start MUST NOT be blocked by Cleo latency).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { authorizationUser, orgUser } = guard;

  const { id: patientId } = await params;
  const url = new URL(req.url);
  const intentParam = url.searchParams.get('intent');
  const intent = parseIntent(intentParam);

  // Feature flag gate. Off → 200 with empty payload so the dialog
  // never branches on a 404.
  const flagOn = await isFeatureEnabled(authorizationUser.orgId, FEATURE_FLAG_KEYS.CLEO_CASE_RULE_V1);
  if (!flagOn) {
    return NextResponse.json({
      data: { nominee: null, ranked: [], flagOff: true },
    });
  }

  // Existence + org scope.
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, orgId: authorizationUser.orgId, isDeleted: false },
    select: { id: true, orgId: true },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  const viewerDivision: Division = orgUser.division ?? 'MULTI';

  try {
    const cases = await loadActiveCases({
      patientId,
      orgId: authorizationUser.orgId,
      viewerDivision,
      clinicianOrgUserId: orgUser.id,
    });

    const result = nominateCases({
      cases,
      viewerDivision,
      proposedIntent: intent,
    });

    return NextResponse.json({
      data: {
        nominee: result.nominee,
        ranked: result.ranked,
        intent,
        flagOff: false,
      },
    });
  } catch (err) {
    // Graceful degradation — visit start MUST NOT be blocked.
    console.warn(
      '[case-suggestions] nomination failed; returning empty payload:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({
      data: { nominee: null, ranked: [], intent, error: 'fallback' },
    });
  }
}

function parseIntent(raw: string | null): EncounterIntent | null {
  if (!raw) return null;
  if ((Object.values(EncounterIntent) as string[]).includes(raw)) {
    return raw as EncounterIntent;
  }
  return null;
}

/**
 * Load the patient's active cases with the recency signals the nominator
 * scores on. Mirrors the chart's loader so the dialog/chart/nominator
 * all rank the same set.
 *
 * Division filter is enforced server-side (rule 2 of Unit 49 PR1: a
 * REHAB clinician can never SEE cases belonging only to MEDICAL +
 * vice-versa, except for MULTI cases which any division can use).
 */
async function loadActiveCases(args: {
  patientId: string;
  orgId: string;
  viewerDivision: Division;
  clinicianOrgUserId: string;
}): Promise<NominatorCase[]> {
  // Visible divisions per Unit 49 PR1: the viewer's own + MULTI.
  const visibleDivisions: Division[] =
    args.viewerDivision === 'MULTI'
      ? (['REHAB', 'BEHAVIORAL_HEALTH', 'MEDICAL', 'MULTI'] as Division[])
      : ([args.viewerDivision, 'MULTI'] as Division[]);

  const rows = await prisma.caseManagement.findMany({
    where: {
      patientId: args.patientId,
      orgId: args.orgId,
      status: 'ACTIVE',
      division: { in: visibleDivisions },
    },
    select: {
      id: true,
      primaryIcd: true,
      primaryIcdLabel: true,
      secondaryIcd: true,
    },
  });
  if (rows.length === 0) return [];

  const caseIds = rows.map((r) => r.id);

  // Pre-fetch the OrgUser ids in the viewer's division so the
  // division-recency read can filter without a join through OrgUser
  // (Note has no relation alias for the clinician — only the
  // `clinicianOrgUserId` foreign key).
  const divisionClinicianRows =
    args.viewerDivision === 'MULTI'
      ? []
      : await prisma.orgUser.findMany({
          where: { orgId: args.orgId, division: args.viewerDivision },
          select: { id: true },
        });
  const divisionClinicianIds = divisionClinicianRows.map((r) => r.id);

  // Three parallel recency reads — small indexed scans by
  // `(orgId, status, encounter.caseManagementId)`. We sort desc on
  // `signedAt` then reduce to "first per caseId" in JS — cheaper than
  // three nested groupBy queries for the small N here (typical patient
  // has 1-5 active cases).
  const baseEncounterFilter = {
    orgId: args.orgId,
    status: { in: ['SIGNED' as const, 'TRANSFERRED' as const] },
    encounter: { caseManagementId: { in: caseIds } },
  };
  const noteSelect = {
    signedAt: true,
    encounter: { select: { caseManagementId: true } },
  } as const;

  const [viewerNotes, divisionNotes, overallNotes] = await Promise.all([
    prisma.note.findMany({
      where: { ...baseEncounterFilter, clinicianOrgUserId: args.clinicianOrgUserId },
      select: noteSelect,
      orderBy: { signedAt: 'desc' },
    }),
    divisionClinicianIds.length === 0
      ? Promise.resolve([])
      : prisma.note.findMany({
          where: { ...baseEncounterFilter, clinicianOrgUserId: { in: divisionClinicianIds } },
          select: noteSelect,
          orderBy: { signedAt: 'desc' },
        }),
    prisma.note.findMany({
      where: baseEncounterFilter,
      select: noteSelect,
      orderBy: { signedAt: 'desc' },
    }),
  ]);

  const viewerMostRecent = new Map<string, string>();
  const divisionMostRecent = new Map<string, string>();
  const overallMostRecent = new Map<string, string>();

  for (const n of viewerNotes) {
    const cid = n.encounter?.caseManagementId;
    if (!cid || !n.signedAt) continue;
    if (!viewerMostRecent.has(cid)) viewerMostRecent.set(cid, n.signedAt.toISOString());
  }
  for (const n of divisionNotes) {
    const cid = n.encounter?.caseManagementId;
    if (!cid || !n.signedAt) continue;
    if (!divisionMostRecent.has(cid)) divisionMostRecent.set(cid, n.signedAt.toISOString());
  }
  for (const n of overallNotes) {
    const cid = n.encounter?.caseManagementId;
    if (!cid || !n.signedAt) continue;
    if (!overallMostRecent.has(cid)) overallMostRecent.set(cid, n.signedAt.toISOString());
  }

  return rows.map((r) => ({
    id: r.id,
    primaryIcd: r.primaryIcd,
    primaryIcdLabel: r.primaryIcdLabel ?? r.primaryIcd ?? 'Unspecified',
    secondaryIcd: r.secondaryIcd,
    viewerLastActivityAt: viewerMostRecent.get(r.id) ?? null,
    viewerDivisionLastActivityAt: divisionMostRecent.get(r.id) ?? null,
    lastActivityAt: overallMostRecent.get(r.id) ?? null,
  }));
}
