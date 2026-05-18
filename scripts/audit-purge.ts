/**
 * scripts/audit-purge.ts — Unit 34 (TS sibling for audit-purge.mjs).
 *
 * Runs purgeAuditAllOrgs against the live DB. Prints a one-line
 * summary plus per-org JSON for downstream log shipping. Never
 * throws — per-org errors are captured in the result.
 */

import { purgeAuditAllOrgs } from '@/lib/audit/retention';

async function main(): Promise<void> {
  const start = Date.now();
  const result = await purgeAuditAllOrgs();
  const duration = Date.now() - start;

  console.log(
    JSON.stringify({
      event: 'audit_purge_run_summary',
      orgsProcessed: result.orgsProcessed,
      totalRowsDeleted: result.totalRowsDeleted,
      durationMs: duration,
    }),
  );
  for (const row of result.perOrg) {
    console.log(JSON.stringify({ event: 'audit_purge_run_per_org', ...row }));
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      event: 'audit_purge_run_fatal',
      message: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
    }),
  );
  process.exit(1);
});
