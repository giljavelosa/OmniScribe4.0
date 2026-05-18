import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

/**
 * GET /api/admin/audit — read the org's audit log with filters.
 *
 * Query params (all optional):
 *   from        — ISO date inclusive
 *   to          — ISO date inclusive
 *   action      — exact match on AuditLog.action (one of the union)
 *   userId      — exact match on the acting user
 *   resourceId  — substring match on AuditLog.resourceId
 *   limit       — 1..100 (default 50)
 *   cursor      — id of the last row from the prior page (forward pagination)
 *
 * Returns `{ data: rows[], nextCursor: string | null }`. Each row includes
 * the actor's email when known (joined from User).
 *
 * Audited: every read writes AUDIT_LOG_VIEWED with the filter shape. Yes,
 * we audit the audit log — that's the contract for HIPAA business-associate
 * posture (insurance auditors can verify who looked at what).
 */
export async function GET(req: Request) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const url = new URL(req.url);
  const filter = parseFilter(url);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, filter.limit ?? DEFAULT_PAGE_SIZE));
  const cursor = url.searchParams.get('cursor');

  const rows = await prisma.auditLog.findMany({
    where: {
      orgId: authorizationUser.orgId,
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
    take: limit + 1, // +1 to detect "more available"
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  const userIds = Array.from(new Set(page.map((r) => r.userId).filter(Boolean) as string[]));
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
    : [];
  const emailByUserId = new Map(users.map((u) => [u.id, u.email]));

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'AUDIT_LOG_VIEWED',
    resourceType: 'AuditLog',
    resourceId: 'list',
    metadata: {
      filters: {
        hasFrom: !!filter.from,
        hasTo: !!filter.to,
        action: filter.action ?? null,
        // Capture filter shape, not the actual id being searched for — the
        // audit-meta read should not re-leak the resource identifier under
        // investigation (matches the export endpoint's hasUserId pattern).
        hasUserId: !!filter.userId,
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
    resourceId: url.searchParams.get('resourceId')?.slice(0, 64) ?? null,
    limit: Number(url.searchParams.get('limit')) || null,
  };
}

function safeDate(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
