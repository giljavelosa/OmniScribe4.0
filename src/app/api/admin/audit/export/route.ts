import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const MAX_EXPORT_ROWS = 10_000;

/**
 * GET /api/admin/audit/export — CSV download for the org's audit log.
 *
 * Same filter shape as the list endpoint. Streams up to MAX_EXPORT_ROWS;
 * if the filter matches more, the response truncates and adds a
 * `# truncated_at` header row so the auditor sees the limit clearly.
 *
 * Hand-rolled CSV writer (no papaparse dep yet) — RFC 4180 quoting:
 * fields containing comma / quote / newline are wrapped in quotes and
 * internal quotes are doubled. Caller is responsible for the filename
 * (we set Content-Disposition with a date-stamped default).
 */
export async function GET(req: Request) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const url = new URL(req.url);
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  const action = url.searchParams.get('action');
  const userId = url.searchParams.get('userId');
  const resourceId = url.searchParams.get('resourceId')?.slice(0, 64) ?? null;

  const fromDate = fromStr ? safeDate(fromStr) : null;
  const toDate = toStr ? safeDate(toStr) : null;

  const rows = await prisma.auditLog.findMany({
    where: {
      orgId: authorizationUser.orgId,
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
      ...(action ? { action } : {}),
      ...(userId ? { userId } : {}),
      ...(resourceId ? { resourceId: { contains: resourceId, mode: 'insensitive' } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_EXPORT_ROWS + 1,
  });

  const truncated = rows.length > MAX_EXPORT_ROWS;
  const visible = truncated ? rows.slice(0, MAX_EXPORT_ROWS) : rows;

  const userIds = Array.from(new Set(visible.map((r) => r.userId).filter(Boolean) as string[]));
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
    : [];
  const emailByUserId = new Map(users.map((u) => [u.id, u.email]));

  const headerRow = ['created_at', 'user_id', 'user_email', 'action', 'resource_type', 'resource_id', 'metadata_json'];
  const lines = [headerRow.map(csvField).join(',')];
  for (const r of visible) {
    lines.push(
      [
        r.createdAt.toISOString(),
        r.userId ?? '',
        r.userId ? emailByUserId.get(r.userId) ?? '' : '',
        r.action,
        r.resourceType ?? '',
        r.resourceId ?? '',
        r.metadata ? JSON.stringify(r.metadata) : '',
      ]
        .map(csvField)
        .join(','),
    );
  }
  if (truncated) {
    lines.push(`# truncated_at,${MAX_EXPORT_ROWS},rows,total_more_available`);
  }
  const body = lines.join('\n') + '\n';

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'AUDIT_LOG_EXPORTED',
    resourceType: 'AuditLog',
    resourceId: 'export',
    metadata: {
      rowCount: visible.length,
      truncated,
      filters: {
        hasFrom: !!fromDate,
        hasTo: !!toDate,
        action: action ?? null,
        hasUserId: !!userId,
        hasResourceId: !!resourceId,
      },
    },
  });

  const filename = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

function csvField(value: string): string {
  const v = String(value ?? '');
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function safeDate(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
