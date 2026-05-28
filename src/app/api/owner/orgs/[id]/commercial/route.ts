import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  CommercialModel,
  MonthlyAllowancePolicy,
  VisitCreditBasis,
  VisitDebitOrder,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writeAuditLog, writePlatformAuditLog } from '@/lib/audit/log';
import { ensureOrganizationCommercialContract } from '@/lib/billing/ensure-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  commercialModel: z.nativeEnum(CommercialModel).optional(),
  committedSeats: z.number().int().min(1).optional(),
  contractStart: z.string().datetime().nullable().optional(),
  contractEnd: z.string().datetime().nullable().optional(),
  seatPriceCents: z.number().int().min(0).nullable().optional(),
  visitsPerSeatPerMonth: z.number().int().min(0).nullable().optional(),
  visitCreditBasis: z.nativeEnum(VisitCreditBasis).optional(),
  seatBillBasis: z.nativeEnum(VisitCreditBasis).optional(),
  monthlyAllowancePolicy: z.nativeEnum(MonthlyAllowancePolicy).optional(),
  monthlyAllowanceRolloverCap: z.number().int().min(0).nullable().optional(),
  signingBundleVisits: z.number().int().min(0).optional(),
  overagePriceCents: z.number().int().min(0).nullable().optional(),
  allowOverage: z.boolean().optional(),
  allowUserVisitRequests: z.boolean().optional(),
  visitDebitOrder: z.nativeEnum(VisitDebitOrder).optional(),
  monthlyTierId: z.string().nullable().optional(),
  monthlyPriceOverrideCents: z.number().int().min(0).nullable().optional(),
  monthlyVisitCreditOverride: z.number().int().min(0).nullable().optional(),
  trialEndsAt: z.string().datetime().nullable().optional(),
  capacityEnforcementEnabled: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;

  const { id } = await params;
  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      visitBankBalance: true,
      commercialContract: true,
    },
  });
  if (!org) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const contract = org.commercialContract ?? (await ensureOrganizationCommercialContract(id));

  return NextResponse.json({
    data: {
      orgId: org.id,
      orgName: org.name,
      visitBankBalance: org.visitBankBalance,
      contract,
    },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user } = guard;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const before = await ensureOrganizationCommercialContract(id);

  const data = parsed.data;
  const updated = await prisma.organizationCommercialContract.update({
    where: { orgId: id },
    data: {
      ...data,
      contractStart: data.contractStart === undefined ? undefined : data.contractStart ? new Date(data.contractStart) : null,
      contractEnd: data.contractEnd === undefined ? undefined : data.contractEnd ? new Date(data.contractEnd) : null,
      trialEndsAt: data.trialEndsAt === undefined ? undefined : data.trialEndsAt ? new Date(data.trialEndsAt) : null,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: id,
    action: 'ORG_COMMERCIAL_UPDATED',
    resourceType: 'Organization',
    resourceId: id,
    metadata: {
      before: { commercialModel: before.commercialModel, committedSeats: before.committedSeats },
      after: { commercialModel: updated.commercialModel, committedSeats: updated.committedSeats },
    },
  });
  await writePlatformAuditLog({
    actingUserId: user.id,
    action: 'ORG_COMMERCIAL_UPDATED',
    resourceType: 'Organization',
    resourceId: id,
    metadata: {
      before: { commercialModel: before.commercialModel, committedSeats: before.committedSeats },
      after: { commercialModel: updated.commercialModel, committedSeats: updated.committedSeats },
    },
  });

  return NextResponse.json({ data: { contract: updated } });
}
