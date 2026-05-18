import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

/**
 * GET /api/patients/[id]/brief?episodeId=...
 *
 * Returns the patient's most-recent prior-context brief, preferring same-
 * episode when episodeId is provided. The brief is what's rendered on
 * /prepare/[noteId] for a returning patient — must come back in <1s from
 * cache (it's a single indexed read; no LLM call here).
 *
 * Returns 200 + { data: NoteBrief | null }. `null` means "no prior context
 * yet" — the UI renders an EmptyBrief variant rather than failing.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id: patientId } = await params;
  const url = new URL(req.url);
  const episodeId = url.searchParams.get('episodeId');

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, orgId: authorizationUser.orgId, isDeleted: false },
    select: { id: true, orgId: true },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  // Prefer same-episode brief; fall back to patient-wide most-recent.
  let brief = null;
  if (episodeId) {
    brief = await prisma.noteBrief.findFirst({
      where: { patientId: patient.id, orgId: authorizationUser.orgId, episodeId },
      orderBy: { generatedAt: 'desc' },
    });
  }
  if (!brief) {
    brief = await prisma.noteBrief.findFirst({
      where: { patientId: patient.id, orgId: authorizationUser.orgId },
      orderBy: { generatedAt: 'desc' },
    });
  }

  if (brief) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'BRIEF_VIEWED',
      resourceType: 'NoteBrief',
      resourceId: brief.id,
      metadata: { patientId: patient.id, episodeId: episodeId ?? null, source: 'patient' },
    });
  }

  // Cache short — the brief mostly changes only after a new sign event.
  return new NextResponse(JSON.stringify({ data: brief }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=30',
    },
  });
}
