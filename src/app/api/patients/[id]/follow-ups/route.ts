import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

/**
 * GET /api/patients/[id]/follow-ups?status=OPEN
 *
 * Live list of follow-ups for a patient (filtered by status). The sign-time
 * sweep + the capture-screen panel use this to render the current state
 * rather than the snapshot baked into the brief (which can lag by a visit).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const { id: patientId } = await params;
  const url = new URL(req.url);
  const statusFilter = url.searchParams.get('status');

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, orgId: authorizationUser.orgId, isDeleted: false },
    select: { id: true, orgId: true },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  const followUps = await prisma.followUp.findMany({
    where: {
      patientId: patient.id,
      orgId: authorizationUser.orgId,
      ...(statusFilter ? { status: statusFilter as 'OPEN' | 'MET' | 'CARRIED' | 'DROPPED' | 'CLOSED_BY_DISCHARGE' } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      originNote: { select: { id: true, signedAt: true } },
    },
  });

  return NextResponse.json({
    data: followUps.map((fu) => ({
      id: fu.id,
      text: fu.text,
      status: fu.status,
      createdAt: fu.createdAt.toISOString(),
      originNoteId: fu.originNoteId,
      originNoteSignedAt: fu.originNote?.signedAt?.toISOString() ?? null,
      episodeId: fu.episodeId,
    })),
  });
}
