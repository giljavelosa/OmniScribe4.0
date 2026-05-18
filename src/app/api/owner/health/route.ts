import { NextResponse } from 'next/server';

import { requirePlatformStaff } from '@/lib/authz/platform';
import { writePlatformAuditLog } from '@/lib/audit/log';
import { runAllHealthChecks } from '@/services/health/checks';

export const runtime = 'nodejs';

/**
 * GET /api/owner/health — runs every provider/service check in parallel
 * with a 5s per-check timeout. Returns `{ checks: [...] }` PHI-free.
 *
 * Unit 33: gate migrated from requirePlatformOwner → requirePlatformStaff
 * so PLATFORM_OPS can call the same endpoint. URL kept under /api/owner
 * for backward compatibility (existing /owner/health page calls it);
 * the new /ops/health UI calls the same endpoint. Audit action stays
 * PLATFORM_HEALTH_CHECKED so the auditor sees one row type regardless
 * of which role triggered the check.
 */
export async function GET() {
  const guard = await requirePlatformStaff();
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
