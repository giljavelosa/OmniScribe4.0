import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAdminOrgRole } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { ensureOrganizationCommercialContract } from '@/lib/billing/ensure-contract';
import {
  transferBankToWallet,
  transferWalletToBank,
  VisitLedgerError,
} from '@/lib/billing/visit-ledger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  action: z.enum(['allocate', 'reclaim']),
  orgUserId: z.string().min(1),
  amount: z.number().int().min(1).max(100_000),
});

export async function GET() {
  const guard = await requireAdminOrgRole();
  if ('error' in guard) return guard.error;
  const { orgUser } = guard;
  const orgId = orgUser.orgId;

  await ensureOrganizationCommercialContract(orgId);

  const [org, users, requests, contract] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { visitBankBalance: true, name: true },
    }),
    prisma.orgUser.findMany({
      where: { orgId, isActive: true },
      select: {
        id: true,
        role: true,
        visitWalletBalance: true,
        user: { select: { email: true } },
      },
      orderBy: { user: { email: 'asc' } },
    }),
    prisma.visitCapacityRequest.findMany({
      where: { orgId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        requester: { include: { user: { select: { email: true } } } },
      },
    }),
    prisma.organizationCommercialContract.findUnique({ where: { orgId } }),
  ]);

  return NextResponse.json({
    data: {
      orgName: org?.name,
      visitBankBalance: org?.visitBankBalance ?? 0,
      contract,
      users: users.map((u) => ({
        orgUserId: u.id,
        email: u.user.email,
        role: u.role,
        visitWalletBalance: u.visitWalletBalance,
      })),
      pendingRequests: requests.map((r) => ({
        id: r.id,
        requesterEmail: r.requester.user.email,
        requestedVisits: r.requestedVisits,
        message: r.message,
        createdAt: r.createdAt.toISOString(),
      })),
    },
  });
}

export async function POST(req: Request) {
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

  const { action, orgUserId, amount } = parsed.data;
  const orgId = orgUser.orgId;

  try {
    const result =
      action === 'allocate'
        ? await transferBankToWallet({
            orgId,
            orgUserId,
            amount,
            createdByUserId: user.id,
          })
        : await transferWalletToBank({
            orgId,
            orgUserId,
            amount,
            createdByUserId: user.id,
          });

    await writeAuditLog({
      userId: user.id,
      orgId,
      action: action === 'allocate' ? 'VISIT_ALLOCATED' : 'VISIT_RECLAIMED',
      resourceType: 'OrgUser',
      resourceId: orgUserId,
      metadata: {
        amount,
        orgBankBalance: result.orgBankBalance,
        userWalletBalance: result.userWalletBalance,
      },
    });

    return NextResponse.json({ data: result });
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
