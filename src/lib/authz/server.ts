/**
 * Authorization helpers — TEMPORARY minimal implementation.
 *
 * Commit 11 replaces this with the full requireFeatureAccess + canUseFeature
 * matrix + PHI scoping. This intermediate helper unblocks Commit 10 (admin
 * invite endpoint) without dragging the full authz surface into one commit.
 */

import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { OrgRole, OrgUser } from '@prisma/client';

const ADMIN_ROLES: OrgRole[] = ['SUPER_ADMIN', 'ORG_ADMIN', 'SITE_ADMIN'];

export type RequireAuthOk = {
  user: Session['user'];
  orgUser: OrgUser;
};

export async function requireAdminOrgRole(): Promise<RequireAuthOk | { error: NextResponse }> {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 }) };
  }
  if (!session.user.orgId || !session.user.orgUserId) {
    return { error: NextResponse.json({ error: { code: 'no_org' } }, { status: 403 }) };
  }
  const orgUser = await prisma.orgUser.findUnique({ where: { id: session.user.orgUserId } });
  if (!orgUser || !orgUser.isActive) {
    return { error: NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 }) };
  }
  if (!ADMIN_ROLES.includes(orgUser.role)) {
    return { error: NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 }) };
  }
  return { user: session.user, orgUser };
}
