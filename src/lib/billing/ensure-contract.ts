import type { CommercialModel } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { creditOrgBank } from '@/lib/billing/visit-ledger';
import { ensureActiveCatalog } from '@/lib/billing/catalog-service';

const MS_PER_DAY = 86_400_000;

export type TrialKind = 'solo' | 'org';

export async function ensureOrganizationCommercialContract(
  orgId: string,
  trialKind: TrialKind = 'solo',
) {
  const existing = await prisma.organizationCommercialContract.findUnique({
    where: { orgId },
  });
  if (existing) return existing;

  const catalog = await ensureActiveCatalog();
  const isOrg = trialKind === 'org';
  const days = isOrg ? catalog.trialOrgDays : catalog.trialSoloDays;
  const visits = isOrg ? catalog.trialOrgVisits : catalog.trialSoloVisits;
  const seats = isOrg ? catalog.trialOrgSeats : 1;
  const trialEndsAt = new Date(Date.now() + days * MS_PER_DAY);

  await prisma.organizationCommercialContract.create({
    data: {
      orgId,
      commercialModel: 'TRIAL',
      catalogVersionId: catalog.id,
      committedSeats: seats,
      trialEndsAt,
      capacityEnforcementEnabled: true,
    },
  });

  await creditOrgBank({
    orgId,
    amount: visits,
    sourceType: 'TRIAL_GRANT',
    idempotencyKey: `trial-grant:${orgId}`,
    metadata: { trialKind, visits, seats, days },
  });

  return prisma.organizationCommercialContract.findUniqueOrThrow({ where: { orgId } });
}

export async function grantTrialForOrg(
  orgId: string,
  model: Extract<CommercialModel, 'TRIAL' | 'ORG_VISIT_BANK'>,
) {
  const catalog = await ensureActiveCatalog();
  const isOrg = model === 'ORG_VISIT_BANK';
  const days = isOrg ? catalog.trialOrgDays : catalog.trialSoloDays;
  const visits = isOrg ? catalog.trialOrgVisits : catalog.trialSoloVisits;
  const seats = isOrg ? catalog.trialOrgSeats : 1;

  await prisma.organizationCommercialContract.upsert({
    where: { orgId },
    create: {
      orgId,
      commercialModel: 'TRIAL',
      catalogVersionId: catalog.id,
      committedSeats: seats,
      trialEndsAt: new Date(Date.now() + days * MS_PER_DAY),
      capacityEnforcementEnabled: true,
    },
    update: {
      committedSeats: seats,
      trialEndsAt: new Date(Date.now() + days * MS_PER_DAY),
    },
  });

  await creditOrgBank({
    orgId,
    amount: visits,
    sourceType: 'TRIAL_GRANT',
    idempotencyKey: `trial-grant:${orgId}:${Date.now()}`,
    metadata: { visits, seats, days },
  });
}
