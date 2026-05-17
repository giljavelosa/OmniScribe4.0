#!/usr/bin/env node
// Runs after `npm install`. Generates the Prisma client if a schema exists.
// Pre-Unit-01-Commit-6, no schema exists yet → no-op (don't fail install).

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!existsSync('prisma/schema.prisma')) {
  console.log('postinstall: no prisma/schema.prisma yet — skipping prisma generate');
  process.exit(0);
}

const r = spawnSync('npx', ['prisma', 'generate', '--no-hints'], { stdio: 'inherit' });
process.exit(r.status ?? 0);
