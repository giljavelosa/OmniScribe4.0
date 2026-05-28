import { NextResponse } from 'next/server';

import { requireFeatureAccess } from '@/lib/authz/server';
import { getActiveCatalogPayload } from '@/lib/billing/catalog-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/billing/capacity-catalog — active visit-bank SKUs for admin billing UI. */
export async function GET(req: Request) {
  const guard = await requireFeatureAccess('BILLING_MANAGE', req);
  if ('error' in guard) return guard.error;

  const { payload } = await getActiveCatalogPayload();

  return NextResponse.json({
    data: {
      soloTiers: payload.soloTiersJson,
      visitBundles: payload.visitBundlesJson,
      collaboratorSeatPriceCents: payload.collaboratorSeatPriceCents,
      defaultOveragePriceCents: payload.defaultOveragePriceCents,
    },
  });
}
