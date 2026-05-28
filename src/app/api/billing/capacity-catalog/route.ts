import { NextResponse } from 'next/server';

import { requireFeatureAccess } from '@/lib/authz/server';
import { prisma } from '@/lib/prisma';
import { getActiveCatalogPayload } from '@/lib/billing/catalog-resolver';
import { ORG_SEAT_COUNT_MAX } from '@/lib/billing/org-pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/billing/capacity-catalog — active visit-bank SKUs + org billing status. */
export async function GET(req: Request) {
  const guard = await requireFeatureAccess('BILLING_MANAGE', req);
  if ('error' in guard) return guard.error;
  const orgId = guard.authorizationUser.orgId;

  const [{ payload }, org, contract] = await Promise.all([
    getActiveCatalogPayload(),
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { stripeCustomerId: true, stripeSubscriptionId: true },
    }),
    prisma.organizationCommercialContract.findUnique({
      where: { orgId },
      select: {
        commercialModel: true,
        committedSeats: true,
        trialEndsAt: true,
      },
    }),
  ]);

  const template = payload.enterpriseTemplateJson;

  return NextResponse.json({
    data: {
      soloTiers: payload.soloTiersJson,
      visitBundles: payload.visitBundlesJson,
      collaboratorSeatPriceCents: payload.collaboratorSeatPriceCents,
      defaultOveragePriceCents: payload.defaultOveragePriceCents,
      orgPlan: {
        minSeats: payload.trialOrgSeats,
        maxSeats: ORG_SEAT_COUNT_MAX,
        seatPriceCents: template.defaultSeatPriceCents,
        visitsPerSeatPerMonth: template.defaultVisitsPerSeatPerMonth,
      },
      trialDefaults: {
        solo: {
          visits: payload.trialSoloVisits,
          days: payload.trialSoloDays,
        },
        org: {
          visits: payload.trialOrgVisits,
          seats: payload.trialOrgSeats,
          days: payload.trialOrgDays,
        },
      },
      billingStatus: {
        stripeCustomerLinked: !!org?.stripeCustomerId,
        capacitySubscriptionLinked: !!org?.stripeSubscriptionId,
        commercialModel: contract?.commercialModel ?? null,
        committedSeats: contract?.committedSeats ?? 1,
        trialEndsAt: contract?.trialEndsAt?.toISOString() ?? null,
      },
    },
  });
}
