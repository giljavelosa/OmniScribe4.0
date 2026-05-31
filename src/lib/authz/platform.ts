import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import type { PlatformRole } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export type RequirePlatformOwnerOk = { user: Session['user'] };
export type RequirePlatformOwnerResult = RequirePlatformOwnerOk | { error: NextResponse };

export async function requirePlatformOwner(): Promise<RequirePlatformOwnerResult> {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 }) };
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { platformRole: true, isDeleted: true },
  });
  if (!user || user.isDeleted || user.platformRole !== 'PLATFORM_OWNER') {
    return { error: NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 }) };
  }
  // Sprint 0.20 — MFA + login-verified gates removed; password-only auth.
  return { user: session.user };
}

/**
 * Unit 33 — Allows PLATFORM_OWNER OR PLATFORM_OPS. Use for `/ops/*`
 * surfaces (dashboard, queues, health, audit search). Owner remains
 * the strict superset — owner-only surfaces (`/owner/*`) keep using
 * `requirePlatformOwner` unchanged.
 *
 * Sprint 0.20 — MFA + login-verified gates removed; only role check
 * remains. Returning the role on the result lets callers branch UI
 * affordances (e.g. surface "Begin impersonation" only for OWNER).
 */
export type RequirePlatformStaffOk = {
  user: Session['user'];
  role: Extract<PlatformRole, 'PLATFORM_OWNER' | 'PLATFORM_OPS'>;
};
export type RequirePlatformStaffResult =
  | RequirePlatformStaffOk
  | { error: NextResponse };

const STAFF_ROLES: PlatformRole[] = ['PLATFORM_OWNER', 'PLATFORM_OPS'];

export async function requirePlatformStaff(): Promise<RequirePlatformStaffResult> {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 }) };
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { platformRole: true, isDeleted: true },
  });
  if (!user || user.isDeleted || !STAFF_ROLES.includes(user.platformRole)) {
    return { error: NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 }) };
  }
  // Sprint 0.20 — MFA + login-verified gates removed; password-only auth.
  return {
    user: session.user,
    role: user.platformRole as 'PLATFORM_OWNER' | 'PLATFORM_OPS',
  };
}
