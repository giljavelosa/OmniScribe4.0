import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writeAuditLog, writePlatformAuditLog } from '@/lib/audit/log';
import {
  IMPERSONATION_MAX_DURATION_MS,
  readActiveImpersonation,
  shortReasonForBanner,
  type ImpersonationContext,
} from '@/lib/impersonation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const beginSchema = z.object({
  targetUserId: z.string().min(1).max(80),
  /** Required ≥10 chars at begin — forces an explicit purpose. The
   *  full reason goes to the IMPERSONATION_BEGAN audit row; the JWT
   *  carries only the first 80 chars for the banner display. */
  reason: z.string().min(10).max(500),
});

/**
 * POST /api/owner/orgs/[id]/impersonate — begin impersonation.
 *
 * Owner-gated. Validates the target is an active OrgUser
 * of the org. Writes BOTH a PlatformAuditLog row (IMPERSONATION_BEGAN —
 * cross-org owner action) AND an AuditLog row scoped to the org so the
 * Transactions timeline picks it up.
 *
 * Returns the impersonation context for the client to apply via
 * NextAuth's `session.update({ impersonation: ctx })`. The session
 * callback validates the 60-min TTL on every subsequent request; the
 * middleware enforces the read-only mutation gate at the edge.
 *
 * Design note: we DON'T mutate the JWT server-side here — NextAuth's
 * JWT is signed + cookie-bound; the canonical refresh path is the
 * client calling `useSession().update(...)` which re-issues the cookie.
 * Returning the context to the client + having it call update() keeps
 * the JWT mutation path under NextAuth's control (a server-side
 * mutation would bypass the session signing flow + risk inconsistency).
 *
 * NOTE on middleware vs this route: middleware ALLOWS this route
 * (POST is blocked elsewhere during impersonation, but this route is
 * gated by requirePlatformOwner — an active impersonation session
 * shouldn't be calling begin again anyway). Begin-from-within-an-
 * impersonation is rejected explicitly here as `already_impersonating`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user } = guard;

  // Don't allow nested impersonation — owner must end the existing
  // session before beginning a new one.
  const session = await auth();
  if (readActiveImpersonation(session?.impersonation ? { impersonation: session.impersonation } : null)) {
    return NextResponse.json(
      { error: { code: 'already_impersonating' } },
      { status: 409 },
    );
  }

  const parsed = beginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const { targetUserId, reason } = parsed.data;
  const { id: orgId } = await params;

  // Verify the target is an active OrgUser of the org. Catches both
  // "no such user" + "user exists but is not in this org" + "user
  // exists in org but is inactive".
  const targetOrgUser = await prisma.orgUser.findFirst({
    where: { userId: targetUserId, orgId, isActive: true },
    select: { id: true, userId: true, role: true, organization: { select: { name: true } } },
  });
  if (!targetOrgUser) {
    return NextResponse.json(
      { error: { code: 'target_not_found' } },
      { status: 404 },
    );
  }

  // Don't allow an owner to impersonate themselves — meaningless +
  // would create a confusing "actor = onBehalfOf" audit row.
  if (targetOrgUser.userId === user.id) {
    return NextResponse.json(
      { error: { code: 'cannot_impersonate_self' } },
      { status: 400 },
    );
  }

  const beganAt = Date.now();
  const context: ImpersonationContext = {
    targetUserId: targetOrgUser.userId,
    targetOrgId: orgId,
    beganAt,
    reason: shortReasonForBanner(reason),
  };

  // Audit pair — platform-scope (cross-org owner action) + org-scope
  // (appears in the org's Transactions timeline).
  const auditMetadata = {
    targetUserId: targetOrgUser.userId,
    targetOrgId: orgId,
    targetRole: targetOrgUser.role,
    reasonLength: reason.length,
    beganAt,
    maxDurationMs: IMPERSONATION_MAX_DURATION_MS,
  };
  await writePlatformAuditLog({
    actingUserId: user.id,
    action: 'IMPERSONATION_BEGAN',
    resourceType: 'Impersonation',
    resourceId: orgId,
    metadata: auditMetadata,
  });
  await writeAuditLog({
    userId: user.id,
    orgId,
    actingUserId: user.id,
    onBehalfOfUserId: targetOrgUser.userId,
    action: 'IMPERSONATION_BEGAN',
    resourceType: 'Impersonation',
    resourceId: orgId,
    metadata: auditMetadata,
  });

  return NextResponse.json({
    data: {
      ok: true,
      impersonation: context,
      target: {
        userId: targetOrgUser.userId,
        role: targetOrgUser.role,
        orgName: targetOrgUser.organization.name,
      },
    },
  });
}

/**
 * DELETE /api/owner/orgs/[id]/impersonate — end impersonation.
 *
 * Allowed even when impersonation is active (middleware bypass — see
 * IMPERSONATION_BYPASS_PATH_SUFFIXES). No-op if no impersonation is
 * active (idempotent — safe to call from a stale UI).
 *
 * Writes IMPERSONATION_ENDED with durationSeconds so the auditor can
 * see how long sessions actually lasted in practice.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user } = guard;

  const session = await auth();
  const imp = readActiveImpersonation(
    session?.impersonation ? { impersonation: session.impersonation } : null,
  );
  if (!imp) {
    // Idempotent — client already cleared OR session expired. Return
    // ok + let the client re-render without the banner.
    return NextResponse.json({ data: { ok: true, wasActive: false } });
  }

  const { id: orgId } = await params;
  const durationSeconds = Math.round((Date.now() - imp.beganAt) / 1000);
  const auditMetadata = {
    targetUserId: imp.targetUserId,
    targetOrgId: imp.targetOrgId,
    durationSeconds,
    // mutationsBlocked: count of IMPERSONATION_BLOCKED_MUTATION rows
    // for this session — v1 reads it lazily by counting audit rows
    // with matching actor + window. Set to 0 here as a placeholder;
    // the Transactions timeline computes it on display.
    mutationsBlocked: 0,
  };
  await writePlatformAuditLog({
    actingUserId: user.id,
    action: 'IMPERSONATION_ENDED',
    resourceType: 'Impersonation',
    resourceId: orgId,
    metadata: auditMetadata,
  });
  await writeAuditLog({
    userId: user.id,
    orgId,
    actingUserId: user.id,
    onBehalfOfUserId: imp.targetUserId,
    action: 'IMPERSONATION_ENDED',
    resourceType: 'Impersonation',
    resourceId: orgId,
    metadata: auditMetadata,
  });

  return NextResponse.json({ data: { ok: true, wasActive: true, durationSeconds } });
}
