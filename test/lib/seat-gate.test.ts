import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// checkClinicianSeat — the gate every note-creation route runs before
// startVisit. isStripeConfigured + prisma are mocked.
// ---------------------------------------------------------------------------

const isStripeConfigured = vi.fn();
const orgUserFindUnique = vi.fn();

vi.mock('@/lib/stripe/env', () => ({
  isStripeConfigured: () => isStripeConfigured(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { orgUser: { findUnique: (...a: unknown[]) => orgUserFindUnique(...a) } },
}));

import { checkClinicianSeat, seatRequiredResponse } from '@/lib/authz/seat';

const DAY = 24 * 60 * 60 * 1000;
const FUTURE = new Date(Date.now() + 30 * DAY);
const PAST = new Date(Date.now() - DAY);

beforeEach(() => {
  isStripeConfigured.mockReset().mockReturnValue(true);
  orgUserFindUnique.mockReset();
});

describe('checkClinicianSeat', () => {
  it('is inert (ok) when Stripe is not configured — and never reads the DB', async () => {
    isStripeConfigured.mockReturnValue(false);
    expect(await checkClinicianSeat('ou_1')).toEqual({ ok: true });
    expect(orgUserFindUnique).not.toHaveBeenCalled();
  });

  it('lets an org admin through without a seat', async () => {
    orgUserFindUnique.mockResolvedValue({ role: 'ORG_ADMIN', seat: null });
    expect(await checkClinicianSeat('ou_admin')).toEqual({ ok: true });
  });

  it('lets a clinician with an active, unexpired seat through', async () => {
    orgUserFindUnique.mockResolvedValue({
      role: 'CLINICIAN',
      seat: { isActive: true, expiresAt: FUTURE },
    });
    expect(await checkClinicianSeat('ou_1')).toEqual({ ok: true });
  });

  it('blocks a clinician with no seat', async () => {
    orgUserFindUnique.mockResolvedValue({ role: 'CLINICIAN', seat: null });
    expect(await checkClinicianSeat('ou_1')).toEqual({ ok: false, reason: 'no_seat' });
  });

  it('blocks a site admin with no seat (only ORG_ADMIN bypasses)', async () => {
    orgUserFindUnique.mockResolvedValue({ role: 'SITE_ADMIN', seat: null });
    expect(await checkClinicianSeat('ou_1')).toEqual({ ok: false, reason: 'no_seat' });
  });

  it('blocks a clinician whose seat is inactive', async () => {
    orgUserFindUnique.mockResolvedValue({
      role: 'CLINICIAN',
      seat: { isActive: false, expiresAt: FUTURE },
    });
    expect(await checkClinicianSeat('ou_1')).toEqual({ ok: false, reason: 'no_seat' });
  });

  it('blocks a clinician whose seat has expired', async () => {
    orgUserFindUnique.mockResolvedValue({
      role: 'CLINICIAN',
      seat: { isActive: true, expiresAt: PAST },
    });
    expect(await checkClinicianSeat('ou_1')).toEqual({ ok: false, reason: 'no_seat' });
  });

  it('blocks when the OrgUser row is missing', async () => {
    orgUserFindUnique.mockResolvedValue(null);
    expect(await checkClinicianSeat('ou_missing')).toEqual({
      ok: false,
      reason: 'no_org_user',
    });
  });
});

describe('seatRequiredResponse', () => {
  it('is a 403 carrying the no_seat_assigned code', async () => {
    const res = seatRequiredResponse();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('no_seat_assigned');
  });
});
