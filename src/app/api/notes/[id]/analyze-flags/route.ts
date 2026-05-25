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

  const requestId = randomBytes(8).toString('hex');
  // Stamp the lifecycle anchor BEFORE enqueueing the BullMQ job so the
  // sign route can refuse with `flag_analysis_pending` from the moment
  // the request is accepted. The worker stamps `flagAnalysisCompletedAt`
  // in a `finally` block when it terminates (success / mid-run skip /
  // error), so the gate is self-clearing.
  await prisma.note.update({
    where: { id },
    data: {
      flagAnalysisStartedAt: new Date(),
      flagAnalysisCompletedAt: null,
    },
  });
  await enqueueAiGenerationJob({
    noteId: id,
    orgId: authorizationUser.orgId,
    type: 'analyze-flags',
    requestId,
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'FLAGS_ANALYZER_ENQUEUED',
    resourceType: 'Note',
    resourceId: id,
    metadata: { requestId },
  });

  return NextResponse.json({ data: { requestId, ok: true } }, { status: 202 });
}
