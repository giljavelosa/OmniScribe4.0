import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// POST /api/admin/seats — the seat assign / revoke handler. authz, prisma, and
// the audit writer are mocked; the handler logic (guards + transaction shape)
// is what's under test.
// ---------------------------------------------------------------------------

const requireFeatureAccess = vi.fn();
const seatFindFirst = vi.fn();
const orgUserFindFirst = vi.fn();
const orgUserUpdate = vi.fn();
const seatTransferCreate = vi.fn();
const transaction = vi.fn();
const writeAuditLog = vi.fn();

vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    seat: { findFirst: (...a: unknown[]) => seatFindFirst(...a) },
    orgUser: {
      findFirst: (...a: unknown[]) => orgUserFindFirst(...a),
      update: (...a: unknown[]) => orgUserUpdate(...a),
    },
    seatTransfer: { create: (...a: unknown[]) => seatTransferCreate(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

import { POST } from '@/app/api/admin/seats/route';

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/admin/seats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function bodyOf(res: Response): Promise<{ error?: { code?: string }; data?: unknown }> {
  return (await res.json()) as { error?: { code?: string }; data?: unknown };
}

beforeEach(() => {
  requireFeatureAccess.mockReset().mockResolvedValue({
    user: { id: 'user_admin' },
    authorizationUser: { orgId: 'org_1' },
    orgUser: { id: 'ou_admin' },
  });
  seatFindFirst.mockReset();
  orgUserFindFirst.mockReset();
  orgUserUpdate.mockReset().mockResolvedValue({});
  seatTransferCreate.mockReset().mockResolvedValue({});
  transaction.mockReset().mockResolvedValue([]);
  writeAuditLog.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/admin/seats — assign', () => {
  it('assigns an active, unassigned seat to a non-admin member', async () => {
    seatFindFirst.mockResolvedValue({
      id: 'seat_1',
      orgId: 'org_1',
      isActive: true,
      tier: 'TEAM',
      assignedTo: null,
    });
    orgUserFindFirst.mockResolvedValue({
      id: 'ou_1',
      orgId: 'org_1',
      isActive: true,
      role: 'CLINICIAN',
      seatId: null,
    });

    const res = await POST(postReq({ action: 'assign', seatId: 'seat_1', orgUserId: 'ou_1' }));
    expect(res.status).toBe(200);

    expect(orgUserUpdate).toHaveBeenCalledWith({
      where: { id: 'ou_1' },
      data: { seatId: 'seat_1' },
    });
    expect(seatTransferCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        seatId: 'seat_1',
        fromOrgUserId: null,
        toOrgUserId: 'ou_1',
      }),
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SEAT_ASSIGNED', resourceId: 'seat_1' }),
    );
  });

  it('rejects assigning a seat that is already taken', async () => {
    seatFindFirst.mockResolvedValue({
      id: 'seat_1',
      orgId: 'org_1',
      isActive: true,
      tier: 'TEAM',
      assignedTo: { id: 'ou_other' },
    });

    const res = await POST(postReq({ action: 'assign', seatId: 'seat_1', orgUserId: 'ou_1' }));
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error?.code).toBe('seat_taken');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects assigning an inactive seat', async () => {
    seatFindFirst.mockResolvedValue({
      id: 'seat_1',
      orgId: 'org_1',
      isActive: false,
      tier: 'TEAM',
      assignedTo: null,
    });

    const res = await POST(postReq({ action: 'assign', seatId: 'seat_1', orgUserId: 'ou_1' }));
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error?.code).toBe('seat_inactive');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses to assign a seat to an org admin', async () => {
    seatFindFirst.mockResolvedValue({
      id: 'seat_1',
      orgId: 'org_1',
      isActive: true,
      tier: 'TEAM',
      assignedTo: null,
    });
    orgUserFindFirst.mockResolvedValue({
      id: 'ou_admin2',
      orgId: 'org_1',
      isActive: true,
      role: 'ORG_ADMIN',
      seatId: null,
    });

    const res = await POST(postReq({ action: 'assign', seatId: 'seat_1', orgUserId: 'ou_admin2' }));
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error?.code).toBe('admin_no_seat');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects assigning to a user who already holds a seat', async () => {
    seatFindFirst.mockResolvedValue({
      id: 'seat_1',
      orgId: 'org_1',
      isActive: true,
      tier: 'TEAM',
      assignedTo: null,
    });
    orgUserFindFirst.mockResolvedValue({
      id: 'ou_1',
      orgId: 'org_1',
      isActive: true,
      role: 'CLINICIAN',
      seatId: 'seat_existing',
    });

    const res = await POST(postReq({ action: 'assign', seatId: 'seat_1', orgUserId: 'ou_1' }));
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error?.code).toBe('already_seated');
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/seats — revoke', () => {
  it('revokes an assigned seat, returning it to the unassigned pool', async () => {
    seatFindFirst.mockResolvedValue({
      id: 'seat_1',
      orgId: 'org_1',
      isActive: true,
      tier: 'TEAM',
      assignedTo: { id: 'ou_1' },
    });

    const res = await POST(postReq({ action: 'revoke', seatId: 'seat_1' }));
    expect(res.status).toBe(200);

    expect(orgUserUpdate).toHaveBeenCalledWith({
      where: { id: 'ou_1' },
      data: { seatId: null },
    });
    expect(seatTransferCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        seatId: 'seat_1',
        fromOrgUserId: 'ou_1',
        toOrgUserId: null,
      }),
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SEAT_REVOKED', resourceId: 'seat_1' }),
    );
  });

  it('rejects revoking a seat that is not assigned', async () => {
    seatFindFirst.mockResolvedValue({
      id: 'seat_1',
      orgId: 'org_1',
      isActive: true,
      tier: 'TEAM',
      assignedTo: null,
    });

    const res = await POST(postReq({ action: 'revoke', seatId: 'seat_1' }));
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error?.code).toBe('not_assigned');
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/seats — guards', () => {
  it('404s when the seat is not in the org', async () => {
    seatFindFirst.mockResolvedValue(null);
    const res = await POST(postReq({ action: 'revoke', seatId: 'missing' }));
    expect(res.status).toBe(404);
  });

  it('400s on a malformed body', async () => {
    const res = await POST(postReq({ action: 'frobnicate' }));
    expect(res.status).toBe(400);
    expect(seatFindFirst).not.toHaveBeenCalled();
  });
});
