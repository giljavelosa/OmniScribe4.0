#!/usr/bin/env node
/**
 * scripts/migrate-impersonation-gate.mjs — one-shot polish migration.
 *
 * Scans src/app/api/**.ts for route handlers that:
 *   1. Are POST / PATCH / PUT / DELETE (mutation handlers).
 *   2. Call requireFeatureAccess(...) without passing a request.
 *
 * For each match in a mutation handler block, rewrites the
 * requireFeatureAccess call to pass the handler's request param. If the
 * handler signature uses `_req: Request` (underscore-prefixed unused
 * convention), rename to `req: Request` so the new arg can reference it.
 *
 * Idempotent — re-running on already-migrated files is a no-op. Prints
 * a per-file summary; exits 0.
 *
 * This is one-time use; not added to package.json scripts.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const API_ROOT = resolve(ROOT, 'src/app/api');
const DRY = process.argv.includes('--dry');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (entry.endsWith('.ts')) yield full;
  }
}

const HANDLER_RE =
  /export\s+async\s+function\s+(POST|PATCH|PUT|DELETE)\s*\(([^)]*)\)\s*\{/g;
/** Inside a handler block, find calls like:
 *    const guard = await requireFeatureAccess('FOO');
 *    const guard = await requireFeatureAccess('FOO_BAR');
 *  Add `, req` IF not already present.
 */
const RFA_RE = /requireFeatureAccess\(\s*'([A-Z_]+)'\s*\)/g;

let touched = 0;
let totalCalls = 0;

for (const file of walk(API_ROOT)) {
  const original = readFileSync(file, 'utf8');
  let modified = original;
  let fileTouched = false;

  // Find each mutation handler block by index range.
  HANDLER_RE.lastIndex = 0;
  const handlerBlocks = [];
  let m;
  while ((m = HANDLER_RE.exec(modified)) !== null) {
    const [, , params] = m;
    const start = m.index;
    // Find matching closing brace via brace counting from after `{`.
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < modified.length && depth > 0) {
      const c = modified[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    handlerBlocks.push({ start, end: i, paramsRaw: params });
  }

  // Walk handlers in reverse so index-based edits don't shift earlier matches.
  for (let h = handlerBlocks.length - 1; h >= 0; h--) {
    const { start, end, paramsRaw } = handlerBlocks[h];
    const block = modified.slice(start, end);

    // Determine the request param name. Common patterns:
    //   (req: Request, { params }: ...)
    //   (_req: Request, { params }: ...)
    //   (req: Request)
    // Plus the rare case where it's named something else; for safety
    // we skip handlers that don't match these patterns.
    const reqMatch = paramsRaw.match(/^\s*(_?req)(\s*:\s*Request)?/);
    if (!reqMatch) continue;
    const reqName = reqMatch[1] ?? 'req';
    const needsRename = reqName === '_req';
    const targetName = needsRename ? 'req' : reqName;

    // Update each requireFeatureAccess call inside this block.
    let blockUpdated = block;
    let blockChanged = false;
    blockUpdated = blockUpdated.replace(RFA_RE, (call, feature) => {
      totalCalls += 1;
      blockChanged = true;
      return `requireFeatureAccess('${feature}', ${targetName})`;
    });

    if (!blockChanged) continue;

    // If we renamed _req → req, update the signature. The handler
    // declaration may span multiple lines (multi-arg formatter); we
    // walk the first ~5 lines of the block to find the parameter list.
    if (needsRename) {
      // Match _req: Request anywhere in the first 200 chars of the
      // handler block (covers single-line + multi-line signatures).
      blockUpdated = blockUpdated.replace(
        /(\bfunction\s+\w+\s*\([^)]*?)\b_req(\s*:\s*Request)/,
        '$1req$2',
      );
    }

    // Splice the updated block back.
    modified = modified.slice(0, start) + blockUpdated + modified.slice(end);
    fileTouched = true;
  }

  if (fileTouched && modified !== original) {
    touched += 1;
    if (!DRY) writeFileSync(file, modified, 'utf8');
    console.log(`${DRY ? '[dry] ' : ''}migrated: ${file.replace(ROOT + '/', '')}`);
  }
}

console.log(
  `\nMigration ${DRY ? 'DRY-RUN ' : ''}complete: ${touched} file(s) modified; ${totalCalls} call site(s) updated.`,
);
process.exit(0);
