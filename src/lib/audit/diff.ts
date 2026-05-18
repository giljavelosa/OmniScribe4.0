/**
 * PHI-free before/after diff helper for audit-log metadata enrichment.
 *
 * Use case: when an admin updates a record (BAA fields on Organization, a
 * user's role, a Site name, etc.), the audit row should capture WHICH FIELDS
 * CHANGED + their before/after values — not a full record dump. That way:
 *   - Insurance auditors can reconstruct the change without combing diffs.
 *   - PHI fields can be denylisted at the call site (the caller decides which
 *     fields to expose; this helper is field-agnostic).
 *
 * Discipline:
 *   - Only include keys whose value actually changed (string comparison after
 *     JSON.stringify so Date / number / nested-object equality works).
 *   - Caller is responsible for filtering PHI-bearing fields BEFORE calling
 *     this helper — we don't have field-level PHI metadata at this layer.
 *   - Result is a plain object `{ field: { before, after } }` suitable for
 *     embedding in `AuditLog.metadata` (writeAuditLog runs the PHI denylist
 *     against the resulting object).
 */
export function diffForAudit<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: readonly (keyof T)[],
): Record<string, { before: unknown; after: unknown }> {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of fields) {
    const beforeVal = before[field] ?? null;
    const afterVal = after[field] ?? null;
    if (!isDeepEqual(beforeVal, afterVal)) {
      out[String(field)] = {
        before: normalizeForAudit(beforeVal),
        after: normalizeForAudit(afterVal),
      };
    }
  }
  return out;
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeForAudit(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Convenience: returns just the list of changed field names. Use when the
 * caller wants to log "what changed" without the values themselves (e.g.,
 * org settings updates may want field names only).
 */
export function changedFieldsForAudit<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: readonly (keyof T)[],
): string[] {
  return Object.keys(diffForAudit(before, after, fields));
}

/**
 * Unit 34 — single-field change shortcut.
 *
 * Returns a `{ field: { before, after } }` envelope suitable for nesting
 * under `metadata.changes`. Use when the mutation only moves ONE field
 * (status transitions, individual flag flips) so the audit metadata stays
 * uniform with the `diffForAudit` output that other routes emit.
 *
 * Result is the inner map ONLY — the caller wraps it under `changes`:
 *
 *   metadata: {
 *     changes: {
 *       ...singleFieldChange('status', before.status, after.status),
 *       ...singleFieldChange('recertDueAt', before.due, after.due),
 *     },
 *     otherMeta: ...,
 *   }
 *
 * Skips the field entirely if before === after (deep-equal via
 * JSON.stringify, same as diffForAudit), so the caller doesn't have to
 * pre-check.
 */
export function singleFieldChange(
  field: string,
  before: unknown,
  after: unknown,
): Record<string, { before: unknown; after: unknown }> {
  const beforeNorm = before instanceof Date ? before.toISOString() : before ?? null;
  const afterNorm = after instanceof Date ? after.toISOString() : after ?? null;
  if (JSON.stringify(beforeNorm) === JSON.stringify(afterNorm)) return {};
  return { [field]: { before: beforeNorm, after: afterNorm } };
}
