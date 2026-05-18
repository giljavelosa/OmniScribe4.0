#!/usr/bin/env node
/**
 * scripts/audit-purge.mjs — Unit 34.
 *
 * Cron-friendly runner for the audit retention purge. Hits every org
 * with `auditRetentionDays` set; logs per-org results to stdout.
 * Exits 0 even on per-org failures so the cron doesn't bail on a
 * transient error (the per-org error appears in the log + the audit
 * row for successful runs proves which orgs were processed).
 *
 * Usage:
 *   node scripts/audit-purge.mjs
 *
 * Suggested cron (daily at 03:00 UTC):
 *   0 3 * * * node /app/scripts/audit-purge.mjs >> /var/log/audit-purge.log 2>&1
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsxFile = resolve(__dirname, 'audit-purge.ts');

// Delegate to a TS sibling so the actual prisma + audit logic stays
// strongly typed. The CLI entry point itself is JS to avoid Node
// loader gymnastics in production cron environments.
const result = spawnSync(
  'npx',
  ['--no-install', 'tsx', tsxFile],
  { stdio: 'inherit', cwd: resolve(__dirname, '..') },
);
process.exit(result.status ?? 1);
