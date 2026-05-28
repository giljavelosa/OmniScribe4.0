/**
 * Bridge between legacy BillingPlan seat/draft policy and the Unit 51
 * visit-bank commercial contract. Visit-bank orgs read seat caps and
 * home/usage surfaces from the contract when enforcement is enabled.
 */

import type { BillingPlan, CommercialModel, OrganizationCommercialContract } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { canAddSeat } from '@/lib/billing/plan-policy';
import { getOrgUserAvailableVisits } from '@/lib/billing/visit-ledger';

export type CommercialContractSlice = Pick<
  OrganizationCommercialContract,
  | 'commercialModel'
  | 'capacityEnforcementEnabled'
  | 'committedSeats'
  | 'trialEndsAt'
  | 'visitDebitOrder'
>;

export function usesVisitBankBilling(
  contract: Pick<OrganizationCommercialContract, 'capacityEnforcementEnabled'> | null | undefined,
): boolean {
  return !!contract?.capacityEnforcementEnabled;
}

export function isTrialContractActive(
  contract:
    | Pick<OrganizationCommercialContract, 'commercialModel' | 'trialEndsAt'>
    | null
    | undefined,
): boolean {
  if (!contract || contract.commercialModel !== 'TRIAL') return false;
  if (!contract.trialEndsAt) return true;
  return contract.trialEndsAt.getTime() > Date.now();
}

/** Map catalog solo tier ids → legacy BillingPlan for dashboards still keyed on enum. */
export function billingPlanForSoloTierId(tierId: string): BillingPlan {
  switch (tierId) {
    case 'solo-starter':
      return 'SOLO_STARTER';
    case 'solo-standard':
      return 'SOLO_PRO';
    case 'solo-plus':
      return 'SOLO_POWER';
    default:
      return 'SOLO_PRO';
  }
}

export function canAddOrgMember(params: {
  billingPlan: BillingPlan;
  contract: CommercialContractSlice | null;
  currentSeatCount: number;
}): { ok: true } | { ok: false; reason: string; suggestPlan?: BillingPlan } {
  const { billingPlan, contract, currentSeatCount } = params;

  if (usesVisitBankBilling(contract)) {
    const seatCap = Math.max(1, contract!.committedSeats);
    if (currentSeatCount < seatCap) return { ok: true };

    if (contract!.commercialModel === 'SOLO_VISIT_BANK' || seatCap <= 1) {
      return {
        ok: false,
        reason:
          'Solo visit-bank plans allow one clinician seat. Subscribe to a team plan under Billing to add members.',
        suggestPlan: 'DUO',
      };
    }

    return {
      ok: false,
      reason: `Your org plan includes ${seatCap} seats (${currentSeatCount} in use). Add seats under Billing or contact your platform owner.`,
    };
  }

  return canAddSeat(billingPlan, currentSeatCount);
}

export async function loadClinicianCapacitySummary(orgId: string, orgUserId: string) {
  const contract = await prisma.organizationCommercialContract.findUnique({
    where: { orgId },
    select: {
      commercialModel: true,
      capacityEnforcementEnabled: true,
      committedSeats: true,
      trialEndsAt: true,
      visitDebitOrder: true,
    },
  });

  if (!usesVisitBankBilling(contract)) return null;

  const availableVisits = await getOrgUserAvailableVisits(
    orgId,
    orgUserId,
    contract!.visitDebitOrder,
  );

  return {
    commercialModel: contract!.commercialModel as CommercialModel,
    availableVisits,
    trialActive: isTrialContractActive(contract),
  };
}

export async function loadOrgUsageBillingMode(orgId: string) {
  const contract = await prisma.organizationCommercialContract.findUnique({
    where: { orgId },
    select: {
      commercialModel: true,
      capacityEnforcementEnabled: true,
      trialEndsAt: true,
    },
  });

  return {
    visitBankPrimary: usesVisitBankBilling(contract),
    contract,
    trialActive: isTrialContractActive(contract),
  };
}
