/**
 * Default platform billing catalog — seeded on first publish and used as
 * the owner catalog editor's initial draft.
 */

export type SoloTierCatalogRow = {
  id: string;
  label: string;
  monthlyPriceCents: number;
  monthlyVisitCredit: number;
};

export type VisitBundleCatalogRow = {
  id: string;
  label: string;
  visitCount: number;
  priceCents: number;
};

export type EnterpriseTemplateCatalog = {
  defaultSeatPriceCents: number;
  defaultVisitsPerSeatPerMonth: number;
  defaultCommittedSeats: number;
};

export type CatalogPayload = {
  soloTiersJson: SoloTierCatalogRow[];
  visitBundlesJson: VisitBundleCatalogRow[];
  collaboratorSeatPriceCents: number;
  defaultOveragePriceCents: number;
  trialSoloVisits: number;
  trialSoloDays: number;
  trialOrgSeats: number;
  trialOrgVisits: number;
  trialOrgDays: number;
  enterpriseTemplateJson: EnterpriseTemplateCatalog;
};

export const DEFAULT_CATALOG_PAYLOAD: CatalogPayload = {
  soloTiersJson: [
    { id: 'solo-starter', label: 'Solo Starter', monthlyPriceCents: 5900, monthlyVisitCredit: 40 },
    { id: 'solo-standard', label: 'Solo Standard', monthlyPriceCents: 8900, monthlyVisitCredit: 100 },
    { id: 'solo-plus', label: 'Solo Plus', monthlyPriceCents: 12900, monthlyVisitCredit: 180 },
  ],
  visitBundlesJson: [
    { id: 'bundle-250', label: '+250 visits', visitCount: 250, priceCents: 22500 },
    { id: 'bundle-500', label: '+500 visits', visitCount: 500, priceCents: 40000 },
    { id: 'bundle-2000', label: '+2,000 visits', visitCount: 2000, priceCents: 140000 },
  ],
  collaboratorSeatPriceCents: 3900,
  defaultOveragePriceCents: 139,
  trialSoloVisits: 50,
  trialSoloDays: 14,
  trialOrgSeats: 3,
  trialOrgVisits: 100,
  trialOrgDays: 14,
  enterpriseTemplateJson: {
    defaultSeatPriceCents: 4500,
    defaultVisitsPerSeatPerMonth: 80,
    defaultCommittedSeats: 50,
  },
};
