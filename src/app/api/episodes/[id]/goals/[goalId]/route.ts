import { NextResponse } from 'next/server';
import { z } from 'zod';
import { GoalStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    status: z.enum(GoalStatus).optional(),
    currentMeasure: z.string().max(120).nullable().optional(),
    deltaNote: z.string().max(500).optional(),
    goalText: z.string().min(1).max(500).optional(),
    targetMeasure: z.string().max(120).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no_fields' });

const STATUSES_REQUIRING_DELTA: ReadonlySet<GoalStatus> = new Set([
  GoalStatus.MODIFIED,
  GoalStatus.DISCONTINUED,
]);

/**
 * PATCH /api/episodes/[id]/goals/[goalId] — update goal fields + status.
 *
 * On a status transition: writes a GoalProgressEntry trail row so the goal
 * lineage reconstructs. Status MODIFIED + DISCONTINUED REQUIRE a deltaNote
 * (clinician explains why the change is happening — protects the
 * compliance trail at the API layer).
 *
 * Audits GOAL_STATUS_CHANGED with from/to + writes GOAL_PROGRESS_ENTRY_ADDED
 * when the trail row is created.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; goalId: string }> }) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id: episodeId, goalId } = await params;
  const episode = await prisma.episodeOfCare.findFirst({
    where: { id: episodeId, orgId: authorizationUser.orgId },
    select: { id: true, orgId: true, patientId: true, status: true },
  });
  if (!episode) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(episode.orgId, authorizationUser.orgId);

  const before = await prisma.episodeGoal.findFirst({
    where: { id: goalId, episodeId },
  });
  if (!before) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  if (
    parsed.data.status &&
    STATUSES_REQUIRING_DELTA.has(parsed.data.status) &&
    !parsed.data.deltaNote?.trim()
  ) {
    return NextResponse.json(
      {
        error: {
          code: 'delta_note_required',
          message: `Status ${parsed.data.status} requires a deltaNote (≥1 char).`,
        },
      },
      { status: 400 },
    );
  }

  const statusChanged =
    parsed.data.status !== undefined && parsed.data.status !== before.status;

  const result = await prisma.$transaction(async (tx) => {
    const after = await tx.episodeGoal.update({
      where: { id: goalId },
      data: {
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
        ...(parsed.data.currentMeasure !== undefined
          ? { currentMeasure: parsed.data.currentMeasure }
          : {}),
        ...(parsed.data.goalText !== undefined ? { goalText: parsed.data.goalText } : {}),
        ...(parsed.data.targetMeasure !== undefined
          ? { targetMeasure: parsed.data.targetMeasure }
          : {}),
      },
    });

    let progressEntryId: string | null = null;
    if (statusChanged || parsed.data.currentMeasure !== undefined) {
      const entry = await tx.goalProgressEntry.create({
        data: {
          goalId,
          measureValue: parsed.data.currentMeasure ?? null,
          statusAtEntry: after.status,
          deltaNote: parsed.data.deltaNote ?? null,
          recordedByOrgUserId: authorizationUser.orgUserId,
        },
      });
      progressEntryId = entry.id;
    }
    return { after, progressEntryId };
  });

  if (statusChanged) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'GOAL_STATUS_CHANGED',
      resourceType: 'EpisodeGoal',
      resourceId: goalId,
      metadata: {
        episodeId,
        patientId: episode.patientId,
        from: before.status,
        to: parsed.data.status!,
        hasDeltaNote: !!parsed.data.deltaNote,
      },
    });
  }
  if (result.progressEntryId) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'GOAL_PROGRESS_ENTRY_ADDED',
      resourceType: 'GoalProgressEntry',
      resourceId: result.progressEntryId,
      metadata: {
        episodeId,
        goalId,
        patientId: episode.patientId,
        statusAtEntry: result.after.status,
        hasMeasureValue: !!parsed.data.currentMeasure,
      },
    });
  }

  return NextResponse.json({ data: result.after });
}
