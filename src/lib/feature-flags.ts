/**
 * Per-org feature flags.
 *
 * Single read-side helper around the `FeatureFlag` Prisma model (one row
 * per `(orgId, key)`). Used by callers that want to gate UI surfaces or
 * code paths without shipping a new column on `Organization` every time.
 *
 * Storage shape:
 *   FeatureFlag { orgId, key: string, value: Json }
 *   @@unique([orgId, key])
 *
 * The `value` column is opaque JSON so callers can store either a plain
 * boolean (the 95% case) OR a richer config object (e.g. `{ enabled: true,
 * rolloutPercent: 25 }`) without a schema migration.
 *
 * Conventions:
 *   - Keys are dotted lower-case strings: `cleo.caseRule.v1`,
 *     `billing.duoPlan.v1`, etc. Versioned suffix lets us flip a v1 off
 *     while turning a v2 on without orphaning audit rows.
 *   - Absence of a row means "feature off" — never "fail closed by error".
 *   - The helper never throws. A Prisma error degrades to `false` so a
 *     temporary DB hiccup never globally flips a feature on.
 *   - Boolean truthiness is normalized: `true`, the string `"true"`, and
 *     `{ enabled: true }` all count. Everything else (null, 0, undefined,
 *     etc.) is `false`. Keeps the call sites tidy.
 *
 * NOT a global allowlist of valid keys. Callers pass any string; we
 * trust the caller to spell the key correctly. A typo silently means
 * "feature off" — same blast radius as forgetting to seed the flag row.
 */

import { prisma as defaultPrisma } from '@/lib/prisma';
import type { Prisma, PrismaClient } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Returns `true` iff the given org has the flag enabled.
 *
 * Pass a transaction client when calling from inside `$transaction` so
 * the read participates in the surrounding tx's snapshot. Without a tx
 * the default prisma client is used.
 */
export async function isFeatureEnabled(
  orgId: string,
  key: string,
  tx?: DbClient,
): Promise<boolean> {
  const db = tx ?? defaultPrisma;
  try {
    const row = await db.featureFlag.findUnique({
      where: { orgId_key: { orgId, key } },
      select: { value: true },
    });
    return isTruthyFlagValue(row?.value);
  } catch {
    // Fail-closed: a Prisma outage MUST NOT silently flip a gated
    // feature on. The caller treats `false` as "feature off"; that's
    // the safe default for any flag that isn't explicitly opt-in.
    return false;
  }
}

/**
 * Pure normalizer exported for unit tests + callers that already hold a
 * loaded `FeatureFlag.value` (e.g., a page that batch-loads several
 * flags via `findMany`).
 *
 * Truthy:
 *   - boolean `true`
 *   - string `"true"` (case-insensitive — "True", "TRUE" all match)
 *   - object `{ enabled: true }`
 *   - object `{ enabled: "true" }` (recursive check on enabled key)
 *
 * Everything else (null, undefined, 0, "false", `{ enabled: false }`,
 * arrays, strings other than "true") is `false`.
 */
export function isTruthyFlagValue(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const enabled = (value as { enabled?: unknown }).enabled;
    if (enabled === true) return true;
    if (typeof enabled === 'string') return enabled.toLowerCase() === 'true';
  }
  return false;
}

// ---------------------------------------------------------------------------
// Known flag keys — central registry so a typo on a call site shows up as a
// TypeScript narrowing failure, not silently as "feature off".
//
// Adding a new flag is one line here + a row in the FeatureFlag table for
// any org that should have it on. The registry is informational; the
// helper itself accepts any string.
// ---------------------------------------------------------------------------

export const FEATURE_FLAG_KEYS = {
  /**
   * Unit 49 — gates the Cleo case-division UX surfaces (pre-visit
   * case-nominator badge §F, pre-sign intent-fit chip §G, post-sign
   * biller advisory card PR3). The underlying rule (cases pinned to a
   * division, 403s on cross-division write, brief/triage filters)
   * ships UNFLAGGED — only the new Cleo-authored UI hints sit behind
   * this key. Lets the rule soak in prod (via audit logs) before
   * introducing new clinician-facing surfaces.
   */
  CLEO_CASE_RULE_V1: 'cleo.caseRule.v1',
} as const;

export type KnownFeatureFlagKey =
  (typeof FEATURE_FLAG_KEYS)[keyof typeof FEATURE_FLAG_KEYS];
