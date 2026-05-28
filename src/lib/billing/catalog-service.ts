import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { DEFAULT_CATALOG_PAYLOAD, type CatalogPayload } from '@/lib/billing/catalog-defaults';

export async function getActiveCatalog() {
  return prisma.platformBillingCatalog.findFirst({
    where: { isActive: true },
    orderBy: { version: 'desc' },
  });
}

export async function ensureActiveCatalog() {
  const existing = await getActiveCatalog();
  if (existing) return existing;

  return prisma.platformBillingCatalog.create({
    data: {
      version: 1,
      isActive: true,
      publishedAt: new Date(),
      ...DEFAULT_CATALOG_PAYLOAD,
      soloTiersJson: DEFAULT_CATALOG_PAYLOAD.soloTiersJson as unknown as Prisma.InputJsonValue,
      visitBundlesJson: DEFAULT_CATALOG_PAYLOAD.visitBundlesJson as unknown as Prisma.InputJsonValue,
      enterpriseTemplateJson:
        DEFAULT_CATALOG_PAYLOAD.enterpriseTemplateJson as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function updateActiveCatalog(payload: CatalogPayload, publishedByUserId?: string) {
  const active = await ensureActiveCatalog();
  return prisma.platformBillingCatalog.update({
    where: { id: active.id },
    data: {
      soloTiersJson: payload.soloTiersJson as unknown as Prisma.InputJsonValue,
      visitBundlesJson: payload.visitBundlesJson as unknown as Prisma.InputJsonValue,
      enterpriseTemplateJson: payload.enterpriseTemplateJson as unknown as Prisma.InputJsonValue,
      collaboratorSeatPriceCents: payload.collaboratorSeatPriceCents,
      defaultOveragePriceCents: payload.defaultOveragePriceCents,
      trialSoloVisits: payload.trialSoloVisits,
      trialSoloDays: payload.trialSoloDays,
      trialOrgSeats: payload.trialOrgSeats,
      trialOrgVisits: payload.trialOrgVisits,
      trialOrgDays: payload.trialOrgDays,
      publishedAt: new Date(),
      publishedByUserId,
    },
  });
}

export async function publishNewCatalogVersion(payload: CatalogPayload, publishedByUserId: string) {
  const latest = await prisma.platformBillingCatalog.findFirst({
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const nextVersion = (latest?.version ?? 0) + 1;

  return prisma.$transaction(async (tx) => {
    await tx.platformBillingCatalog.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
    return tx.platformBillingCatalog.create({
      data: {
        version: nextVersion,
        isActive: true,
        publishedAt: new Date(),
        publishedByUserId,
        soloTiersJson: payload.soloTiersJson as unknown as Prisma.InputJsonValue,
        visitBundlesJson: payload.visitBundlesJson as unknown as Prisma.InputJsonValue,
        enterpriseTemplateJson: payload.enterpriseTemplateJson as unknown as Prisma.InputJsonValue,
        collaboratorSeatPriceCents: payload.collaboratorSeatPriceCents,
        defaultOveragePriceCents: payload.defaultOveragePriceCents,
        trialSoloVisits: payload.trialSoloVisits,
        trialSoloDays: payload.trialSoloDays,
        trialOrgSeats: payload.trialOrgSeats,
        trialOrgVisits: payload.trialOrgVisits,
        trialOrgDays: payload.trialOrgDays,
      },
    });
  });
}

export function catalogToPayload(catalog: {
  soloTiersJson: unknown;
  visitBundlesJson: unknown;
  enterpriseTemplateJson: unknown;
  collaboratorSeatPriceCents: number;
  defaultOveragePriceCents: number;
  trialSoloVisits: number;
  trialSoloDays: number;
  trialOrgSeats: number;
  trialOrgVisits: number;
  trialOrgDays: number;
}): CatalogPayload {
  return {
    soloTiersJson: catalog.soloTiersJson as CatalogPayload['soloTiersJson'],
    visitBundlesJson: catalog.visitBundlesJson as CatalogPayload['visitBundlesJson'],
    enterpriseTemplateJson: catalog.enterpriseTemplateJson as CatalogPayload['enterpriseTemplateJson'],
    collaboratorSeatPriceCents: catalog.collaboratorSeatPriceCents,
    defaultOveragePriceCents: catalog.defaultOveragePriceCents,
    trialSoloVisits: catalog.trialSoloVisits,
    trialSoloDays: catalog.trialSoloDays,
    trialOrgSeats: catalog.trialOrgSeats,
    trialOrgVisits: catalog.trialOrgVisits,
    trialOrgDays: catalog.trialOrgDays,
  };
}
