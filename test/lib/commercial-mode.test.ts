import { describe, expect, it } from 'vitest';
import { BillingPlan } from '@prisma/client';

import {
  billingPlanForSoloTierId,
  canAddOrgMember,
  isTrialContractActive,
  usesVisitBankBilling,
} from '@/lib/billing/commercial-mode';

describe('usesVisitBankBilling', () => {
  it('is true when capacity enforcement is enabled', () => {
    expect(usesVisitBankBilling({ capacityEnforcementEnabled: true })).toBe(true);
  });

  it('is false without a contract or when enforcement is off', () => {
    expect(usesVisitBankBilling(null)).toBe(false);
    expect(usesVisitBankBilling({ capacityEnforcementEnabled: false })).toBe(false);
  });
});

describe('billingPlanForSoloTierId', () => {
  it('maps catalog tier ids to BillingPlan enum', () => {
    expect(billingPlanForSoloTierId('solo-starter')).toBe('SOLO_STARTER');
    expect(billingPlanForSoloTierId('solo-standard')).toBe('SOLO_PRO');
    expect(billingPlanForSoloTierId('solo-plus')).toBe('SOLO_POWER');
  });
});

describe('canAddOrgMember', () => {
  it('uses contract committedSeats when visit bank is active', () => {
    const ok = canAddOrgMember({
      billingPlan: BillingPlan.TRIAL,
      contract: {
        commercialModel: 'ORG_VISIT_BANK',
        capacityEnforcementEnabled: true,
        committedSeats: 3,
        trialEndsAt: null,
        visitDebitOrder: 'USER_WALLET_THEN_BANK',
      },
      currentSeatCount: 2,
    });
    expect(ok).toEqual({ ok: true });
  });

  it('blocks at org seat cap under visit bank', () => {
    const blocked = canAddOrgMember({
      billingPlan: BillingPlan.TRIAL,
      contract: {
        commercialModel: 'ORG_VISIT_BANK',
        capacityEnforcementEnabled: true,
        committedSeats: 3,
        trialEndsAt: null,
        visitDebitOrder: 'USER_WALLET_THEN_BANK',
      },
      currentSeatCount: 3,
    });
    expect(blocked.ok).toBe(false);
  });

  it('falls back to legacy plan-policy when no contract enforcement', () => {
    const blocked = canAddOrgMember({
      billingPlan: BillingPlan.TRIAL,
      contract: null,
      currentSeatCount: 1,
    });
    expect(blocked.ok).toBe(false);
  });
});

describe('isTrialContractActive', () => {
  it('returns false when trial end is in the past', () => {
    expect(
      isTrialContractActive({
        commercialModel: 'TRIAL',
        trialEndsAt: new Date('2020-01-01'),
      }),
    ).toBe(false);
  });
});
