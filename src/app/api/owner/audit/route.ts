import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writePlatformAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

/**
 * GET /api/owner/audit — cross-org audit log read.
 *
 * Same filter shape as /api/admin/audit with one addition: `orgId`. Joins
 * Organization for the org-name column. Writes PLATFORM_AUDIT_VIEWED on
 * every call — captures filter SHAPE not values so the meta-audit doesn't
 * re-leak what the owner was searching for.
 */
export async function GET(req: Request) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user: actor } = guard;

  const url = new URL(req.url);
  const filter = parseFilter(url);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, filter.limit ?? DEFAULT_PAGE_SIZE));
  const cursor = url.searchParams.get('cursor');

  const rows = await prisma.auditLog.findMany({
    where: {
      ...(filter.orgId ? { orgId: filter.orgId } : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
      ...(filter.action ? { action: filter.action } : {}),
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.resourceId ? { resourceId: { contains: filter.resourceId, mode: 'insensitive' } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  const userIds = Array.from(new Set(page.map((r) => r.userId).filter(Boolean) as string[]));
  const orgIds = Array.from(new Set(page.map((r) => r.orgId).filter(Boolean) as string[]));

  const [users, orgs] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
      : Promise.resolve([] as Array<{ id: string; email: string }>),
    orgIds.length
      ? prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);
  const emailByUserId = new Map(users.map((u) => [u.id, u.email]));
  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));

  await writePlatformAuditLog({
    actingUserId: actor.id ?? 'unknown',
    action: 'PLATFORM_AUDIT_VIEWED',
    resourceType: 'AuditLog',
    resourceId: 'list',
    metadata: {
      filters: {
        hasFrom: !!filter.from,
        hasTo: !!filter.to,
        action: filter.action ?? null,
        hasUserId: !!filter.userId,
        hasOrgId: !!filter.orgId,
        hasResourceId: !!filter.resourceId,
      },
      count: page.length,
      hasMore,
    },
  });

  return NextResponse.json({
    data: page.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      orgId: r.orgId,
      orgName: r.orgId ? orgNameById.get(r.orgId) ?? null : null,
      userId: r.userId,
      userEmail: r.userId ? emailByUserId.get(r.userId) ?? null : null,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      metadata: r.metadata,
    })),
    nextCursor,
  });
}

function parseFilter(url: URL): {
  from: Date | null;
  to: Date | null;
  action: string | null;
  userId: string | null;
  orgId: string | null;
  resourceId: string | null;
  limit: number | null;
} {
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  return {
    from: fromStr ? safeDate(fromStr) : null,
    to: toStr ? safeDate(toStr) : null,
    action: url.searchParams.get('action') ?? null,
    userId: url.searchParams.get('userId') ?? null,
    orgId: url.searchParams.get('orgId') ?? null,
    resourceId: url.searchParams.get('resourceId')?.slice(0, 64) ?? null,
    limit: Number(url.searchParams.get('limit')) || null,
  };
}

function safeDate(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
