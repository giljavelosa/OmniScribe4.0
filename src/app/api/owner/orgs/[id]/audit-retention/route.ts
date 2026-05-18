import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writeAuditLog, writePlatformAuditLog } from '@/lib/audit/log';
import { singleFieldChange } from '@/lib/audit/diff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** Days of retention. null = retain forever. Integer ≥30 enforced. */
  auditRetentionDays: z
    .number()
    .int()
    .min(30)
    .max(3650)
    .nullable(),
});

/**
 * PATCH /api/owner/orgs/[id]/audit-retention — Unit 34.
 *
 * Owner-only. Updates `Organization.auditRetentionDays`. Two-row audit
 * (org-scope + platform-scope) mirrors ORG_SUBSCRIPTION_UPDATED.
 *
 * Compliance posture: too-aggressive purging is the bigger risk than
 * a too-large audit log. Hard floor at 30 days; org's compliance team
 * tunes above that.
 *
 * No retroactive purge on save — admin must explicitly trigger
 * /api/owner/orgs/[id]/audit-purge OR wait for the cron CLI.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const before = await prisma.organization.findUnique({
    where: { id },
    select: { auditRetentionDays: true },
  });
  if (!before) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  await prisma.organization.update({
    where: { id },
    data: { auditRetentionDays: parsed.data.auditRetentionDays },
  });

  const changes = singleFieldChange(
    'auditRetentionDays',
    before.auditRetentionDays,
    parsed.data.auditRetentionDays,
  );

  if (Object.keys(changes).length > 0) {
    await writeAuditLog({
      userId: user.id,
      orgId: id,
      action: 'AUDIT_RETENTION_UPDATED',
      resourceType: 'Organization',
      resourceId: id,
      metadata: { changes },
    });
    await writePlatformAuditLog({
      actingUserId: user.id,
      action: 'AUDIT_RETENTION_UPDATED',
      resourceType: 'Organization',
      resourceId: id,
      metadata: { changes },
    });
  }

  return NextResponse.json({ data: { ok: true } });
}
