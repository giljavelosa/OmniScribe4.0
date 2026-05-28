import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonthlyAllowancePolicy } from '@prisma/client';

const orgFindUnique = vi.fn();
const orgUserFindFirst = vi.fn();
const ledgerFindUnique = vi.fn();
const debitOrgBank = vi.fn();
const transferBankToWallet = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: {
      findUnique: (...args: unknown[]) => orgFindUnique(...args),
    },
    orgUser: {
      findFirst: (...args: unknown[]) => orgUserFindFirst(...args),
      findUnique: vi.fn().mockResolvedValue({ visitWalletBalance: 5 }),
    },
    visitLedgerEntry: {
      findUnique: (...args: unknown[]) => ledgerFindUnique(...args),
      create: vi.fn().mockResolvedValue({ id: 'entry_1' }),
    },
  },
}));

vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/billing/visit-ledger', () => ({
  debitOrgBank: (...args: unknown[]) => debitOrgBank(...args),
  transferBankToWallet: (...args: unknown[]) => transferBankToWallet(...args),
}));

import { applyMonthlyAllowancePolicyBeforeRenewal } from '@/lib/billing/allowance-policy';

beforeEach(() => {
  orgFindUnique.mockReset().mockResolvedValue({ visitBankBalance: 40 });
  orgUserFindFirst.mockReset().mockResolvedValue({ id: 'ou_1' });
  ledgerFindUnique.mockReset().mockResolvedValue(null);
  debitOrgBank.mockReset().mockResolvedValue({ orgBankBalance: 0 });
  transferBankToWallet.mockReset().mockResolvedValue({
    orgBankBalance: 30,
    userWalletBalance: 10,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('applyMonthlyAllowancePolicyBeforeRenewal', () => {
  it('EXPIRE debits unused allowance capped by last credit amount', async () => {
    const result = await applyMonthlyAllowancePolicyBeforeRenewal({
      orgId: 'org_1',
      policy: MonthlyAllowancePolicy.EXPIRE,
      rolloverCap: null,
      allowanceAmount: 30,
      periodKey: '2026-05',
    });

    expect(result.expired).toBe(30);
    expect(debitOrgBank).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        amount: 30,
        sourceType: 'ADJUSTMENT',
      }),
    );
  });

  it('ROLLOVER_USER transfers to first clinician wallet', async () => {
    const result = await applyMonthlyAllowancePolicyBeforeRenewal({
      orgId: 'org_1',
      policy: MonthlyAllowancePolicy.ROLLOVER_USER,
      rolloverCap: 15,
      allowanceAmount: 30,
      periodKey: '2026-05',
    });

    expect(result.rolledOver).toBe(15);
    expect(transferBankToWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        orgUserId: 'ou_1',
        amount: 15,
      }),
    );
  });

  it('SWEEP_TO_BANK is a no-op', async () => {
    const result = await applyMonthlyAllowancePolicyBeforeRenewal({
      orgId: 'org_1',
      policy: MonthlyAllowancePolicy.SWEEP_TO_BANK,
      rolloverCap: null,
      allowanceAmount: 30,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('sweep_to_bank');
    expect(debitOrgBank).not.toHaveBeenCalled();
    expect(transferBankToWallet).not.toHaveBeenCalled();
  });
});
