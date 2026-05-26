import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BillingPlan } from '@prisma/client';

/**
 * Daily usage-reporter tests.
 *
 * The reporter is a pure-ish function: all I/O is injected via `deps`.
 * That lets us drive every branch (under-bundle / overage / no-change /
 * failed-Stripe / skipped-unlimited / etc.) without a network.
 */

const auditFindMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: { findMany: (...a: unknown[]) => auditFindMany(...a) },
    organization: { findMany: vi.fn() },
  },
}));

import {
  formatYyyymmdd,
  reportOneOrg,
  type UsageReporterDeps,
} from '@/lib/billing/usage-reporter';

const ORG = 'org_demo';

const FIXED_NOW = new Date('2026-05-26T15:00:00.000Z');

function makeDeps(overrides: Partial<UsageReporterDeps> = {}): UsageReporterDeps {
  return {
    reportToStripe: vi.fn().mockResolvedValue({ ok: true }),
    loadOrgUsageContext: vi.fn().mockResolvedValue({
      overageSubscriptionItemId: 'si_overage_123',
      overageReportedSoFar: 0,
      currentPeriodStartIso: '2026-05-01T00:00:00Z',
      seatCount: 1,
    }),
    ...overrides,
  };
}

beforeEach(() => {
  auditFindMany.mockReset();
});

describe('reportOneOrg — skip cohorts', () => {
  it('TRIAL org is skipped (unbilled)', async () => {
    const deps = makeDeps();
    const row = await reportOneOrg(ORG, BillingPlan.TRIAL, deps, FIXED_NOW);
    expect(row.status).toBe('skipped_unbilled');
    expect(deps.reportToStripe).not.toHaveBeenCalled();
    expect(deps.loadOrgUsageContext).not.toHaveBeenCalled();
  });

  it('SOLO_UNLIMITED org is skipped (unlimited bundle)', async () => {
    const deps = makeDeps();
    const row = await reportOneOrg(
      ORG,
      BillingPlan.SOLO_UNLIMITED,
      deps,
      FIXED_NOW,
    );
    expect(row.status).toBe('skipped_unlimited');
    expect(deps.reportToStripe).not.toHaveBeenCalled();
  });

  it('ENTERPRISE org is skipped (overage handled by contract)', async () => {
    const deps = makeDeps();
    const row = await reportOneOrg(
      ORG,
      BillingPlan.ENTERPRISE,
      deps,
      FIXED_NOW,
    );
    expect(['skipped_unbilled', 'skipped_unlimited']).toContain(row.status);
    expect(deps.reportToStripe).not.toHaveBeenCalled();
  });
});

describe('reportOneOrg — no Stripe subscription wired up yet', () => {
  it('returns skipped_no_subscription when context is null', async () => {
    const deps = makeDeps({
      loadOrgUsageContext: vi.fn().mockResolvedValue(null),
    });
    const row = await reportOneOrg(ORG, BillingPlan.SOLO_PRO, deps, FIXED_NOW);
    expect(row.status).toBe('skipped_no_subscription');
    expect(deps.reportToStripe).not.toHaveBeenCalled();
  });

  it('returns skipped_no_overage_item when subscription item id is missing', async () => {
    const deps = makeDeps({
      loadOrgUsageContext: vi.fn().mockResolvedValue({
        overageSubscriptionItemId: null,
        overageReportedSoFar: 0,
        currentPeriodStartIso: '2026-05-01T00:00:00Z',
        seatCount: 1,
      }),
    });
    const row = await reportOneOrg(ORG, BillingPlan.SOLO_PRO, deps, FIXED_NOW);
    expect(row.status).toBe('skipped_no_overage_item');
  });
});

describe('reportOneOrg — under bundle (no overage)', () => {
  it('SOLO_PRO org with 100 drafts vs 160 bundled → no_change, no Stripe call', async () => {
    auditFindMany.mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => ({ resourceId: `note_${i}` })),
    );
    const deps = makeDeps();
    const row = await reportOneOrg(ORG, BillingPlan.SOLO_PRO, deps, FIXED_NOW);

    expect(row.status).toBe('no_change');
    expect(row.drafts).toBe(100);
    expect(row.drafts_included).toBe(160);
    expect(row.overage).toBe(0);
    expect(row.reported_increment).toBe(0);
    expect(deps.reportToStripe).not.toHaveBeenCalled();
  });
});

describe('reportOneOrg — first overage report', () => {
  it('SOLO_PRO org with 200 drafts → reports 40 to Stripe', async () => {
    auditFindMany.mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => ({ resourceId: `note_${i}` })),
    );
    const reportToStripe = vi.fn().mockResolvedValue({ ok: true });
    const deps = makeDeps({ reportToStripe });
    const row = await reportOneOrg(ORG, BillingPlan.SOLO_PRO, deps, FIXED_NOW);

    expect(row.status).toBe('reported');
    expect(row.overage).toBe(40);
    expect(row.reported_increment).toBe(40);
    expect(reportToStripe).toHaveBeenCalledWith({
      subscriptionItemId: 'si_overage_123',
      quantity: 40,
      idempotencyKey: `${ORG}-20260526`, // YYYYMMDD UTC
      timestampMs: FIXED_NOW.getTime(),
    });
  });
});

describe('reportOneOrg — incremental delta after a prior report', () => {
  it('reports only the delta since the last successful report', async () => {
    auditFindMany.mockResolvedValue(
      Array.from({ length: 250 }, (_, i) => ({ resourceId: `note_${i}` })),
    );
    const reportToStripe = vi.fn().mockResolvedValue({ ok: true });
    const deps = makeDeps({
      reportToStripe,
      loadOrgUsageContext: vi.fn().mockResolvedValue({
        overageSubscriptionItemId: 'si_overage_123',
        overageReportedSoFar: 40, // already reported the first 40
        currentPeriodStartIso: '2026-05-01T00:00:00Z',
        seatCount: 1,
      }),
    });

    const row = await reportOneOrg(ORG, BillingPlan.SOLO_PRO, deps, FIXED_NOW);

    // Total overage: 250 - 160 = 90. Already reported: 40. Delta: 50.
    expect(row.overage).toBe(90);
    expect(row.reported_increment).toBe(50);
    expect(reportToStripe).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 50 }),
    );
  });

  it('returns no_change when overage is unchanged from last run', async () => {
    auditFindMany.mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => ({ resourceId: `note_${i}` })),
    );
    const reportToStripe = vi.fn();
    const deps = makeDeps({
      reportToStripe,
      loadOrgUsageContext: vi.fn().mockResolvedValue({
        overageSubscriptionItemId: 'si_overage_123',
        overageReportedSoFar: 40, // already reported all 40 of overage
        currentPeriodStartIso: '2026-05-01T00:00:00Z',
        seatCount: 1,
      }),
    });

    const row = await reportOneOrg(ORG, BillingPlan.SOLO_PRO, deps, FIXED_NOW);
    expect(row.status).toBe('no_change');
    expect(row.reported_increment).toBe(0);
    expect(reportToStripe).not.toHaveBeenCalled();
  });
});

describe('reportOneOrg — per-seat plans scale the bundle', () => {
  it('PRACTICE org with 5 seats and 900 drafts → overage = 900 - 800 = 100', async () => {
    auditFindMany.mockResolvedValue(
      Array.from({ length: 900 }, (_, i) => ({ resourceId: `note_${i}` })),
    );
    const reportToStripe = vi.fn().mockResolvedValue({ ok: true });
    const deps = makeDeps({
      reportToStripe,
      loadOrgUsageContext: vi.fn().mockResolvedValue({
        overageSubscriptionItemId: 'si_overage_practice',
        overageReportedSoFar: 0,
        currentPeriodStartIso: '2026-05-01T00:00:00Z',
        seatCount: 5,
      }),
    });

    const row = await reportOneOrg(ORG, BillingPlan.PRACTICE, deps, FIXED_NOW);
    expect(row.drafts_included).toBe(800); // 5 × 160
    expect(row.overage).toBe(100);
    expect(row.reported_increment).toBe(100);
  });
});

describe('reportOneOrg — Stripe call failure', () => {
  it('returns failed status with error message; no exception thrown', async () => {
    auditFindMany.mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => ({ resourceId: `note_${i}` })),
    );
    const deps = makeDeps({
      reportToStripe: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Stripe rate-limited (429)',
      }),
    });
    const row = await reportOneOrg(ORG, BillingPlan.SOLO_PRO, deps, FIXED_NOW);
    expect(row.status).toBe('failed');
    expect(row.error).toBe('Stripe rate-limited (429)');
    expect(row.reported_increment).toBe(40);
  });
});

describe('formatYyyymmdd — UTC, zero-padded', () => {
  it('formats correctly for the Stripe idempotency key', () => {
    expect(formatYyyymmdd(new Date('2026-05-26T15:00:00Z'))).toBe('20260526');
    expect(formatYyyymmdd(new Date('2026-01-01T00:00:00Z'))).toBe('20260101');
    expect(formatYyyymmdd(new Date('2026-12-09T23:59:59Z'))).toBe('20261209');
  });
});
