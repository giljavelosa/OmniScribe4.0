import { NextResponse } from 'next/server';

import { requirePlatformStaff } from '@/lib/authz/platform';
import { writePlatformAuditLog } from '@/lib/audit/log';
import { getQueueDepths } from '@/lib/ops/queue-depths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/queues — Unit 33.
 *
 * Per-queue waiting/active/failed/completed/delayed counts via the
 * BullMQ Queue.getJobCounts probe. Returns the array even when some
 * queues failed to probe (stub:true rows) so the UI can render the
 * full table with per-row "Redis unavailable" hints.
 *
 * Audit: OPS_QUEUE_DEPTH_CHECKED with stub count so the auditor can
 * spot "Redis was down" incidents without parsing the per-queue
 * details.
 */
export async function GET() {
  const guard = await requirePlatformStaff();
  if ('error' in guard) return guard.error;
  const { user: actor } = guard;

  const depths = await getQueueDepths();
  const stubCount = depths.filter((d) => d.stub).length;

  await writePlatformAuditLog({
    actingUserId: actor.id ?? 'unknown',
    action: 'OPS_QUEUE_DEPTH_CHECKED',
    resourceType: 'Queue',
    resourceId: 'all',
    metadata: {
      queueCount: depths.length,
      stubCount,
      // Aggregate the failed counts across all queues so the audit row
      // gives a one-shot signal without per-queue details.
      totalFailed: depths.reduce((sum, d) => sum + (d.failed ?? 0), 0),
    },
  });

  return NextResponse.json({ data: { queues: depths } });
}
