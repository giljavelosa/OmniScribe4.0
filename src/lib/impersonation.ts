/**
 * Impersonation helpers — Unit 32 / Phase 61.
 *
 * Platform owner can browse the app AS a target user (see what they
 * see) without making mutations. v1 is READ-ONLY: every POST / PATCH /
 * DELETE on a gated route refuses with `impersonation_read_only`.
 *
 * Mechanism: JWT extension on the existing NextAuth session. Owner
 * stays signed in as themselves; the JWT gains an optional
 * `impersonation` block. `assertNotImpersonating` is the route-level
 * structural guarantee + writes IMPERSONATION_BLOCKED_MUTATION when it
 * fires (so the auditor lens can quantify "how often does the gate
 * actually fire?").
 *
 * `src/middleware.ts` runs a thin parallel check at the edge so the
 * 403 short-circuits BEFORE any route handler executes — defense in
 * depth against a route that forgets to invoke the helper.
 *
 * Duration cap: 60 minutes from `beganAt`. Past expiry the
 * impersonation field is treated as null + the JWT is refreshed on
 * next request.
 */

import type { JWT } from 'next-auth/jwt';

/** Per-session impersonation context carried on the NextAuth JWT. */
export type ImpersonationContext = {
  /** OrgUser-scoped target — the user whose chart the owner is observing. */
  targetUserId: string;
  /** Org the target belongs to. Validated server-side at begin-time; the
   *  middleware + route guards treat (targetUserId, targetOrgId) as a
   *  bound pair. */
  targetOrgId: string;
  /** Epoch ms. Used for the 60-minute expiry check. */
  beganAt: number;
  /** First 80 chars of the reason captured at begin. The full reason
   *  lives in the IMPERSONATION_BEGAN audit row; we only carry a slice
   *  on the JWT for the banner display. */
  reason: string;
};

/** Hard cap on impersonation duration — past this the session is
 *  treated as expired and the owner must begin a fresh impersonation.
 *  Prevents a forgotten impersonation from running indefinitely. */
export const IMPERSONATION_MAX_DURATION_MS = 60 * 60 * 1000; // 60 min

/** Methods that REMAIN allowed during an impersonation session. Anything
 *  else returns 403 impersonation_read_only. */
export const IMPERSONATION_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Path suffixes that REMAIN callable during impersonation regardless of
 *  method — currently only the end-impersonation route (so the owner
 *  can actually exit). Match by suffix (not exact) because the route is
 *  `/api/owner/orgs/[id]/impersonate` with `[id]` interpolated. */
export const IMPERSONATION_BYPASS_PATH_SUFFIXES = ['/impersonate'];

/**
 * Reads the impersonation context off a JWT and validates it hasn't
 * expired. Returns null when no impersonation is active OR the session
 * has aged past the duration cap.
 *
 * Callers MUST treat a returned null as "no impersonation" — the
 * caller's JWT may STILL carry the field but it's stale; route handlers
 * should fall back to the owner's own identity.
 */
export function readActiveImpersonation(
  token: Pick<JWT, 'impersonation'> | null | undefined,
  nowMs: number = Date.now(),
): ImpersonationContext | null {
  const imp = token?.impersonation;
  if (!imp) return null;
  const elapsed = nowMs - imp.beganAt;
  if (elapsed < 0 || elapsed > IMPERSONATION_MAX_DURATION_MS) {
    // Expired (or future-dated, which shouldn't happen but is also
    // bogus). Treat as null + let the caller drop the stale field.
    return null;
  }
  return imp;
}

/**
 * Pure predicate — given a request method + pathname + (optional)
 * impersonation context, returns true if the request should be blocked.
 * Used by middleware AND `assertNotImpersonating` so both surfaces
 * share one source of truth.
 */
export function shouldBlockUnderImpersonation(input: {
  method: string;
  pathname: string;
  impersonation: ImpersonationContext | null;
}): boolean {
  if (!input.impersonation) return false;
  if (IMPERSONATION_SAFE_METHODS.has(input.method.toUpperCase())) return false;
  // End-impersonation endpoint must remain reachable.
  if (
    IMPERSONATION_BYPASS_PATH_SUFFIXES.some((suffix) => input.pathname.endsWith(suffix))
  ) {
    return false;
  }
  return true;
}

/**
 * Truncate a reason string for the JWT carry-over slice. The full
 * reason still goes to the audit row; this is what surfaces on the
 * banner so the owner remembers WHY they began impersonating.
 */
export function shortReasonForBanner(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length <= 80) return trimmed;
  return trimmed.slice(0, 80);
}
