import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writePlatformAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const createSchema = z.object({
  title: z.string().min(1).max(160),
  body: z.string().min(1).max(8000),
  severity: z.enum(['info', 'warning', 'critical']),
  targetOrgIds: z.array(z.string().min(1)).max(500),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1).nullable().optional(),
});

/**
 * GET / POST /api/owner/announcements
 *
 * SystemAnnouncement is a platform-level model — owner CRUD only.
 * `targetOrgIds: []` means "visible to all orgs." The schedule window
 * (startsAt / endsAt) is enforced at render time by future surfaces
 * (Unit 33 banner); v1 stores the records and exposes the management
 * surface only.
 */
export async function GET() {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;

  const rows = await prisma.systemAnnouncement.findMany({
    orderBy: { startsAt: 'desc' },
    take: 200,
  });
  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      severity: r.severity,
      targetOrgIds: r.targetOrgIds,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      createdByUserId: r.createdByUserId,
    })),
  });
}

export async function POST(req: Request) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user: actor } = guard;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const startsAt = new Date(parsed.data.startsAt);
  const endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
  if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Invalid date.' } },
      { status: 400 },
    );
  }
  if (endsAt && endsAt <= startsAt) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'endsAt must be after startsAt.' } },
      { status: 400 },
    );
  }

  const row = await prisma.systemAnnouncement.create({
    data: {
      title: parsed.data.title,
      body: parsed.data.body,
      severity: parsed.data.severity,
      targetOrgIds: parsed.data.targetOrgIds,
      startsAt,
      endsAt,
      createdByUserId: actor.id ?? 'unknown',
    },
  });

  await writePlatformAuditLog({
    actingUserId: actor.id ?? 'unknown',
    action: 'ANNOUNCEMENT_CREATED',
    resourceType: 'SystemAnnouncement',
    resourceId: row.id,
    metadata: {
      severity: row.severity,
      targetOrgCount: row.targetOrgIds.length,
      hasEndsAt: !!row.endsAt,
    },
  });

  return NextResponse.json({ data: row }, { status: 201 });
}
