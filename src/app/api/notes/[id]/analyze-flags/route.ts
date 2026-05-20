import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { enqueueAiGenerationJob } from '@/lib/queue';

export const runtime = 'nodejs';

/**
 * POST /api/notes/[id]/analyze-flags — enqueue per-section flag analysis.
 *
 * Refuses 409 if note is SIGNED (rule 3) or in non-DRAFT/REVIEWING state.
 * Returns the enqueued job's requestId so the client SSE channel can
 * correlate when the FLAGS_ANALYZED event arrives.
 *
 * Body (optional): { force?: boolean }. force=true re-analyzes every
 * section, bypassing the worker's content-hash skip gate. A normal
 * "Re-analyze" omits it, so only edited sections get re-checked.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  const note = await prisma.note.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    select: { id: true, orgId: true, status: true },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(note.orgId, authorizationUser.orgId);

  if (note.status !== 'DRAFT' && note.status !== 'REVIEWING') {
    return NextResponse.json(
      {
        error: {
          code: 'not_reviewable',
          message: `Flag analysis runs on DRAFT/REVIEWING notes only (current: ${note.status}).`,
        },
      },
      { status: 409 },
    );
  }

  const body = (await req.json().catch(() => null)) as { force?: unknown } | null;
  const force = body?.force === true;

  const requestId = randomBytes(8).toString('hex');
  await enqueueAiGenerationJob({
    noteId: id,
    orgId: authorizationUser.orgId,
    type: 'analyze-flags',
    requestId,
    force,
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'FLAGS_ANALYZER_ENQUEUED',
    resourceType: 'Note',
    resourceId: id,
    metadata: { requestId, force },
  });

  return NextResponse.json({ data: { requestId, ok: true } }, { status: 202 });
}
