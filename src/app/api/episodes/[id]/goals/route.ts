import { NextResponse } from 'next/server';
import { z } from 'zod';
import { GoalType } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

const createSchema = z.object({
  goalType: z.enum(GoalType),
  goalText: z.string().min(1).max(500),
  baselineMeasure: z.string().max(120).nullable().optional(),
  targetMeasure: z.string().max(120).nullable().optional(),
});

/**
 * POST /api/episodes/[id]/goals — add a new goal to an active episode.
 *
 * Refuses 409 on DISCHARGED/CANCELLED episodes (closed episodes shouldn't
 * grow new goals — reopen first, then add).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const episode = await prisma.episodeOfCare.findFirst({
    where: { id, orgId: authorizationUser.orgId },
  });
  if (!episode) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(episode.orgId, authorizationUser.orgId);
  if (episode.status === 'DISCHARGED' || episode.status === 'CANCELLED') {
    return NextResponse.json(
      { error: { code: 'closed', message: `Episode is ${episode.status}; reopen first.` } },
      { status: 409 },
    );
  }

  const goal = await prisma.episodeGoal.create({
    data: {
      episodeId: id,
      goalType: parsed.data.goalType,
      goalText: parsed.data.goalText,
      baselineMeasure: parsed.data.baselineMeasure ?? null,
      targetMeasure: parsed.data.targetMeasure ?? null,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'GOAL_STATUS_CHANGED',
    resourceType: 'EpisodeGoal',
    resourceId: goal.id,
    metadata: {
      episodeId: id,
      patientId: episode.patientId,
      goalType: goal.goalType,
      from: null,
      to: 'ACTIVE',
      kind: 'created',
    },
  });

  return NextResponse.json({ data: goal }, { status: 201 });
}
