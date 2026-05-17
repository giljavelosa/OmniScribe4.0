import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

/**
 * GET /api/notes/[id]/brief
 *
 * Returns the brief 1:1 with this signed note (admin / debug surface). The
 * "current open follow-ups" inside content reflect snapshot-time, not
 * realtime — use /api/patients/[id]/follow-ups for live state.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id: noteId } = await params;
  const brief = await prisma.noteBrief.findUnique({
    where: { noteId },
    include: { note: { select: { orgId: true } } },
  });
  if (!brief) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(brief.orgId, authorizationUser.orgId);

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'BRIEF_VIEWED',
    resourceType: 'NoteBrief',
    resourceId: brief.id,
    metadata: { noteId, source: 'note' },
  });

  return NextResponse.json({ data: brief });
}
