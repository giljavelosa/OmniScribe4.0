import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writePlatformAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

/**
 * GET /api/owner/users?q=...&cursor=...
 *
 * Cross-org user search. Joins User + OrgUser + Organization so the table
 * shows email + primary org + role at a glance. Forward-paginated by id.
 *
 * Query `q` matches against email (case-insensitive substring). Empty `q`
 * returns the most recently created users.
 *
 * Audited as PLATFORM_USERS_VIEWED on every call (the metadata shape is
 * filter-only — no resource ids leaked).
 */
export async function GET(req: Request) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user: actor } = guard;

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_PAGE_SIZE));
  const cursor = url.searchParams.get('cursor');

  const users = await prisma.user.findMany({
    where: {
      isDeleted: false,
      ...(q ? { email: { contains: q, mode: 'insensitive' } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: {
      orgUsers: {
        where: { organization: { isDeleted: false } },
        include: { organization: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  const hasMore = users.length > limit;
  const page = hasMore ? users.slice(0, limit) : users;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  await writePlatformAuditLog({
    actingUserId: actor.id ?? 'unknown',
    action: 'PLATFORM_USERS_VIEWED',
    resourceType: 'User',
    resourceId: 'list',
    metadata: { hasQuery: !!q, count: page.length, hasMore },
  });

  return NextResponse.json({
    data: page.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      platformRole: u.platformRole,
      createdAt: u.createdAt.toISOString(),
      orgs: u.orgUsers.map((ou) => ({
        orgId: ou.orgId,
        orgName: ou.organization.name,
        role: ou.role,
        division: ou.division,
        isActive: ou.isActive,
      })),
    })),
    nextCursor,
  });
}
