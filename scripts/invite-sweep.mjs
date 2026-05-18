#!/usr/bin/env node
/**
 * scripts/invite-sweep.mjs — Unit 37.
 *
 * Cron-friendly runner for the expired-invite sweep. Marks
 * not-yet-consumed Invite rows whose expiresAt has passed as
 * consumed, then writes one INVITE_EXPIRED_SWEPT audit row per
 * affected org.
 *
 * Idempotent: re-running with no expired invites is a no-op + writes
 * no audit rows. Exits 0 on completion regardless of how many rows
 * were swept; logs counts as JSON for downstream log shipping.
 *
 * Suggested cron (daily at 04:00 UTC):
 *   0 4 * * * node /app/scripts/invite-sweep.mjs >> /var/log/invite-sweep.log 2>&1
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsxFile = resolve(__dirname, 'invite-sweep.ts');

const result = spawnSync(
  'npx',
  ['--no-install', 'tsx', tsxFile],
  { stdio: 'inherit', cwd: resolve(__dirname, '..') },
);
process.exit(result.status ?? 1);
