import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAdminOrgRole } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { transferBankToWallet, VisitLedgerError } from '@/lib/billing/visit-ledger';

export const runtime = 'nodejs';

const bodySchema = z.object({
  action: z.enum(['approve', 'deny']),
  responseNote: z.string().max(500).optional(),
  allocateAmount: z.number().int().min(1).max(100_000).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminOrgRole();
  if ('error' in guard) return guard.error;
  const { user, orgUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const requestRow = await prisma.visitCapacityRequest.findFirst({
    where: { id, orgId: orgUser.orgId },
  });
  if (!requestRow) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  if (requestRow.status !== 'PENDING') {
    return NextResponse.json(
      { error: { code: 'conflict', message: 'Request already resolved.' } },
      { status: 409 },
    );
  }

  const { action, responseNote, allocateAmount } = parsed.data;

  if (action === 'deny') {
    const updated = await prisma.visitCapacityRequest.update({
      where: { id },
      data: {
        status: 'DENIED',
        reviewerOrgUserId: orgUser.id,
        responseNote: responseNote?.trim() || null,
      },
    });
    await writeAuditLog({
      userId: user.id,
      orgId: orgUser.orgId,
      action: 'VISIT_REQUEST_DENIED',
      resourceType: 'VisitCapacityRequest',
      resourceId: id,
      metadata: { requestedVisits: requestRow.requestedVisits },
    });
    return NextResponse.json({ data: { status: updated.status } });
  }

  const amount = allocateAmount ?? requestRow.requestedVisits;
  try {
    const transfer = await transferBankToWallet({
      orgId: orgUser.orgId,
      orgUserId: requestRow.requesterOrgUserId,
      amount,
      createdByUserId: user.id,
      metadata: { visitRequestId: id },
    });

    const updated = await prisma.visitCapacityRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewerOrgUserId: orgUser.id,
        responseNote: responseNote?.trim() || null,
      },
    });

    await writeAuditLog({
      userId: user.id,
      orgId: orgUser.orgId,
      action: 'VISIT_REQUEST_APPROVED',
      resourceType: 'VisitCapacityRequest',
      resourceId: id,
      metadata: {
        allocated: amount,
        orgBankBalance: transfer.orgBankBalance,
        userWalletBalance: transfer.userWalletBalance,
      },
    });

    return NextResponse.json({ data: { status: updated.status, ...transfer } });
  } catch (err) {
    if (err instanceof VisitLedgerError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.code === 'insufficient_balance' ? 409 : 400 },
      );
    }
    throw err;
  }
}
