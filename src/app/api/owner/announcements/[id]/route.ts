import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writePlatformAuditLog } from '@/lib/audit/log';
import { diffForAudit } from '@/lib/audit/diff';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    title: z.string().min(1).max(160).optional(),
    body: z.string().min(1).max(8000).optional(),
    severity: z.enum(['info', 'warning', 'critical']).optional(),
    targetOrgIds: z.array(z.string().min(1)).max(500).optional(),
    startsAt: z.string().min(1).optional(),
    endsAt: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no_fields' });

const FIELDS = ['title', 'body', 'severity', 'targetOrgIds', 'startsAt', 'endsAt'] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user: actor } = guard;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const before = await prisma.systemAnnouncement.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.body !== undefined) updates.body = parsed.data.body;
  if (parsed.data.severity !== undefined) updates.severity = parsed.data.severity;
  if (parsed.data.targetOrgIds !== undefined) updates.targetOrgIds = parsed.data.targetOrgIds;
  if (parsed.data.startsAt !== undefined) {
    const d = new Date(parsed.data.startsAt);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Invalid startsAt.' } },
        { status: 400 },
      );
    }
    updates.startsAt = d;
  }
  if (parsed.data.endsAt !== undefined) {
    if (parsed.data.endsAt === null) {
      updates.endsAt = null;
    } else {
      const d = new Date(parsed.data.endsAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: { code: 'bad_request', message: 'Invalid endsAt.' } },
          { status: 400 },
        );
      }
      updates.endsAt = d;
    }
  }

  const after = await prisma.systemAnnouncement.update({ where: { id }, data: updates });

  const changes = diffForAudit(
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>,
    FIELDS,
  );
  if (Object.keys(changes).length > 0) {
    await writePlatformAuditLog({
      actingUserId: actor.id ?? 'unknown',
      action: 'ANNOUNCEMENT_UPDATED',
      resourceType: 'SystemAnnouncement',
      resourceId: id,
      metadata: { changes },
    });
  }

  return NextResponse.json({ data: after });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user: actor } = guard;

  const { id } = await params;
  const existing = await prisma.systemAnnouncement.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  await prisma.systemAnnouncement.delete({ where: { id } });
  await writePlatformAuditLog({
    actingUserId: actor.id ?? 'unknown',
    action: 'ANNOUNCEMENT_DELETED',
    resourceType: 'SystemAnnouncement',
    resourceId: id,
    metadata: {
      severity: existing.severity,
      targetOrgCount: existing.targetOrgIds.length,
    },
  });

  return NextResponse.json({ data: { ok: true } });
}
