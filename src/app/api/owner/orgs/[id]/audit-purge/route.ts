import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { purgeAuditForOrg } from '@/lib/audit/retention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/owner/orgs/[id]/audit-purge — Unit 34.
 *
 * Manual trigger for the per-org audit purge. Owner-only. Synchronous —
 * returns the PurgeResult on completion. Batches in 5k chunks inside
 * the retention module so a large org doesn't lock the table.
 *
 * The AUDIT_PURGE_RUN audit row is written by the retention module on
 * the org's behalf (orgId is the org being purged; actor is system —
 * we don't attribute the receipt row to the owner who triggered
 * because the receipt's intent is "what was purged" not "who pressed
 * the button"). The owner's button-press is implicit in the PR
 * timeline + can be deduced from the synchronous request log if
 * needed.
 *
 * 409 when the org has no auditRetentionDays set — caller should
 * configure retention first via /audit-retention.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;

  const { id } = await params;
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { id: true, auditRetentionDays: true },
  });
  if (!org) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  if (org.auditRetentionDays == null) {
    return NextResponse.json(
      {
        error: {
          code: 'no_retention',
          message:
            'Org has no auditRetentionDays set. Configure retention first via /audit-retention.',
        },
      },
      { status: 409 },
    );
  }

  const result = await purgeAuditForOrg(id);
  return NextResponse.json({ data: result });
}
