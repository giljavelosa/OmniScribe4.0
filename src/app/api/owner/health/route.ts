import { NextResponse } from 'next/server';

import { requirePlatformOwner } from '@/lib/authz/platform';
import { writePlatformAuditLog } from '@/lib/audit/log';
import { runAllHealthChecks } from '@/services/health/checks';

export const runtime = 'nodejs';

/**
 * GET /api/owner/health — runs every provider/service check in parallel
 * with a 5s per-check timeout. Returns `{ checks: [...] }` PHI-free.
 *
 * Audited as PLATFORM_HEALTH_CHECKED with the counts of ok/stub/failed.
 */
export async function GET() {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user: actor } = guard;

  const checks = await runAllHealthChecks();
  const okCount = checks.filter((c) => c.ok && !c.stub).length;
  const stubCount = checks.filter((c) => c.stub).length;
  const failedCount = checks.filter((c) => !c.ok).length;

  await writePlatformAuditLog({
    actingUserId: actor.id ?? 'unknown',
    action: 'PLATFORM_HEALTH_CHECKED',
    resourceType: 'Health',
    resourceId: 'all',
    metadata: { okCount, stubCount, failedCount, totalChecks: checks.length },
  });

  return NextResponse.json({ data: { checks, summary: { okCount, stubCount, failedCount } } });
}
