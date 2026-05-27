import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// GET /api/health/stripe — the org-scoped Stripe self-check. authz, prisma,
// and the env helper are mocked; the handler's shape + guard behavior is
// what's under test.
// ---------------------------------------------------------------------------

const requireFeatureAccess = vi.fn();
const orgFindUnique = vi.fn();
const seatGroupBy = vi.fn();
const orgUserCount = vi.fn();
const auditFindFirst = vi.fn();
const isStripeConfigured = vi.fn();
const getPublicBaseUrl = vi.fn();

vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { findUnique: (...a: unknown[]) => orgFindUnique(...a) },
    seat: { groupBy: (...a: unknown[]) => seatGroupBy(...a) },
    orgUser: { count: (...a: unknown[]) => orgUserCount(...a) },
    auditLog: { findFirst: (...a: unknown[]) => auditFindFirst(...a) },
  },
}));
vi.mock('@/lib/stripe/env', () => ({
  isStripeConfigured: () => isStripeConfigured(),
  getPublicBaseUrl: () => getPublicBaseUrl(),
}));

import { GET } from '@/app/api/health/stripe/route';
import { NextResponse } from 'next/server';

function getReq(): Request {
  return new Request('http://localhost/api/health/stripe');
}

type Body = {
  data?: {
    configured: boolean;
    publicBaseUrl: string;
    hasCustomer: boolean;
    seats: { active: number; inactive: number; assigned: number };
    lastWebhookAt: string | null;
    lastWebhookAction: string | null;
    lastCheckoutAt: string | null;
    lastPaymentFailedAt: string | null;
  };
  error?: { code?: string };
};

async function bodyOf(res: Response): Promise<Body> {
  return (await res.json()) as Body;
}

beforeEach(() => {
  requireFeatureAccess.mockReset().mockResolvedValue({
    user: { id: 'user_admin' },
    authorizationUser: { orgId: 'org_1' },
    orgUser: { id: 'ou_admin' },
  });
  orgFindUnique.mockReset();
  seatGroupBy.mockReset().mockResolvedValue([]);
  orgUserCount.mockReset().mockResolvedValue(0);
  auditFindFirst.mockReset().mockResolvedValue(null);
  isStripeConfigured.mockReset().mockReturnValue(true);
  getPublicBaseUrl.mockReset().mockReturnValue('https://omniscribe.example.com');
});

describe('GET /api/health/stripe', () => {
  it('returns the full snapshot for a healthy subscribed org', async () => {
    orgFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_123' });
    seatGroupBy.mockResolvedValue([
      { isActive: true, _count: { _all: 5 } },
      { isActive: false, _count: { _all: 2 } },
    ]);
    orgUserCount.mockResolvedValue(4);
    auditFindFirst
      .mockResolvedValueOnce({
        createdAt: new Date('2026-05-20T10:00:00.000Z'),
        action: 'STRIPE_SUBSCRIPTION_UPDATED',
      })
      .mockResolvedValueOnce({ createdAt: new Date('2026-05-18T08:30:00.000Z') })
      .mockResolvedValueOnce(null);

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data).toEqual({
      configured: true,
      publicBaseUrl: 'https://omniscribe.example.com',
      hasCustomer: true,
      seats: { active: 5, inactive: 2, assigned: 4 },
      lastWebhookAt: '2026-05-20T10:00:00.000Z',
      lastWebhookAction: 'STRIPE_SUBSCRIPTION_UPDATED',
      lastCheckoutAt: '2026-05-18T08:30:00.000Z',
      lastPaymentFailedAt: null,
    });
  });

  it('returns configured=false with the rest of the shape intact when Stripe is unconfigured', async () => {
    isStripeConfigured.mockReturnValue(false);
    orgFindUnique.mockResolvedValue({ stripeCustomerId: null });

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data?.configured).toBe(false);
    expect(body.data?.hasCustomer).toBe(false);
    expect(body.data?.seats).toEqual({ active: 0, inactive: 0, assigned: 0 });
    expect(body.data?.lastWebhookAt).toBeNull();
  });

  it('reports hasCustomer=false even with active legacy seats (e.g. seed data)', async () => {
    orgFindUnique.mockResolvedValue({ stripeCustomerId: null });
    seatGroupBy.mockResolvedValue([{ isActive: true, _count: { _all: 3 } }]);
    orgUserCount.mockResolvedValue(2);

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.data?.hasCustomer).toBe(false);
    expect(body.data?.seats.active).toBe(3);
    expect(body.data?.seats.assigned).toBe(2);
  });

  it('surfaces a recent payment failure', async () => {
    orgFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_123' });
    auditFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ createdAt: new Date('2026-05-24T15:00:00.000Z') });

    const res = await GET(getReq());
    const body = await bodyOf(res);
    expect(body.data?.lastPaymentFailedAt).toBe('2026-05-24T15:00:00.000Z');
  });

  it('bubbles up the authz guard error (401/403) without hitting prisma', async () => {
    requireFeatureAccess.mockResolvedValue({
      error: NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 }),
    });

    const res = await GET(getReq());
    expect(res.status).toBe(403);
    expect((await bodyOf(res)).error?.code).toBe('forbidden');
    expect(orgFindUnique).not.toHaveBeenCalled();
    expect(seatGroupBy).not.toHaveBeenCalled();
    expect(auditFindFirst).not.toHaveBeenCalled();
  });

  it('scopes every prisma read to the caller\'s orgId', async () => {
    orgFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_123' });

    await GET(getReq());

    expect(orgFindUnique).toHaveBeenCalledWith({
      where: { id: 'org_1' },
      select: { stripeCustomerId: true },
    });
    expect(seatGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: 'org_1' } }),
    );
    expect(orgUserCount).toHaveBeenCalledWith({
      where: { orgId: 'org_1', seatId: { not: null } },
    });
    for (const call of auditFindFirst.mock.calls) {
      expect((call[0] as { where: { orgId: string } }).where.orgId).toBe('org_1');
    }
  });
});
