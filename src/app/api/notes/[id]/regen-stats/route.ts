import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { readInferenceLog } from '@/lib/notes/section-status';

export const runtime = 'nodejs';

/**
 * GET /api/notes/[id]/regen-stats
 *
 * Returns the PHI-free `_sectionStats` aggregate written by the
 * ai-generation worker. Useful for ops dashboards + future per-org SLO
 * reporting; today it's a query target for admins via Prisma Studio /
 * curl, not yet a dedicated UI surface.
 *
 * Gated by TEAM_MEMBERS_MANAGE — observability data, not patient data.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const { id } = await params;
  const note = await prisma.note.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    select: { id: true, orgId: true, inferenceLog: true, status: true },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(note.orgId, authorizationUser.orgId);

  const stats = readInferenceLog(note.inferenceLog)._sectionStats ?? null;
  return NextResponse.json({
    data: {
      noteId: note.id,
      status: note.status,
      stats,
    },
  });
}
