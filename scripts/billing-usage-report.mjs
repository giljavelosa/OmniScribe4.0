#!/usr/bin/env node
/**
 * scripts/billing-usage-report.mjs — cron-friendly wrapper for
 * scripts/billing-usage-report.ts. Same pattern as rollup-refresh.mjs.
 *
 * Suggested cron (daily at 06:00 UTC):
 *   0 6 * * * node /app/scripts/billing-usage-report.mjs >> /var/log/billing.log 2>&1
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsxFile = resolve(__dirname, 'billing-usage-report.ts');

const result = spawnSync(
  'npx',
  ['--no-install', 'tsx', tsxFile],
  { stdio: 'inherit', cwd: resolve(__dirname, '..') },
);
process.exit(result.status ?? 1);
