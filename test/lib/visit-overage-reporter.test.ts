import { describe, expect, it, vi } from 'vitest';

const ledgerCount = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organizationCommercialContract: {
      findUnique: vi.fn(),
    },
    visitLedgerEntry: {
      count: (...args: unknown[]) => ledgerCount(...args),
    },
    organization: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import { reportVisitOverageForOrg } from '@/lib/billing/visit-overage-reporter';
import { prisma } from '@/lib/prisma';

describe('reportVisitOverageForOrg', () => {
  it('reports delta visit overage to Stripe', async () => {
    vi.mocked(prisma.organizationCommercialContract.findUnique).mockResolvedValue({
      allowOverage: true,
      capacityEnforcementEnabled: true,
    } as never);

    ledgerCount.mockResolvedValue(5);

    const reportToStripe = vi.fn().mockResolvedValue({ ok: true });
    const row = await reportVisitOverageForOrg(
      'org_1',
      {
        loadOrgContext: async () => ({
          overageSubscriptionItemId: 'si_visit_overage',
          overageReportedSoFar: 2,
          currentPeriodStartIso: '2026-05-01T00:00:00.000Z',
        }),
        reportToStripe,
      },
      new Date('2026-05-27T12:00:00Z'),
    );

    expect(row.status).toBe('reported');
    expect(row.reported_increment).toBe(3);
    expect(reportToStripe).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionItemId: 'si_visit_overage',
        quantity: 3,
      }),
    );
  });

  it('skips when overage disabled on contract', async () => {
    vi.mocked(prisma.organizationCommercialContract.findUnique).mockResolvedValue({
      allowOverage: false,
      capacityEnforcementEnabled: true,
    } as never);

    const row = await reportVisitOverageForOrg('org_1', {
      loadOrgContext: async () => null,
      reportToStripe: vi.fn(),
    });

    expect(row.status).toBe('skipped_overage_disabled');
  });
});
