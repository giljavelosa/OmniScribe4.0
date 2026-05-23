import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

/**
 * GET /api/notes/[id]/case-router — Sprint 0.13.
 *
 * Returns the latest CaseRouterRun for this note (or null if Miss Cleo's
 * case-router worker hasn't fired yet). The review-screen panel polls
 * this when the server-render came up before the worker completed.
 *
 * Same authorization as GET /api/notes/[id]: assigned clinician, ORG_ADMIN,
 * or VIEWER.
 *
 * Also returns the patient's open cases so the "Change manually" branch
 * can render the picker without an extra round-trip.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const { id } = await params;
  const note = await prisma.note.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    select: {
      id: true,
      orgId: true,
      patientId: true,
      clinicianOrgUserId: true,
      encounter: { select: { caseManagementId: true } },
    },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(note.orgId, authorizationUser.orgId);

  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'ORG_ADMIN' &&
    authorizationUser.role !== 'VIEWER'
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const run = await prisma.caseRouterRun.findUnique({
    where: { noteId: id },
  });

  // Open cases for the "Change manually" branch — exclude the encounter's
  // currently-bound PENDING_ROUTER case so the picker only surfaces
  // bindable destinations.
  const cases = await prisma.caseManagement.findMany({
    where: {
      orgId: authorizationUser.orgId,
      patientId: note.patientId,
      status: 'ACTIVE',
      ...(note.encounter?.caseManagementId
        ? { id: { not: note.encounter.caseManagementId } }
        : {}),
    },
    orderBy: { openedAt: 'desc' },
    select: {
      id: true,
      primaryIcd: true,
      primaryIcdLabel: true,
      secondaryIcd: true,
      secondaryIcdLabel: true,
      status: true,
      openedAt: true,
    },
  });

  return NextResponse.json({
    data: {
      run: run
        ? {
            id: run.id,
            confidence: run.confidence,
            reasoning: run.reasoning,
            modelVersion: run.modelVersion,
            createdAt: run.createdAt.toISOString(),
            acceptedAction: run.acceptedAction,
            acceptedAt: run.acceptedAt?.toISOString() ?? null,
            proposalJson: run.proposalJson,
          }
        : null,
      currentCaseManagementId: note.encounter?.caseManagementId ?? null,
      activeCases: cases.map((c) => ({
        id: c.id,
        primaryIcd: c.primaryIcd,
        primaryIcdLabel: c.primaryIcdLabel,
        secondaryIcd: c.secondaryIcd,
        secondaryIcdLabel: c.secondaryIcdLabel,
        status: c.status,
        openedAt: c.openedAt.toISOString(),
      })),
    },
  });
}
