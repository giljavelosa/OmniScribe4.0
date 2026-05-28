#!/usr/bin/env npx tsx
/**
 * Credits enterprise org banks with visitsPerSeat × seat basis each UTC month.
 *
 * Cron suggestion: 0 6 1 * * (06:00 UTC on the 1st of each month)
 *
 * Usage: npx tsx scripts/billing-monthly-allowance.ts
 */

import { runMonthlyAllowanceAllOrgs } from '../src/lib/billing/monthly-allowance';

async function main() {
  const results = await runMonthlyAllowanceAllOrgs();
  let credited = 0;
  let skipped = 0;
  for (const { orgId, result } of results) {
    if (result.ok) {
      credited += 1;
      console.log(`[ok] ${orgId} +${result.credited} visits → bank ${result.orgBankBalance}`);
    } else {
      skipped += 1;
      console.log(`[skip] ${orgId} ${result.reason}`);
    }
  }
  console.log(`Done. credited=${credited} skipped=${skipped} total=${results.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
