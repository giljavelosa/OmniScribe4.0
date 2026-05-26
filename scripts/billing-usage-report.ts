/**
 * scripts/billing-usage-report.ts — daily Stripe metered-usage reporter.
 *
 * Runs `reportAllOrgs` against the live DB + Stripe API. Emits one JSON
 * line per org for downstream log shipping + a summary line at the end.
 *
 * Suggested cron (daily at 06:00 UTC — after the rollup-refresh cron at
 * 05:00 UTC so seat counts and usage caches are warm):
 *   0 6 * * * node /app/scripts/billing-usage-report.mjs >> /var/log/billing.log 2>&1
 *
 * Environment requirements:
 *   - STRIPE_SECRET_KEY      — live key
 *   - DATABASE_URL           — read-only is sufficient (audit log + org rows)
 *
 * Idempotent: a same-day re-run sends zero usage records (Stripe
 * dedupes on `idempotencyKey: ${orgId}-YYYYMMDD`).
 */

import { reportAllOrgs } from '@/lib/billing/usage-reporter';
import { buildLiveUsageReporterDeps } from '@/lib/billing/usage-reporter-live';

async function main(): Promise<void> {
  const start = Date.now();
  const deps = buildLiveUsageReporterDeps();
  const results = await reportAllOrgs(deps, new Date());
  const durationMs = Date.now() - start;

  for (const row of results) {
    console.log(
      JSON.stringify({
        event: 'billing_usage_report_per_org',
        ...row,
      }),
    );
  }

  const summary = {
    event: 'billing_usage_report_summary',
    orgsTotal: results.length,
    orgsReported: results.filter((r) => r.status === 'reported').length,
    orgsNoChange: results.filter((r) => r.status === 'no_change').length,
    orgsSkipped: results.filter((r) => r.status.startsWith('skipped_')).length,
    orgsFailed: results.filter((r) => r.status === 'failed').length,
    totalIncrementReported: results.reduce(
      (sum, r) => sum + r.reported_increment,
      0,
    ),
    durationMs,
  };
  console.log(JSON.stringify(summary));

  if (summary.orgsFailed > 0) {
    // Exit non-zero so the cron supervisor flags the run for ops review,
    // but only after we've logged every successful row. Failures are
    // partial — the reporter doesn't bail the whole run on one bad org.
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      event: 'billing_usage_report_fatal',
      message: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
    }),
  );
  process.exit(1);
});
