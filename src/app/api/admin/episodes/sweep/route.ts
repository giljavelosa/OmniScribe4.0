import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const MAX_PER_SWEEP = 500;

/**
 * POST /api/admin/episodes/sweep — recert sweep (cron-callable).
 *
 * Scans ACTIVE episodes for the current org where recertDueAt < now and
 * flips them to RECERT_DUE. Returns `{ scanned, flipped, errors }` so an
 * external scheduler can monitor.
 *
 * Per-episode write is non-transactional with the count read — the sweep
 * is idempotent (subsequent runs see the now-RECERT_DUE rows and skip).
 *
 * One audit row per flipped episode + one summary audit row (EPISODE_SWEEP_RUN)
 * with totals + the sweep id for trace correlation.
 *
 * Owner/admin-gated. Bullmq cron integration is a Wave 3 ops concern;
 * v1 ships this endpoint for an external cron to call.
 */
export async function POST() {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const sweepId = randomBytes(6).toString('hex');
  const startedAt = new Date();

  const due = await prisma.episodeOfCare.findMany({
    where: {
      orgId: authorizationUser.orgId,
      status: 'ACTIVE',
      recertDueAt: { lt: startedAt },
    },
    select: { id: true, patientId: true, recertDueAt: true },
    take: MAX_PER_SWEEP,
  });

  let flipped = 0;
  let errors = 0;
  for (const ep of due) {
    try {
      await prisma.episodeOfCare.update({
        where: { id: ep.id },
        data: { status: 'RECERT_DUE' },
      });
      flipped += 1;
      await writeAuditLog({
        userId: user.id,
        orgId: authorizationUser.orgId,
        action: 'EPISODE_RECERT_TRIGGERED',
        resourceType: 'EpisodeOfCare',
        resourceId: ep.id,
        metadata: {
          sweepId,
          patientId: ep.patientId,
          dueAt: ep.recertDueAt?.toISOString() ?? null,
        },
      });
    } catch (err) {
      errors += 1;
      console.warn(`[episodes/sweep] flip failed for ${ep.id}:`, err);
    }
  }

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'EPISODE_SWEEP_RUN',
    resourceType: 'EpisodeOfCare',
    resourceId: 'sweep',
    metadata: {
      sweepId,
      scanned: due.length,
      flipped,
      errors,
      reachedCap: due.length === MAX_PER_SWEEP,
    },
  });

  return NextResponse.json({
    data: {
      sweepId,
      scanned: due.length,
      flipped,
      errors,
      reachedCap: due.length === MAX_PER_SWEEP,
    },
  });
}
