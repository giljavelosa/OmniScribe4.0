import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const contractFindUnique = vi.fn();
const getOrgUserAvailableVisits = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organizationCommercialContract: {
      findUnique: (...args: unknown[]) => contractFindUnique(...args),
    },
  },
}));

vi.mock('@/lib/billing/visit-ledger', () => ({
  getOrgUserAvailableVisits: (...args: unknown[]) => getOrgUserAvailableVisits(...args),
}));

import {
  checkVisitCapacity,
  visitCapacityRequiredResponse,
} from '@/lib/billing/capacity-gate';

const NOW = new Date('2026-05-27T12:00:00Z');

beforeEach(() => {
  contractFindUnique.mockReset();
  getOrgUserAvailableVisits.mockReset().mockResolvedValue(0);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checkVisitCapacity', () => {
  it('passes when no contract exists (legacy org migration path)', async () => {
    contractFindUnique.mockResolvedValue(null);
    const result = await checkVisitCapacity('org_1', 'ou_1');
    expect(result).toEqual({ ok: true, available: Number.MAX_SAFE_INTEGER });
  });

  it('passes when enforcement is disabled', async () => {
    contractFindUnique.mockResolvedValue({
      capacityEnforcementEnabled: false,
    });
    const result = await checkVisitCapacity('org_1', 'ou_1');
    expect(result.ok).toBe(true);
  });

  it('blocks when trial has expired', async () => {
    contractFindUnique.mockResolvedValue({
      capacityEnforcementEnabled: true,
      trialEndsAt: new Date('2026-05-01T00:00:00Z'),
      contractEnd: null,
      visitDebitOrder: 'USER_WALLET_THEN_BANK',
      allowOverage: false,
    });
    const result = await checkVisitCapacity('org_1', 'ou_1');
    expect(result).toEqual({ ok: false, reason: 'trial_expired' });
  });

  it('blocks when contract end date passed', async () => {
    contractFindUnique.mockResolvedValue({
      capacityEnforcementEnabled: true,
      trialEndsAt: null,
      contractEnd: new Date('2026-05-01T00:00:00Z'),
      visitDebitOrder: 'USER_WALLET_THEN_BANK',
      allowOverage: false,
    });
    const result = await checkVisitCapacity('org_1', 'ou_1');
    expect(result).toEqual({ ok: false, reason: 'contract_expired' });
  });

  it('blocks when no visits and overage not allowed', async () => {
    contractFindUnique.mockResolvedValue({
      capacityEnforcementEnabled: true,
      trialEndsAt: null,
      contractEnd: null,
      visitDebitOrder: 'USER_WALLET_THEN_BANK',
      allowOverage: false,
    });
    getOrgUserAvailableVisits.mockResolvedValue(0);
    const result = await checkVisitCapacity('org_1', 'ou_1');
    expect(result).toEqual({ ok: false, reason: 'no_visits' });
  });

  it('allows visit when overage is enabled even at zero balance', async () => {
    contractFindUnique.mockResolvedValue({
      capacityEnforcementEnabled: true,
      trialEndsAt: null,
      contractEnd: null,
      visitDebitOrder: 'USER_WALLET_THEN_BANK',
      allowOverage: true,
    });
    getOrgUserAvailableVisits.mockResolvedValue(0);
    const result = await checkVisitCapacity('org_1', 'ou_1');
    expect(result).toEqual({ ok: true, available: 0 });
  });

  it('allows visit when wallet + bank have capacity', async () => {
    contractFindUnique.mockResolvedValue({
      capacityEnforcementEnabled: true,
      trialEndsAt: null,
      contractEnd: null,
      visitDebitOrder: 'USER_WALLET_THEN_BANK',
      allowOverage: false,
    });
    getOrgUserAvailableVisits.mockResolvedValue(12);
    const result = await checkVisitCapacity('org_1', 'ou_1');
    expect(result).toEqual({ ok: true, available: 12 });
  });
});

describe('visitCapacityRequiredResponse', () => {
  it('returns 403 with no_visit_capacity code', async () => {
    const res = visitCapacityRequiredResponse('no_visits');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('no_visit_capacity');
    expect(body.error.reason).toBe('no_visits');
  });
});
