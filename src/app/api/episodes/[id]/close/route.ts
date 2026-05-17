import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

const bodySchema = z.object({
  reason: z.string().max(500).optional(),
});

/**
 * POST /api/episodes/[id]/close — discharge an episode.
 *
 * Sets status DISCHARGED + endedAt = now. Cascades open FollowUps for the
 * same episode to CLOSED_BY_DISCHARGE (lifecycle invariant from Unit 06:
 * episode discharge automatically closes outstanding commitments). The
 * cascade runs inside the same $transaction so the close + the followup
 * sweep commit atomically.
 *
 * Audits EPISODE_DISCHARGED with the cascaded followup count.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
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

  if (episode.status === 'DISCHARGED') {
    return NextResponse.json(
      { error: { code: 'already_discharged' } },
      { status: 409 },
    );
  }
  if (episode.status === 'CANCELLED') {
    return NextResponse.json(
      { error: { code: 'cancelled', message: 'Cancelled episodes cannot be discharged.' } },
      { status: 409 },
    );
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.episodeOfCare.update({
      where: { id },
      data: {
        status: 'DISCHARGED',
        endedAt: now,
        closeReason: parsed.data.reason ?? null,
      },
    });
    const cascade = await tx.followUp.updateMany({
      where: { episodeId: id, status: 'OPEN' },
      data: {
        status: 'CLOSED_BY_DISCHARGE',
        closedAt: now,
        closedByOrgUserId: authorizationUser.orgUserId,
      },
    });
    return { updated, cascadeCount: cascade.count };
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'EPISODE_DISCHARGED',
    resourceType: 'EpisodeOfCare',
    resourceId: id,
    metadata: {
      patientId: episode.patientId,
      previousStatus: episode.status,
      cascadedFollowupCount: result.cascadeCount,
      hasReason: !!parsed.data.reason,
    },
  });

  return NextResponse.json({ data: result.updated });
}
