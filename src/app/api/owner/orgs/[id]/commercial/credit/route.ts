import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writeAuditLog, writePlatformAuditLog } from '@/lib/audit/log';
import { creditOrgBank } from '@/lib/billing/visit-ledger';
import { ensureOrganizationCommercialContract } from '@/lib/billing/ensure-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  amount: z.number().int().min(1).max(1_000_000),
  reason: z.string().min(3).max(500),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const org = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
  if (!org) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  await ensureOrganizationCommercialContract(id);

  const { amount, reason } = parsed.data;
  const result = await creditOrgBank({
    orgId: id,
    amount,
    sourceType: 'OWNER_GRANT',
    createdByUserId: user.id,
    metadata: { reasonLength: reason.length },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: id,
    action: 'VISIT_LEDGER_CREDIT',
    resourceType: 'Organization',
    resourceId: id,
    metadata: { amount, orgBankBalance: result.orgBankBalance, reasonLength: reason.length },
  });
  await writePlatformAuditLog({
    actingUserId: user.id,
    action: 'VISIT_LEDGER_CREDIT',
    resourceType: 'Organization',
    resourceId: id,
    metadata: { amount, orgBankBalance: result.orgBankBalance },
  });

  return NextResponse.json({
    data: { orgBankBalance: result.orgBankBalance, entryId: result.entryId },
  });
}
