/**
 * Resolve catalog rows from the active platform billing catalog.
 */

import type { SoloTierCatalogRow, VisitBundleCatalogRow } from '@/lib/billing/catalog-defaults';
import { quoteOrgMonthlyPlan } from '@/lib/billing/org-pricing';
import { catalogToPayload } from '@/lib/billing/catalog-service';
import { ensureActiveCatalog } from '@/lib/billing/catalog-service';

export class CatalogLookupError extends Error {
  constructor(
    message: string,
    readonly code: 'tier_not_found' | 'bundle_not_found' | 'no_catalog',
  ) {
    super(message);
    this.name = 'CatalogLookupError';
  }
}

export async function getActiveCatalogPayload() {
  const catalog = await ensureActiveCatalog();
  return { catalog, payload: catalogToPayload(catalog) };
}

export async function resolveSoloTier(tierId: string): Promise<SoloTierCatalogRow> {
  const { payload } = await getActiveCatalogPayload();
  const tier = payload.soloTiersJson.find((t) => t.id === tierId);
  if (!tier) {
    throw new CatalogLookupError(`Unknown tier "${tierId}"`, 'tier_not_found');
  }
  return tier;
}

export async function resolveVisitBundle(bundleId: string): Promise<VisitBundleCatalogRow> {
  const { payload } = await getActiveCatalogPayload();
  const bundle = payload.visitBundlesJson.find((b) => b.id === bundleId);
  if (!bundle) {
    throw new CatalogLookupError(`Unknown bundle "${bundleId}"`, 'bundle_not_found');
  }
  return bundle;
}

export async function resolveOrgMonthlyPlan(seatCount: number) {
  const { payload } = await getActiveCatalogPayload();
  const quote = quoteOrgMonthlyPlan(
    payload.enterpriseTemplateJson,
    seatCount,
    payload.trialOrgSeats,
  );
  if ('error' in quote) {
    throw new CatalogLookupError(quote.error, 'tier_not_found');
  }
  return { quote, payload };
}
