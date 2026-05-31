import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgRole, Division, BillingPlan, Profession } from '@prisma/client';

// ---------------------------------------------------------------------------
// POST /api/admin/invites — BillingPlan seat-cap enforcement.
//
// We mock auth + Prisma + email so the test exercises only the new
// seat-cap gate. The plan-policy lib itself has its own exhaustive
// unit tests; here we lock in that the route CALLS it correctly + returns
// a clean 409 with the upgrade message.
// ---------------------------------------------------------------------------

const requireAdminOrgRole = vi.fn();
const userFindUnique = vi.fn();
const orgFindUnique = vi.fn();
const contractFindUnique = vi.fn();
const orgUserCount = vi.fn();
const inviteCount = vi.fn();
const inviteCreate = vi.fn();
const auditLogCreate = vi.fn();
const sendTransactional = vi.fn();

vi.mock('@/lib/authz/server', () => ({
  requireAdminOrgRole: (...a: unknown[]) => requireAdminOrgRole(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    organization: { findUnique: (...a: unknown[]) => orgFindUnique(...a) },
    organizationCommercialContract: {
      findUnique: (...a: unknown[]) => contractFindUnique(...a),
    },
    orgUser: { count: (...a: unknown[]) => orgUserCount(...a) },
    invite: {
      count: (...a: unknown[]) => inviteCount(...a),
      create: (...a: unknown[]) => inviteCreate(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditLogCreate(...a) },
  },
}));
vi.mock('@/lib/email/transport', () => ({
  sendTransactional: (...a: unknown[]) => sendTransactional(...a),
}));
vi.mock('@/lib/email/templates/invite', () => ({
  buildInviteEmail: (a: unknown) => a, // identity — doesn't matter for the test
}));

import { POST } from '@/app/api/admin/invites/route';

const ADMIN_USER = 'user_admin';
const ORG_ID = 'org_demo';

function postReq(body: object): Request {
  return new Request('http://localhost/api/admin/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const baseInvite = {
  email: 'newhire@demo.local',
  role: OrgRole.CLINICIAN,
  division: Division.MEDICAL,
  // Recording roles (CLINICIAN/SITE_ADMIN) now require a concrete professionType —
  // see the superRefine in /api/admin/invites. Without it the route 400s before
  // the seat-cap gate this suite exercises.
  professionType: Profession.MD,
};

beforeEach(() => {
  requireAdminOrgRole.mockReset().mockResolvedValue({
    user: { id: ADMIN_USER, name: 'Admin', email: 'admin@demo.local' },
    orgUser: { orgId: ORG_ID },
  });
  userFindUnique.mockReset().mockResolvedValue(null);
  orgFindUnique.mockReset();
  contractFindUnique.mockReset().mockResolvedValue(null);
  orgUserCount.mockReset();
  inviteCount.mockReset().mockResolvedValue(0);
  inviteCreate.mockReset().mockResolvedValue({ id: 'inv_1' });
  auditLogCreate.mockReset().mockResolvedValue({});
  sendTransactional.mockReset().mockResolvedValue(undefined);
});

describe('seat-cap gate — Solo plan refuses 2nd seat', () => {
  it('returns 409 seat_cap_reached when SOLO_PRO already has 1 active user', async () => {
    orgFindUnique.mockResolvedValue({
      billingPlan: BillingPlan.SOLO_PRO,
      name: 'Demo Clinic',
    });
    orgUserCount.mockResolvedValue(1); // the admin is the 1 seat
    inviteCount.mockResolvedValue(0);

    const res = await POST(postReq(baseInvite));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('seat_cap_reached');
    expect(body.error.message).toMatch(/solo/i);
    expect(body.meta.billingPlan).toBe('SOLO_PRO');
    expect(body.meta.suggestPlan).toBe('DUO');

    // The route should NOT have created the invite or sent the email.
    expect(inviteCreate).not.toHaveBeenCalled();
    expect(sendTransactional).not.toHaveBeenCalled();
  });

  it('counts pending invites toward the cap (no spam-past-cap exploit)', async () => {
    orgFindUnique.mockResolvedValue({
      billingPlan: BillingPlan.SOLO_STARTER,
      name: 'Demo Clinic',
    });
    orgUserCount.mockResolvedValue(0); // no active users yet
    inviteCount.mockResolvedValue(1); // ONE invite already pending

    const res = await POST(postReq(baseInvite));
    expect(res.status).toBe(409);
    expect(inviteCreate).not.toHaveBeenCalled();
  });
});

describe('seat-cap gate — Duo refuses 3rd seat', () => {
  it('returns 409 with Practice upgrade suggestion', async () => {
    orgFindUnique.mockResolvedValue({
      billingPlan: BillingPlan.DUO,
      name: 'Demo Clinic',
    });
    orgUserCount.mockResolvedValue(2);
    inviteCount.mockResolvedValue(0);

    const res = await POST(postReq(baseInvite));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toMatch(/practice/i);
    expect(body.meta.suggestPlan).toBe('PRACTICE');
  });
});

describe('seat-cap gate — Practice allows up to 49 seats', () => {
  it('allows the 4th seat on PRACTICE (under cap)', async () => {
    orgFindUnique.mockResolvedValue({
      billingPlan: BillingPlan.PRACTICE,
      name: 'Demo Clinic',
    });
    orgUserCount.mockResolvedValue(3); // 3 active = at min, can add more
    inviteCount.mockResolvedValue(0);

    const res = await POST(postReq(baseInvite));
    expect(res.status).toBe(200);
    expect(inviteCreate).toHaveBeenCalledTimes(1);
    expect(sendTransactional).toHaveBeenCalledTimes(1);
  });

  it('refuses the 50th seat with Enterprise upgrade', async () => {
    orgFindUnique.mockResolvedValue({
      billingPlan: BillingPlan.PRACTICE,
      name: 'Demo Clinic',
    });
    orgUserCount.mockResolvedValue(49);
    inviteCount.mockResolvedValue(0);

    const res = await POST(postReq(baseInvite));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toMatch(/enterprise/i);
  });
});

describe('seat-cap gate — Trial', () => {
  it('refuses to invite a 2nd user on a TRIAL org (forces upgrade)', async () => {
    orgFindUnique.mockResolvedValue({
      billingPlan: BillingPlan.TRIAL,
      name: 'Demo Clinic',
    });
    orgUserCount.mockResolvedValue(1);
    inviteCount.mockResolvedValue(0);

    const res = await POST(postReq(baseInvite));
    expect(res.status).toBe(409);
  });
});

describe('seat-cap gate — happy path on a PRACTICE org', () => {
  it('creates the invite + writes the audit row when under cap', async () => {
    orgFindUnique.mockResolvedValue({
      billingPlan: BillingPlan.PRACTICE,
      name: 'Demo Clinic',
    });
    orgUserCount.mockResolvedValue(5);
    inviteCount.mockResolvedValue(0);

    const res = await POST(postReq(baseInvite));
    expect(res.status).toBe(200);
    expect(auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'INVITE_SENT',
        }),
      }),
    );
  });
});
