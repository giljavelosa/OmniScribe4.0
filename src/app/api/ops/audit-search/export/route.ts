import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requirePlatformStaff } from '@/lib/authz/platform';
import { writePlatformAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lower cap than `/api/owner/audit/export` (10k) — ops should be doing
 * incident triage, not bulk extraction. Bulk extraction stays an
 * owner-only operation.
 */
const MAX_EXPORT_ROWS = 5_000;

/**
 * GET /api/ops/audit-search/export — Unit 33.
 *
 * CSV export of cross-org audit log filtered by the same filter shape
 * as `/api/ops/audit-search`. PLATFORM_STAFF gate so PLATFORM_OPS can
 * call it; audited via OPS_AUDIT_EXPORTED (distinct from owner's
 * PLATFORM_AUDIT_EXPORTED so the auditor sees which role exported what).
 *
 * Hard cap at 5k rows (vs owner's 10k) — ops triage shouldn't pull
 * full years. Truncation marker appended to the CSV body when hit.
 */
export async function GET(req: Request) {
  const guard = await requirePlatformStaff();
  if ('error' in guard) return guard.error;
  const { user: actor } = guard;

  const url = new URL(req.url);
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  const action = url.searchParams.get('action');
  const userId = url.searchParams.get('userId');
  const orgId = url.searchParams.get('orgId');
  const resourceId = url.searchParams.get('resourceId')?.slice(0, 64) ?? null;

  const fromDate = fromStr ? safeDate(fromStr) : null;
  const toDate = toStr ? safeDate(toStr) : null;

  const rows = await prisma.auditLog.findMany({
    where: {
      ...(orgId ? { orgId } : {}),
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
  const orgIds = Array.from(new Set(visible.map((r) => r.orgId).filter(Boolean) as string[]));
  const [users, orgs] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
      : Promise.resolve([] as Array<{ id: string; email: string }>),
    orgIds.length
      ? prisma.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);
  const emailByUserId = new Map(users.map((u) => [u.id, u.email]));
  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));

  const header = [
    'created_at',
    'org_id',
    'org_name',
    'user_id',
    'user_email',
    'action',
    'resource_type',
    'resource_id',
    'metadata_json',
  ];
  const lines = [header.map(csvField).join(',')];
  for (const r of visible) {
    lines.push(
      [
        r.createdAt.toISOString(),
        r.orgId ?? '',
        r.orgId ? orgNameById.get(r.orgId) ?? '' : '',
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

  await writePlatformAuditLog({
    actingUserId: actor.id ?? 'unknown',
    action: 'OPS_AUDIT_EXPORTED',
    resourceType: 'AuditLog',
    resourceId: 'export',
    metadata: {
      rowCount: visible.length,
      truncated,
      maxAllowed: MAX_EXPORT_ROWS,
      filters: {
        hasFrom: !!fromDate,
        hasTo: !!toDate,
        action: action ?? null,
        hasUserId: !!userId,
        hasOrgId: !!orgId,
        hasResourceId: !!resourceId,
      },
    },
  });

  const filename = `ops-audit-${new Date().toISOString().slice(0, 10)}.csv`;
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
