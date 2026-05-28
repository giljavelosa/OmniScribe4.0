import { NextResponse } from 'next/server';

import { requireFeatureAccess } from '@/lib/authz/server';
import { prisma } from '@/lib/prisma';
import { getOrgUserAvailableVisits } from '@/lib/billing/visit-ledger';
import { ensureOrganizationCommercialContract } from '@/lib/billing/ensure-contract';
import { contractExpiryWarning } from '@/lib/billing/monthly-allowance';
import { getTrialExpiryState } from '@/lib/billing/commercial-mode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/account/capacity — clinician view of visit bank + personal wallet. */
export async function GET(req: Request) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  await ensureOrganizationCommercialContract(authorizationUser.orgId);

  const [org, orgUser, contract] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: authorizationUser.orgId },
      select: { visitBankBalance: true, name: true },
    }),
    prisma.orgUser.findUnique({
      where: { id: authorizationUser.orgUserId },
      select: { visitWalletBalance: true },
    }),
    prisma.organizationCommercialContract.findUnique({
      where: { orgId: authorizationUser.orgId },
    }),
  ]);

  const available =
    contract && orgUser
      ? await getOrgUserAvailableVisits(
          authorizationUser.orgId,
          authorizationUser.orgUserId,
          contract.visitDebitOrder,
        )
      : 0;

  const expiry = contractExpiryWarning(contract?.contractEnd ?? null);
  const trialExpiry = getTrialExpiryState(contract);

  return NextResponse.json({
    data: {
      orgName: org?.name,
      visitBankBalance: org?.visitBankBalance ?? 0,
      visitWalletBalance: orgUser?.visitWalletBalance ?? 0,
      availableVisits: available,
      commercialModel: contract?.commercialModel ?? null,
      trialEndsAt: contract?.trialEndsAt?.toISOString() ?? null,
      trialExpired: trialExpiry?.expired ?? false,
      trialDaysLeft: trialExpiry?.daysLeft ?? null,
      trialUrgent: trialExpiry?.urgent ?? false,
      contractEnd: contract?.contractEnd?.toISOString() ?? null,
      allowUserVisitRequests: contract?.allowUserVisitRequests ?? false,
      expiryWarning:
        expiry.level === 'none'
          ? null
          : {
              daysLeft: expiry.daysLeft,
              level: expiry.level,
            },
    },
  });
}
