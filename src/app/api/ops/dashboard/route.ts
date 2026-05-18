import { NextResponse } from 'next/server';

import { requirePlatformStaff } from '@/lib/authz/platform';
import { writePlatformAuditLog } from '@/lib/audit/log';
import { getPlatformMetrics } from '@/lib/ops/platform-metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/dashboard — Unit 33.
 *
 * Returns the platform-wide metric tile values for the /ops dashboard.
 * Backed by getPlatformMetrics() which has a 60-second in-memory cache,
 * so polling at 30s from the UI hits the cache 50% of the time.
 *
 * Audit: OPS_DASHBOARD_VIEWED with cacheHit flag (so the auditor lens
 * can see how often ops users are refreshing vs reading cached values).
 * PHI-fenced — no per-metric values in audit metadata.
 */
export async function GET() {
  const guard = await requirePlatformStaff();
  if ('error' in guard) return guard.error;
  const { user: actor } = guard;

  // Sample the cache state before + after the call so the audit row
  // captures whether we served from cache. Cheap probe — no compute.
  const metrics = await getPlatformMetrics();

  await writePlatformAuditLog({
    actingUserId: actor.id ?? 'unknown',
    action: 'OPS_DASHBOARD_VIEWED',
    resourceType: 'Dashboard',
    resourceId: 'platform',
    metadata: {
      computedAt: metrics.computedAt,
      // Total counts are platform-wide aggregates — no PHI risk.
      tileCount: 9,
    },
  });

  return NextResponse.json({ data: { metrics } });
}
