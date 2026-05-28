/**
 * Visit capacity gate — blocks new visit creation when the org/user has
 * no visits available under their commercial contract.
 */

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { getOrgUserAvailableVisits } from '@/lib/billing/visit-ledger';

export type CapacityGateResult =
  | { ok: true; available: number }
  | { ok: false; reason: 'no_contract' | 'trial_expired' | 'contract_expired' | 'no_visits' };

export async function checkVisitCapacity(
  orgId: string,
  orgUserId: string,
): Promise<CapacityGateResult> {
  const contract = await prisma.organizationCommercialContract.findUnique({
    where: { orgId },
  });

  if (!contract || !contract.capacityEnforcementEnabled) {
    return { ok: true, available: Number.MAX_SAFE_INTEGER };
  }

  const now = new Date();
  if (contract.trialEndsAt && contract.trialEndsAt.getTime() < now.getTime()) {
    return { ok: false, reason: 'trial_expired' };
  }
  if (contract.contractEnd && contract.contractEnd.getTime() < now.getTime()) {
    return { ok: false, reason: 'contract_expired' };
  }

  const available = await getOrgUserAvailableVisits(
    orgId,
    orgUserId,
    contract.visitDebitOrder,
  );

  if (available < 1 && !contract.allowOverage) {
    return { ok: false, reason: 'no_visits' };
  }

  return { ok: true, available };
}

export function visitCapacityRequiredResponse(reason: Exclude<CapacityGateResult, { ok: true }>['reason']): NextResponse {
  const messages: Record<typeof reason, string> = {
    no_contract: 'Visit capacity is not configured for this organization.',
    trial_expired: 'Your trial has ended. Ask your org admin to choose a plan or contact support.',
    contract_expired: 'Your organization contract has expired. Ask your org admin to renew.',
    no_visits: 'No visits remain in your organization bank or personal wallet. Ask your org admin for more visits or buy a top-up.',
  };

  return NextResponse.json(
    {
      error: {
        code: 'no_visit_capacity',
        reason,
        message: messages[reason],
      },
    },
    { status: 403 },
  );
}

/**
 * Load contract + debit order for note completion worker.
 */
export async function getVisitDebitOrderForOrg(orgId: string) {
  const contract = await prisma.organizationCommercialContract.findUnique({
    where: { orgId },
    select: { visitDebitOrder: true, capacityEnforcementEnabled: true, allowOverage: true },
  });
  if (!contract?.capacityEnforcementEnabled) return null;
  return contract.visitDebitOrder;
}
