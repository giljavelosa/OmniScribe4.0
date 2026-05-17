import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writeAuditLog, writePlatformAuditLog } from '@/lib/audit/log';
import { ComplianceProfile } from '@prisma/client';

export const runtime = 'nodejs';

const bodySchema = z.object({
  baaExecutedAt: z.string().min(1),
  baaVersion: z.string().min(1),
  complianceProfile: z.enum(ComplianceProfile),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const data = parsed.data;
  const date = new Date(data.baaExecutedAt);
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: { code: 'bad_request', message: 'Invalid date.' } }, { status: 400 });
  }

  const { id } = await params;
  const before = await prisma.organization.findUnique({
    where: { id },
    select: { baaExecutedAt: true, baaVersion: true, complianceProfile: true },
  });
  if (!before) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  await prisma.organization.update({
    where: { id },
    data: {
      baaExecutedAt: date,
      baaVersion: data.baaVersion,
      baaCountersignedBy: user.id,
      complianceProfile: data.complianceProfile,
    },
  });

  const beforePayload = {
    baaVersion: before.baaVersion,
    baaExecutedAt: before.baaExecutedAt?.toISOString() ?? null,
    complianceProfile: before.complianceProfile,
  };
  const afterPayload = {
    baaVersion: data.baaVersion,
    baaExecutedAt: date.toISOString(),
    complianceProfile: data.complianceProfile,
  };

  await writeAuditLog({
    userId: user.id,
    orgId: id,
    action: 'ORG_BAA_UPDATED',
    resourceType: 'Organization',
    resourceId: id,
    metadata: { before: beforePayload, after: afterPayload },
  });
  await writePlatformAuditLog({
    actingUserId: user.id,
    action: 'PLATFORM_BAA_UPDATED',
    resourceType: 'Organization',
    resourceId: id,
    metadata: { before: beforePayload, after: afterPayload },
  });

  return NextResponse.json({ data: { ok: true } });
}
