/**
 * scripts/rollup-refresh.ts — Polish (post-Wave 6).
 *
 * Runs refreshAllOrgRollups against the live DB. Emits one JSON line
 * per org per rollup-type for downstream log shipping + a summary
 * line at the end.
 */

import { refreshAllOrgRollups } from '@/lib/owner/rollup-refresh';

async function main(): Promise<void> {
  const start = Date.now();
  const result = await refreshAllOrgRollups();
  const durationMs = Date.now() - start;

  for (const row of result.perOrg) {
    if (row.error) {
      console.log(
        JSON.stringify({
          event: 'rollup_refresh_per_org_failed',
          orgId: row.orgId,
          error: row.error,
        }),
      );
      continue;
    }
    for (const r of row.results ?? []) {
      console.log(
        JSON.stringify({
          event: 'rollup_refresh_per_org',
          ...r,
        }),
      );
    }
  }

  console.log(
    JSON.stringify({
      event: 'rollup_refresh_summary',
      orgsProcessed: result.orgsProcessed,
      totalRefreshes: result.totalRefreshes,
      durationMs,
    }),
  );
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      event: 'rollup_refresh_fatal',
      message: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
    }),
  );
  process.exit(1);
});
