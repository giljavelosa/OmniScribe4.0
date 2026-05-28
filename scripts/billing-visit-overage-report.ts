#!/usr/bin/env npx tsx
/**
 * Daily visit overage reporter for visit-bank orgs with allowOverage.
 *
 * Cron suggestion: 15 6 * * * (06:15 UTC daily, after draft usage report)
 *
 * Usage: npx tsx scripts/billing-visit-overage-report.ts
 */

import { reportVisitOverageAllOrgs } from '../src/lib/billing/visit-overage-reporter';
import { buildLiveVisitOverageReporterDeps } from '../src/lib/billing/visit-overage-reporter-live';

async function main() {
  const start = Date.now();
  const deps = buildLiveVisitOverageReporterDeps();
  const results = await reportVisitOverageAllOrgs(deps, new Date());

  for (const row of results) {
    console.log(JSON.stringify({ event: 'visit_overage_report_per_org', ...row }));
  }

  const summary = {
    event: 'visit_overage_report_summary',
    orgsTotal: results.length,
    orgsReported: results.filter((r) => r.status === 'reported').length,
    orgsFailed: results.filter((r) => r.status === 'failed').length,
    durationMs: Date.now() - start,
  };
  console.log(JSON.stringify(summary));

  if (summary.orgsFailed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
