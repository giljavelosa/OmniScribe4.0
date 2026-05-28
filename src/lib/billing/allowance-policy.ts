/**
 * Monthly allowance policy — what happens to unused visit credits from
 * the prior billing period before the next MONTHLY_ALLOWANCE credit lands.
 *
 * v1 heuristic: unused monthly allowance ≈ min(org bank balance, last
 * period credit amount). Bundle purchases and owner grants may also sit
 * in the bank; this intentionally under-estimates unused allowance so
 * EXPIRE/ROLLOVER never strips purchased top-ups.
 */

import type { MonthlyAllowancePolicy } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { debitOrgBank, transferBankToWallet } from '@/lib/billing/visit-ledger';

export type AllowancePolicyResult = {
  unusedEstimate: number;
  expired: number;
  rolledOver: number;
  skipped: boolean;
  reason?: 'zero_unused' | 'already_applied' | 'sweep_to_bank';
};

export function allowancePolicyPeriodKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function applyMonthlyAllowancePolicyBeforeRenewal(input: {
  orgId: string;
  policy: MonthlyAllowancePolicy;
  rolloverCap: number | null;
  allowanceAmount: number;
  periodKey?: string;
  now?: Date;
}): Promise<AllowancePolicyResult> {
  const now = input.now ?? new Date();
  const periodKey = input.periodKey ?? allowancePolicyPeriodKey(now);
  const idempotencyKey = `monthly-policy:${input.orgId}:${periodKey}`;

  const existing = await prisma.visitLedgerEntry.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  if (existing) {
    return {
      unusedEstimate: 0,
      expired: 0,
      rolledOver: 0,
      skipped: true,
      reason: 'already_applied',
    };
  }

  if (input.policy === 'SWEEP_TO_BANK') {
    return {
      unusedEstimate: 0,
      expired: 0,
      rolledOver: 0,
      skipped: true,
      reason: 'sweep_to_bank',
    };
  }

  const org = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: { visitBankBalance: true },
  });
  const bank = org?.visitBankBalance ?? 0;
  const unusedEstimate = Math.min(Math.max(0, bank), Math.max(0, input.allowanceAmount));

  if (unusedEstimate < 1) {
    return {
      unusedEstimate: 0,
      expired: 0,
      rolledOver: 0,
      skipped: true,
      reason: 'zero_unused',
    };
  }

  if (input.policy === 'EXPIRE') {
    const result = await debitOrgBank({
      orgId: input.orgId,
      amount: unusedEstimate,
      sourceType: 'ADJUSTMENT',
      idempotencyKey,
      metadata: {
        policy: input.policy,
        allowanceAmount: input.allowanceAmount,
        period: periodKey,
        action: 'expire_unused_allowance',
        expiredVisits: unusedEstimate,
      },
    });

    await writeAuditLog({
      orgId: input.orgId,
      action: 'VISIT_LEDGER_DEBIT',
      resourceType: 'Organization',
      resourceId: input.orgId,
      metadata: {
        source: 'monthly_allowance_expire',
        expiredVisits: unusedEstimate,
        orgBankBalance: result.orgBankBalance,
        period: periodKey,
      },
    });

    return { unusedEstimate, expired: unusedEstimate, rolledOver: 0, skipped: false };
  }

  // ROLLOVER_USER — solo orgs roll to the first active clinician wallet.
  const cap = input.rolloverCap ?? unusedEstimate;
  const rollAmount = Math.min(unusedEstimate, Math.max(0, cap));

  if (rollAmount < 1) {
    return {
      unusedEstimate,
      expired: 0,
      rolledOver: 0,
      skipped: true,
      reason: 'zero_unused',
    };
  }

  const clinician = await prisma.orgUser.findFirst({
    where: { orgId: input.orgId, isActive: true, role: { in: ['CLINICIAN', 'ORG_ADMIN'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (!clinician) {
    return {
      unusedEstimate,
      expired: 0,
      rolledOver: 0,
      skipped: true,
      reason: 'zero_unused',
    };
  }

  await transferBankToWallet({
    orgId: input.orgId,
    orgUserId: clinician.id,
    amount: rollAmount,
    metadata: {
      policy: input.policy,
      allowanceAmount: input.allowanceAmount,
      period: periodKey,
      action: 'rollover_user_wallet',
    },
  });

  await prisma.visitLedgerEntry.create({
    data: {
      orgId: input.orgId,
      orgUserId: clinician.id,
      amount: 0,
      orgBankBalanceAfter: (
        await prisma.organization.findUnique({
          where: { id: input.orgId },
          select: { visitBankBalance: true },
        })
      )?.visitBankBalance ?? 0,
      userWalletBalanceAfter: (
        await prisma.orgUser.findUnique({
          where: { id: clinician.id },
          select: { visitWalletBalance: true },
        })
      )?.visitWalletBalance ?? 0,
      sourceType: 'ADJUSTMENT',
      idempotencyKey,
      metadata: {
        policy: input.policy,
        rolledOver: rollAmount,
        period: periodKey,
        action: 'rollover_user_wallet',
      },
    },
  });

  await writeAuditLog({
    orgId: input.orgId,
    action: 'VISIT_ALLOCATED',
    resourceType: 'OrgUser',
    resourceId: clinician.id,
    metadata: {
      source: 'monthly_allowance_rollover',
      rolledOver: rollAmount,
      period: periodKey,
    },
  });

  return { unusedEstimate, expired: 0, rolledOver: rollAmount, skipped: false };
}
