import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

/**
 * POST /api/episodes/[id]/recertify — reset the recert cycle.
 *
 * Sets `recertDueAt = now + recertIntervalDays` AND flips status from
 * RECERT_DUE back to ACTIVE. Idempotent on an already-ACTIVE episode
 * (just bumps the due date). Refuses 409 if the episode is DISCHARGED
 * or CANCELLED — close/reopen separately first.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

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

  const nextDue = new Date(Date.now() + episode.recertIntervalDays * 86_400_000);
  const updated = await prisma.episodeOfCare.update({
    where: { id },
    data: { recertDueAt: nextDue, status: 'ACTIVE' },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'EPISODE_RECERTIFIED',
    resourceType: 'EpisodeOfCare',
    resourceId: id,
    metadata: {
      patientId: episode.patientId,
      previousStatus: episode.status,
      previousDueAt: episode.recertDueAt?.toISOString() ?? null,
      newDueAt: nextDue.toISOString(),
      recertIntervalDays: episode.recertIntervalDays,
    },
  });

  return NextResponse.json({ data: updated });
}
