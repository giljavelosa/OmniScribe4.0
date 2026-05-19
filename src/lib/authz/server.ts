/**
 * requireFeatureAccess — the sole authorization chokepoint for API routes.
 *
 * Behavior:
 *   1. 401 if no session.
 *   2. 403 `mfa_required` if Organization.forceMfa && !user.mfaEnabled
 *      (D2 also enforces this for any sign-in, but a JWT minted before
 *      forceMfa was flipped on for the org still needs to be rejected at
 *      the API surface.)
 *   3. Re-loads OrgUser FRESH from DB (avoids stale JWT — role might have
 *      changed since the token was issued).
 *   4. 403 `forbidden` if `!canUseFeature(featureKey, authorizationUser)`.
 *   5. POLISH (post-Unit 32): when a `req` is passed, also enforces the
 *      impersonation read-only gate via `assertNotImpersonating`. This
 *      writes the IMPERSONATION_BLOCKED_MUTATION audit row on block.
 *      The middleware in `src/middleware.ts` blocks structurally at
 *      the edge for ALL /api/* paths regardless; passing `req` here
 *      adds audit fidelity (route-level visibility into which feature
 *      was attempted).
 *   6. Returns { user, orgUser, authorizationUser } on success.
 *
 * Spec §H. Anti-regression rule reminder: every PHI query MUST include orgId
 * in its WHERE clause — see assertOrgScoped() in src/lib/phi-access.ts.
 */

import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import type { OrgUser, OrgRole } from '@prisma/client';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { assertNotImpersonating } from '@/lib/audit/impersonation';
import { canUseFeature } from './internal-authorization';
import type { FeatureKey, AuthorizationUser } from './types';

const ADMIN_ROLES: OrgRole[] = ['ORG_ADMIN', 'SITE_ADMIN'];

export type RequireFeatureAccessOk = {
  user: Session['user'];
  orgUser: OrgUser;
  authorizationUser: AuthorizationUser;
};

export type RequireFeatureAccessResult = RequireFeatureAccessOk | { error: NextResponse };

function err(code: string, status: number) {
  return { error: NextResponse.json({ error: { code } }, { status }) };
}

export async function requireFeatureAccess(
  featureKey: FeatureKey,
  /**
   * POLISH (post-Unit 32) — when present, the gate also enforces the
   * impersonation read-only mutation block + writes the
   * IMPERSONATION_BLOCKED_MUTATION audit row when triggered. Optional
   * for backward compatibility: existing callers that don't pass `req`
   * still get the auth + feature check; the middleware in
   * src/middleware.ts blocks structurally either way. Passing `req`
   * adds the per-route audit fidelity.
   */
  req?: Request,
): Promise<RequireFeatureAccessResult> {
  const session = await auth();
  if (!session?.user) return err('unauthenticated', 401);

  if (!session.user.orgId || !session.user.orgUserId) return err('no_org', 403);

  // Fresh DB read — JWT may carry stale role/division after admin changes.
  const orgUser = await prisma.orgUser.findUnique({
    where: { id: session.user.orgUserId },
    include: { organization: true },
  });
  if (!orgUser || !orgUser.isActive) return err('forbidden', 403);

  if (orgUser.organization.forceMfa && !session.user.mfaEnabled) {
    return err('mfa_required', 403);
  }

  // Block API access for users who have MFA enabled but haven't completed the
  // challenge in this session. The UI layout enforces the MFA redirect chain
  // for HTML routes, but a session cookie minted before challenge completion
  // could otherwise call any API route directly. Endpoints that legitimately
  // run before MFA challenge (e.g., /api/auth/mfa/verify itself) use their
  // own auth path and do not flow through requireFeatureAccess.
  if (session.user.mfaEnabled && !session.user.mfaVerified) {
    return err('mfa_not_verified', 403);
  }

  const authorizationUser: AuthorizationUser = {
    userId: session.user.id,
    orgUserId: orgUser.id,
    orgId: orgUser.orgId,
    role: orgUser.role,
    division: orgUser.division,
    platformRole: session.user.platformRole,
    canManagePatients: orgUser.canManagePatients,
  };

  if (!canUseFeature(featureKey, authorizationUser)) {
    return err('forbidden', 403);
  }

  // POLISH — impersonation read-only mutation gate. Runs AFTER the
  // role/feature checks pass so the audit row reflects "this user
  // HAD permission but the impersonation gate refused" (not
  // "unauthorized + impersonation"). Middleware will have already
  // short-circuited if the JWT has an active impersonation, but
  // routes hit during a stale cookie window can still reach here.
  if (req) {
    const impCheck = await assertNotImpersonating(req);
    if ('error' in impCheck) return impCheck;
  }

  return { user: session.user, orgUser, authorizationUser };
}

/**
 * Legacy helper kept for Commit 10's invites route until it migrates to
 * requireFeatureAccess('TEAM_MEMBERS_MANAGE'). Internally now delegates to
 * the matrix so behavior is consistent.
 */
export async function requireAdminOrgRole(): Promise<
  { user: Session['user']; orgUser: OrgUser } | { error: NextResponse }
> {
  const r = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in r) return r;
  // Belt-and-suspenders: confirm role is in ADMIN_ROLES even if matrix says yes.
  if (!ADMIN_ROLES.includes(r.orgUser.role)) return err('forbidden', 403);
  return { user: r.user, orgUser: r.orgUser };
}
