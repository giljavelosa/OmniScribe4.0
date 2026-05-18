/**
 * Background rollup refresh — Polish (post-Wave 6).
 *
 * Promotes Unit 32 OrgUsageDaily + Unit 35 OrgLlmCostDaily caches
 * from on-demand-only to scheduled warm-cache. Without this, the
 * first owner who opens an org page after the 60-min TTL pays the
 * recompute latency; with this running daily via cron, the caches
 * stay warm + page loads are sub-100ms.
 *
 * The on-demand path stays as a fallback (works even when this
 * cron hasn't run yet). The background path is additive — no
 * behavior change for owners who hit the page; just better latency.
 *
 * Each refresh writes one ROLLUP_REFRESHED audit row per (org,
 * rollupType) tuple so the auditor can see "did the daily refresh
 * actually run for org X?" without hitting the cache table directly.
 */

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { computeOrgUsage } from './usage-rollup';
import { computeOrgLlmCost } from './llm-cost-rollup';

export type RollupRefreshResult = {
  orgId: string;
  rollupType: 'usage' | 'llm-cost';
  windowDays: number;
  rowsComputed: number;
  durationMs: number;
  error?: string;
};

/**
 * Refresh both rollup caches for a single org. Returns one result
 * per rollup type (always 2 entries). Per-rollup failures are
 * captured in `error` so one bad query doesn't bail the whole run.
 */
export async function refreshOrgRollups(
  orgId: string,
  windowDays: number = 30,
  now: Date = new Date(),
): Promise<RollupRefreshResult[]> {
  const results: RollupRefreshResult[] = [];

  // Usage rollup.
  const usageStart = Date.now();
  try {
    const rows = await computeOrgUsage(orgId, windowDays, now);
    results.push({
      orgId,
      rollupType: 'usage',
      windowDays,
      rowsComputed: rows.length,
      durationMs: Date.now() - usageStart,
    });
  } catch (err) {
    results.push({
      orgId,
      rollupType: 'usage',
      windowDays,
      rowsComputed: 0,
      durationMs: Date.now() - usageStart,
      error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
  }

  // LLM cost rollup.
  const costStart = Date.now();
  try {
    const rows = await computeOrgLlmCost(orgId, windowDays, now);
    results.push({
      orgId,
      rollupType: 'llm-cost',
      windowDays,
      rowsComputed: rows.length,
      durationMs: Date.now() - costStart,
    });
  } catch (err) {
    results.push({
      orgId,
      rollupType: 'llm-cost',
      windowDays,
      rowsComputed: 0,
      durationMs: Date.now() - costStart,
      error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
  }

  // Audit per-rollup-type (one row each, including errors). The audit
  // writer is fail-loud per Rule 8 — if THAT fails we let it propagate;
  // the cron sees non-zero exit + alerts.
  for (const r of results) {
    await writeAuditLog({
      orgId,
      action: 'ROLLUP_REFRESHED',
      resourceType: 'Rollup',
      resourceId: r.rollupType,
      metadata: {
        rollupType: r.rollupType,
        windowDays: r.windowDays,
        rowsComputed: r.rowsComputed,
        durationMs: r.durationMs,
        hasError: !!r.error,
      },
    });
  }

  return results;
}

/**
 * Refresh rollups for every org. Per-org failures are caught + appended
 * to the result so the cron doesn't bail on a transient error.
 */
export async function refreshAllOrgRollups(
  windowDays: number = 30,
  now: Date = new Date(),
): Promise<{
  orgsProcessed: number;
  totalRefreshes: number;
  perOrg: Array<{ orgId: string; results?: RollupRefreshResult[]; error?: string }>;
}> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const perOrg: Array<{
    orgId: string;
    results?: RollupRefreshResult[];
    error?: string;
  }> = [];
  let totalRefreshes = 0;

  for (const { id } of orgs) {
    try {
      const results = await refreshOrgRollups(id, windowDays, now);
      perOrg.push({ orgId: id, results });
      totalRefreshes += results.length;
    } catch (err) {
      perOrg.push({
        orgId: id,
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      });
    }
  }

  return { orgsProcessed: orgs.length, totalRefreshes, perOrg };
}
