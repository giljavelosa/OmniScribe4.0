import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { enqueueAiGenerationJob } from '@/lib/queue';
import { FLAG_ANALYSIS_RUN_CAP } from '@/lib/notes/flag-analysis-state';

export const runtime = 'nodejs';

/**
 * POST /api/notes/[id]/analyze-flags — enqueue the clinician's
 * re-analyze pass (run #2 of {@link FLAG_ANALYSIS_RUN_CAP}).
 *
 * Sprint 0 lockdown context: run #1 fires INLINE at the tail of
 * generate-note, so by the time the clinician can land on /review
 * the note already has a baseline analysis. This route is the manual
 * re-analyze trigger and is hard-capped at runCount >= 2.
 *
 * Refuses:
 *   - 404 not_found
 *   - 409 not_reviewable if status not DRAFT/REVIEWING (rule 3)
 *   - 409 analysis_cap_reached if runCount >= FLAG_ANALYSIS_RUN_CAP
 *   - 409 flag_analysis_pending (handled by sign route — the worker's
 *     lifecycle stamps + run-count gate cover the race here)
 *
 * Returns the enqueued job's requestId so the client SSE channel can
 * correlate when the FLAGS_RE_ANALYZED event arrives.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  const note = await prisma.note.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    select: { id: true, orgId: true, status: true, flagAnalysisRunCount: true },
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

  // Sprint 0 lockdown — hard cap. After {@link FLAG_ANALYSIS_RUN_CAP}
  // runs the only forward path is resolve-and-sign. The worker
  // enforces the same defensively; the route refuses first so the
  // UI can read a clean error code.
  if (note.flagAnalysisRunCount >= FLAG_ANALYSIS_RUN_CAP) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'FLAGS_ANALYSIS_CAP_REACHED',
      resourceType: 'Note',
      resourceId: id,
      metadata: {
        runCount: note.flagAnalysisRunCount,
        cap: FLAG_ANALYSIS_RUN_CAP,
        attemptedBy: user.id,
      },
    });
    return NextResponse.json(
      {
        error: {
          code: 'analysis_cap_reached',
          message: `This note has already been analyzed ${note.flagAnalysisRunCount} times. Resolve the remaining flags or sign the note.`,
        },
        data: { runCount: note.flagAnalysisRunCount, cap: FLAG_ANALYSIS_RUN_CAP },
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
