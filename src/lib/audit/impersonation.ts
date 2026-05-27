/**
 * assertNotImpersonating + writeImpersonatableAudit — Unit 32.
 *
 * The proxy (`src/proxy.ts`) is the structural guarantee that
 * impersonation sessions can't mutate; this helper is the route-level
 * fallback for paths the middleware matcher doesn't cover (e.g. server
 * actions) AND the source of the IMPERSONATION_BLOCKED_MUTATION audit
 * row when the gate fires.
 *
 * Routes new in Unit 32 invoke this explicitly after their feature
 * gate. Existing routes (units 1-31) will be migrated in a follow-up
 * sweep — the middleware covers them at the edge in the meantime.
 */

import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { writeAuditLog, writePlatformAuditLog, type AuditEntry } from './log';
import {
  readActiveImpersonation,
  shouldBlockUnderImpersonation,
  type ImpersonationContext,
} from '@/lib/impersonation';

/**
 * Route-level read-only gate during an active impersonation session.
 *
 * Pass the request so the helper can read `method` + `pathname` and
 * apply the same allowlist the middleware uses. Returns `{ error:
 * NextResponse }` on block, `{ ok: true, impersonation }` otherwise —
 * the impersonation context is returned so the route can attach it to
 * audit rows it writes during read paths.
 *
 * Always writes `IMPERSONATION_BLOCKED_MUTATION` on block (one row per
 * blocked attempt). Auditor uses the row count to quantify how often
 * the gate actually fires — high count means owners are pushing on the
 * read-only constraint + we may need to design scoped mutations in v2.
 */
export type AssertNotImpersonatingResult =
  | { ok: true; impersonation: ImpersonationContext | null }
  | { error: NextResponse };

export async function assertNotImpersonating(
  req: Request,
): Promise<AssertNotImpersonatingResult> {
  const session = await auth();
  const impersonation = readActiveImpersonation(
    // session.impersonation is already validated for expiry by the
    // session callback, but we re-derive here so this helper doesn't
    // rely on callback ordering.
    session?.impersonation ? { impersonation: session.impersonation } : null,
  );
  const url = new URL(req.url);
  if (
    shouldBlockUnderImpersonation({
      method: req.method,
      pathname: url.pathname,
      impersonation,
    })
  ) {
    // session.user is guaranteed to be present when impersonation is
    // active (impersonation can't be set without auth) — but defensive
    // check keeps TS happy.
    if (session?.user?.id) {
      await writePlatformAuditLog({
        actingUserId: session.user.id,
        action: 'IMPERSONATION_BLOCKED_MUTATION',
        resourceType: 'Impersonation',
        resourceId: impersonation!.targetOrgId,
        metadata: {
          targetUserId: impersonation!.targetUserId,
          targetOrgId: impersonation!.targetOrgId,
          method: req.method,
          path: url.pathname,
        },
      });
    }
    return {
      error: NextResponse.json(
        { error: { code: 'impersonation_read_only' } },
        { status: 403 },
      ),
    };
  }
  return { ok: true, impersonation };
}

/**
 * Audit writer that threads the active impersonation context. Use this
 * for READ-path audit rows minted during an impersonation session
 * (e.g. PATIENT_VIEWED while the owner is observing the target user's
 * chart). Mutations are gated by `assertNotImpersonating` upstream so
 * they never reach this helper.
 *
 * When no impersonation is active, behaves identically to writeAuditLog.
 *
 * Threading rule:
 *   - userId = target user (so the row appears in the target's own
 *     audit history — preserves "from the target's perspective" view).
 *   - actingUserId = owner (so the auditor can answer "was this a
 *     real user action or an owner-driven impersonation?").
 *   - onBehalfOfUserId = target (mirrors actingUserId for the
 *     reverse-lookup case).
 */
export async function writeImpersonatableAudit(
  entry: Omit<AuditEntry, 'actingUserId' | 'onBehalfOfUserId'> & {
    /** Caller's resolved userId — used when no impersonation is
     *  active (which is the common case). */
    userId: string;
  },
): Promise<void> {
  const session = await auth();
  const imp = readActiveImpersonation(
    session?.impersonation ? { impersonation: session.impersonation } : null,
  );
  if (!imp || !session?.user?.id) {
    await writeAuditLog(entry);
    return;
  }
  await writeAuditLog({
    ...entry,
    userId: imp.targetUserId,
    actingUserId: session.user.id,
    onBehalfOfUserId: imp.targetUserId,
  });
}
