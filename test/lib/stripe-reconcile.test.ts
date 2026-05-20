import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

// ---------------------------------------------------------------------------
// reconcileSeats is the keystone of the subscription pipeline — it turns a
// Stripe subscription's seat `quantity` into Seat rows. prisma is mocked; the
// createMany / updateMany doubles derive their `count` from the call args so
// the returned ReconcileResult is deterministic.
// ---------------------------------------------------------------------------

const orgUpdate = vi.fn();
const seatFindMany = vi.fn();
const seatCreateMany = vi.fn();
const seatUpdateMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { update: (...a: unknown[]) => orgUpdate(...a) },
    seat: {
      findMany: (...a: unknown[]) => seatFindMany(...a),
      createMany: (...a: unknown[]) => seatCreateMany(...a),
      updateMany: (...a: unknown[]) => seatUpdateMany(...a),
    },
  },
}));

import { reconcileSeats } from '@/lib/stripe/reconcile';

type FakeSeat = {
  id: string;
  isActive: boolean;
  assignedTo: { id: string } | null;
  createdAt: Date;
};

function seat(id: string, isActive = true, assigned = false): FakeSeat {
  return { id, isActive, assignedTo: assigned ? { id: `ou_${id}` } : null, createdAt: new Date() };
}

function makeSub(over: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    metadata: { orgId: 'org_1', tier: 'TEAM' },
    items: { data: [{ quantity: 3, price: { id: 'price_team' } }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

function withQuantity(quantity: number): Record<string, unknown> {
  return { items: { data: [{ quantity, price: { id: 'price_team' } }] } };
}

beforeEach(() => {
  orgUpdate.mockReset().mockResolvedValue({});
  seatFindMany.mockReset().mockResolvedValue([]);
  seatCreateMany.mockReset().mockImplementation((args: { data: unknown[] }) =>
    Promise.resolve({ count: args.data.length }),
  );
  seatUpdateMany.mockReset().mockImplementation((args: { where?: { id?: { in?: unknown[] } } }) => {
    const ids = args?.where?.id?.in;
    return Promise.resolve({ count: Array.isArray(ids) ? ids.length : 0 });
  });
});

describe('reconcileSeats', () => {
  it('returns null and touches nothing when the subscription has no orgId metadata', async () => {
    const result = await reconcileSeats(makeSub({ metadata: {} }));
    expect(result).toBeNull();
    expect(orgUpdate).not.toHaveBeenCalled();
    expect(seatFindMany).not.toHaveBeenCalled();
    expect(seatCreateMany).not.toHaveBeenCalled();
  });

  it('new subscription: creates `quantity` unassigned seats and links the Stripe customer', async () => {
    seatFindMany.mockResolvedValue([]);
    const result = await reconcileSeats(makeSub(withQuantity(3)));

    expect(orgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'org_1' }, data: { stripeCustomerId: 'cus_1' } }),
    );
    expect(seatCreateMany).toHaveBeenCalledTimes(1);
    const createArg = seatCreateMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> };
    expect(createArg.data).toHaveLength(3);
    expect(createArg.data[0]).toMatchObject({
      orgId: 'org_1',
      tier: 'TEAM',
      isActive: true,
      stripeSubId: 'sub_1',
    });
    expect(result).toMatchObject({ active: true, created: 3, reactivated: 0, deactivated: 0 });
  });

  it('upgrade: creates only the delta of new seats', async () => {
    seatFindMany.mockResolvedValue([seat('s1'), seat('s2'), seat('s3')]);
    const result = await reconcileSeats(makeSub(withQuantity(5)));

    const createArg = seatCreateMany.mock.calls[0]![0] as { data: unknown[] };
    expect(createArg.data).toHaveLength(2);
    expect(result).toMatchObject({ created: 2, reactivated: 0 });
  });

  it('downgrade: deactivates unassigned seats only, never assigned ones', async () => {
    // 5 active: s1–s3 assigned, s4–s5 unassigned. Quantity drops to 3 (diff -2).
    seatFindMany.mockResolvedValue([
      seat('s1', true, true),
      seat('s2', true, true),
      seat('s3', true, true),
      seat('s4', true, false),
      seat('s5', true, false),
    ]);
    await reconcileSeats(makeSub(withQuantity(3)));

    expect(seatCreateMany).not.toHaveBeenCalled();
    expect(seatUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['s4', 's5'] } },
        data: { isActive: false },
      }),
    );
  });

  it('downgrade below assigned-seat count: deactivates only the available unassigned seats', async () => {
    // 4 assigned + 1 unassigned, quantity drops to 1 (diff -4). Only s5 can go.
    seatFindMany.mockResolvedValue([
      seat('s1', true, true),
      seat('s2', true, true),
      seat('s3', true, true),
      seat('s4', true, true),
      seat('s5', true, false),
    ]);
    await reconcileSeats(makeSub(withQuantity(1)));

    expect(seatUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['s5'] } }, data: { isActive: false } }),
    );
  });

  it('re-upgrade: reactivates previously-deactivated seats before creating new ones', async () => {
    // 3 active + 2 inactive, quantity back to 5 (diff +2).
    seatFindMany.mockResolvedValue([
      seat('s1'),
      seat('s2'),
      seat('s3'),
      seat('s4', false),
      seat('s5', false),
    ]);
    const result = await reconcileSeats(makeSub(withQuantity(5)));

    expect(seatCreateMany).not.toHaveBeenCalled();
    expect(seatUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['s4', 's5'] } }, data: { isActive: true } }),
    );
    expect(result).toMatchObject({ reactivated: 2, created: 0 });
  });

  it('inactive subscription (past_due): deactivates every sub seat, creates nothing', async () => {
    seatFindMany.mockResolvedValue([seat('s1'), seat('s2')]);
    const result = await reconcileSeats(makeSub({ status: 'past_due' }));

    expect(seatCreateMany).not.toHaveBeenCalled();
    expect(seatUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: 'org_1', stripeSubId: 'sub_1', isActive: true },
        data: { isActive: false },
      }),
    );
    expect(result).toMatchObject({ active: false, created: 0 });
  });
});
