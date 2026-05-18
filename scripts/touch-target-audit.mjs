#!/usr/bin/env node
/**
 * scripts/touch-target-audit.mjs — Unit 36.
 *
 * Informational audit: walks .tsx files under clinical/admin/owner/ops
 * surfaces + the shared components folder, flags any <button>, <a>, or
 * `[role="button"]` element with a `className` string that doesn't
 * include a touch-target enforcement (min-h-[var(--touch-min)],
 * h-touch-min, size-touch-min, min-h-touch). Skips Button / IconButton
 * primitives because their CVA classes already enforce a 36/40/44 px
 * minimum.
 *
 * Exits 0 either way — the script is for `npm run touch-audit` runs,
 * not a CI gate. Findings are a starting point for polish PRs.
 *
 * Usage:
 *   node scripts/touch-target-audit.mjs
 *
 * Output:
 *   path:line  <element>  className="..."
 *   ...
 *   Audit complete: N file(s) scanned, M finding(s).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SCAN_ROOTS = [
  'src/app/(clinical)',
  'src/app/(admin)',
  'src/app/(owner)',
  'src/app/(ops)',
  'src/components',
];

/** Class fragments that confirm a touch-min enforcement is present. */
const TOUCH_OK_PATTERNS = [
  /min-h-\[var\(--touch-min\)\]/,
  /min-w-\[var\(--touch-min\)\]/,
  /h-touch-min/,
  /min-h-touch/,
  /size-touch-min/,
];

/** Components whose CVA implementation already enforces touch sizing.
 *  When the element type matches one of these names, skip the audit. */
const TOUCH_OK_COMPONENTS = new Set([
  'Button',
  'IconButton',
  'AlertDialogAction',
  'AlertDialogCancel',
  'DropdownMenuItem',
]);

/** Element tags to audit when written as plain HTML. */
const TARGET_TAGS = new Set(['button', 'a']);

/** Element regex — matches both <button> and <Component> styles.
 *  Group 1 = element name; group 2 = the full attribute blob. */
const ELEMENT_RE = /<([A-Za-z][A-Za-z0-9]*)\s+([^>]*?)\/?>/g;
/** className extractor inside the attribute blob. Handles double-quoted
 *  and template-literal forms but NOT arbitrary cn() compositions —
 *  the audit deliberately skips those (false-negative bias). */
const CLASSNAME_RE = /className=(?:"([^"]*)"|\{`([^`]*)`\})/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip node_modules, .next, generated folders.
      if (entry === 'node_modules' || entry === '.next' || entry === 'generated') continue;
      yield* walk(full);
    } else if (entry.endsWith('.tsx')) {
      yield full;
    }
  }
}

function auditFile(path) {
  const text = readFileSync(path, 'utf8');
  const findings = [];
  let match;
  ELEMENT_RE.lastIndex = 0;
  while ((match = ELEMENT_RE.exec(text)) !== null) {
    const [, name, attrs] = match;
    const isPlainHtmlTag = TARGET_TAGS.has(name);
    const isTouchOkComponent = TOUCH_OK_COMPONENTS.has(name);
    if (isTouchOkComponent) continue;
    // Audit role="button" on non-button elements + plain html tags.
    const hasButtonRole = /role="button"/.test(attrs);
    if (!isPlainHtmlTag && !hasButtonRole) continue;

    const classMatch = CLASSNAME_RE.exec(attrs);
    if (!classMatch) continue;
    const classes = classMatch[1] ?? classMatch[2] ?? '';
    if (TOUCH_OK_PATTERNS.some((p) => p.test(classes))) continue;

    // Skip Link wrappers that target visual non-button paths (e.g.
    // table-row anchors that span a full row are naturally large enough).
    // Detect via grid/full-row/block-level class hints.
    if (/\bblock\b|\binline-block\b|\bw-full\b|\bgrid\b/.test(classes)) continue;

    // Skip chip-style source pills (`rounded-full` + small text/padding).
    // These are sub-button tags that appear in wrap rows; sizing them to
    // 44px would break the surrounding chat-bubble + brief-card layouts.
    // Chip touch-target accessibility is a separate visual-design concern;
    // tracked as a polish follow-up in progress-tracker.md.
    // Negative lookahead so px-1.5 / px-2.5 don't false-match (the . creates
    // a \b boundary after the digit, defeating \b in the original pattern).
    if (/\brounded-full\b/.test(classes) && /\bpx-[12](?![.\d])/.test(classes)) continue;

    // Compute line number from match index.
    const line = text.slice(0, match.index).split('\n').length;
    findings.push({
      path: path.replace(ROOT + '/', ''),
      line,
      element: name,
      classes: classes.slice(0, 120),
    });
  }
  return findings;
}

let scanned = 0;
const allFindings = [];
for (const root of SCAN_ROOTS) {
  const full = resolve(ROOT, root);
  try {
    statSync(full);
  } catch {
    continue;
  }
  for (const file of walk(full)) {
    scanned += 1;
    allFindings.push(...auditFile(file));
  }
}

for (const f of allFindings) {
  console.log(`${f.path}:${f.line}  <${f.element}>  className="${f.classes}"`);
}
console.log(
  `\nAudit complete: ${scanned} file(s) scanned, ${allFindings.length} finding(s).`,
);
console.log(
  'Findings are informational. Add `min-h-[var(--touch-min)]` (or use a ' +
    'Button primitive) to address; re-run to verify.',
);
process.exit(0);
