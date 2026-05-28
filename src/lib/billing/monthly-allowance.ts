/**
 * Enterprise / contract monthly visit allowance — credits org bank based on
 * committed or active seats × visitsPerSeatPerMonth.
 */

import { VisitCreditBasis } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { creditOrgBank } from '@/lib/billing/visit-ledger';
import { applyMonthlyAllowancePolicyBeforeRenewal } from '@/lib/billing/allowance-policy';

export type MonthlyAllowanceResult =
  | { ok: true; credited: number; orgBankBalance: number }
  | { ok: false; reason: 'no_contract' | 'no_visits_configured' | 'zero_seats' | 'already_credited' };

function periodKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function runMonthlyAllowanceForOrg(
  orgId: string,
  now = new Date(),
): Promise<MonthlyAllowanceResult> {
  const contract = await prisma.organizationCommercialContract.findUnique({
    where: { orgId },
  });
  if (!contract?.visitsPerSeatPerMonth || contract.visitsPerSeatPerMonth < 1) {
    return { ok: false, reason: 'no_visits_configured' };
  }

  const seatCount =
    contract.visitCreditBasis === VisitCreditBasis.COMMITTED
      ? contract.committedSeats
      : await prisma.orgUser.count({ where: { orgId, isActive: true } });

  if (seatCount < 1) {
    return { ok: false, reason: 'zero_seats' };
  }

  const credit = seatCount * contract.visitsPerSeatPerMonth;
  const key = `monthly-enterprise:${orgId}:${periodKey(now)}`;

  const existing = await prisma.visitLedgerEntry.findUnique({
    where: { idempotencyKey: key },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, reason: 'already_credited' };
  }

  await applyMonthlyAllowancePolicyBeforeRenewal({
    orgId,
    policy: contract.monthlyAllowancePolicy,
    rolloverCap: contract.monthlyAllowanceRolloverCap,
    allowanceAmount: credit,
    periodKey: periodKey(now),
    now,
  });

  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const result = await creditOrgBank({
    orgId,
    amount: credit,
    sourceType: 'MONTHLY_ALLOWANCE',
    idempotencyKey: key,
    expiresAt: periodEnd,
    metadata: {
      seatCount,
      visitsPerSeat: contract.visitsPerSeatPerMonth,
      basis: contract.visitCreditBasis,
      period: periodKey(now),
    },
  });

  await writeAuditLog({
    orgId,
    action: 'VISIT_LEDGER_CREDIT',
    resourceType: 'Organization',
    resourceId: orgId,
    metadata: {
      source: 'enterprise_monthly_allowance',
      visitCredit: credit,
      orgBankBalance: result.orgBankBalance,
      period: periodKey(now),
    },
  });

  return { ok: true, credited: credit, orgBankBalance: result.orgBankBalance };
}

export async function runMonthlyAllowanceAllOrgs(now = new Date()) {
  const contracts = await prisma.organizationCommercialContract.findMany({
    where: {
      commercialModel: 'ENTERPRISE_PER_SEAT',
      visitsPerSeatPerMonth: { gt: 0 },
    },
    select: { orgId: true },
  });

  const results: Array<{ orgId: string; result: MonthlyAllowanceResult }> = [];
  for (const { orgId } of contracts) {
    results.push({ orgId, result: await runMonthlyAllowanceForOrg(orgId, now) });
  }
  return results;
}

export function contractExpiryWarning(
  contractEnd: Date | null | undefined,
  now = new Date(),
): { daysLeft: number; level: 'none' | 'warn' | 'urgent' } {
  if (!contractEnd) return { daysLeft: Infinity, level: 'none' };
  const daysLeft = Math.ceil((contractEnd.getTime() - now.getTime()) / 86_400_000);
  if (daysLeft > 30) return { daysLeft, level: 'none' };
  if (daysLeft > 7) return { daysLeft, level: 'warn' };
  return { daysLeft, level: 'urgent' };
}
