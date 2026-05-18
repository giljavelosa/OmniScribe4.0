#!/usr/bin/env node
/**
 * scripts/rollup-refresh.mjs — Polish (post-Wave 6).
 *
 * Cron-friendly runner for the OrgUsageDaily + OrgLlmCostDaily cache
 * refresh. Calls refreshAllOrgRollups; logs per-org JSON events for
 * downstream log shipping. Exits 0 on success, 1 on fatal error.
 *
 * Suggested cron (daily at 05:00 UTC — after the audit purge at
 * 03:00 + invite sweep at 04:00 so all housekeeping runs in
 * sequence):
 *   0 5 * * * node /app/scripts/rollup-refresh.mjs >> /var/log/rollup-refresh.log 2>&1
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsxFile = resolve(__dirname, 'rollup-refresh.ts');

const result = spawnSync(
  'npx',
  ['--no-install', 'tsx', tsxFile],
  { stdio: 'inherit', cwd: resolve(__dirname, '..') },
);
process.exit(result.status ?? 1);
