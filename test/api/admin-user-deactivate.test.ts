import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgRole, Division } from '@prisma/client';

/**
 * PATCH /api/admin/users/[id] — deactivate/reactivate surface.
 *
 * Confirms an org admin's deactivate:
 *   - frees the held seat (nulls seatId + records a SeatTransfer)
 *   - wipes sessions + audits USER_DEACTIVATED with the freed seat noted
 *   - is strictly org-scoped (a user outside the admin's org is 404)
 */

const requireFeatureAccess = vi.fn();
vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...args: unknown[]) => requireFeatureAccess(...args),
}));

const writeAuditLog = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLog(...args),
}));

const orgUserFindFirst = vi.fn();
const orgUserUpdate = vi.fn();
const seatTransferCreate = vi.fn();
const userSessionDeleteMany = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    orgUser: {
      findFirst: (...a: unknown[]) => orgUserFindFirst(...a),
      update: (...a: unknown[]) => orgUserUpdate(...a),
    },
    seatTransfer: { create: (...a: unknown[]) => seatTransferCreate(...a) },
    userSession: { deleteMany: (...a: unknown[]) => userSessionDeleteMany(...a) },
  },
}));

import { PATCH } from '@/app/api/admin/users/[id]/route';

function patchReq(body: unknown) {
  return new Request('http://test.local/api/admin/users/u_target', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function orgUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ou_target',
    userId: 'u_target',
    orgId: 'org_1',
    role: OrgRole.CLINICIAN,
    division: Division.MEDICAL,
    canManagePatients: false,
    isActive: true,
    seatId: 'seat_1',
    ...overrides,
  };
}

beforeEach(() => {
  requireFeatureAccess.mockReset().mockResolvedValue({
    user: { id: 'u_admin', email: 'admin@x.com' },
    authorizationUser: { orgId: 'org_1' },
    orgUser: { orgId: 'org_1' },
  });
  writeAuditLog.mockReset().mockResolvedValue(undefined);
  orgUserFindFirst.mockReset();
  orgUserUpdate.mockReset();
  seatTransferCreate.mockReset().mockResolvedValue({ id: 'st_1' });
  userSessionDeleteMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('admin user deactivate / reactivate', () => {
  it('frees the held seat on deactivation and notes it in the audit row', async () => {
    orgUserFindFirst.mockResolvedValueOnce(orgUserRow());
    orgUserUpdate.mockResolvedValueOnce(orgUserRow({ isActive: false, seatId: null }));

    const res = await PATCH(patchReq({ isActive: false }), {
      params: Promise.resolve({ id: 'u_target' }),
    });

    expect(res.status).toBe(200);
    // seatId is nulled in the same update that deactivates the membership.
    expect(orgUserUpdate).toHaveBeenCalledWith({
      where: { id: 'ou_target' },
      data: expect.objectContaining({ isActive: false, seatId: null }),
    });
    // The freed seat returns to the pool with a transfer-history row.
    expect(seatTransferCreate).toHaveBeenCalledWith({
      data: {
        seatId: 'seat_1',
        fromOrgUserId: 'ou_target',
        toOrgUserId: null,
        reason: 'Freed on deactivation',
      },
    });
    expect(userSessionDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u_target' } });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'USER_DEACTIVATED',
        resourceType: 'OrgUser',
        resourceId: 'ou_target',
        metadata: expect.objectContaining({ freedSeatId: 'seat_1' }),
      }),
    );
  });

  it('deactivates a seatless member without a seat transfer', async () => {
    orgUserFindFirst.mockResolvedValueOnce(orgUserRow({ seatId: null }));
    orgUserUpdate.mockResolvedValueOnce(orgUserRow({ isActive: false, seatId: null }));

    const res = await PATCH(patchReq({ isActive: false }), {
      params: Promise.resolve({ id: 'u_target' }),
    });

    expect(res.status).toBe(200);
    expect(seatTransferCreate).not.toHaveBeenCalled();
    expect(orgUserUpdate).toHaveBeenCalledWith({
      where: { id: 'ou_target' },
      // No seatId key when there was no seat to free.
      data: expect.not.objectContaining({ seatId: null }),
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'USER_DEACTIVATED',
        metadata: expect.not.objectContaining({ freedSeatId: expect.anything() }),
      }),
    );
  });

  it('reactivates a member without freeing a seat or wiping sessions', async () => {
    orgUserFindFirst.mockResolvedValueOnce(orgUserRow({ isActive: false, seatId: null }));
    orgUserUpdate.mockResolvedValueOnce(orgUserRow({ isActive: true, seatId: null }));

    const res = await PATCH(patchReq({ isActive: true }), {
      params: Promise.resolve({ id: 'u_target' }),
    });

    expect(res.status).toBe(200);
    expect(seatTransferCreate).not.toHaveBeenCalled();
    expect(userSessionDeleteMany).not.toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_UPDATED' }),
    );
  });

  it('is org-scoped — a user outside the admin org is not found', async () => {
    // findFirst is constrained to the admin's orgId, so a foreign user yields null.
    orgUserFindFirst.mockResolvedValueOnce(null);

    const res = await PATCH(patchReq({ isActive: false }), {
      params: Promise.resolve({ id: 'u_foreign' }),
    });

    expect(res.status).toBe(404);
    expect(orgUserFindFirst).toHaveBeenCalledWith({
      where: { userId: 'u_foreign', orgId: 'org_1' },
    });
    expect(orgUserUpdate).not.toHaveBeenCalled();
    expect(seatTransferCreate).not.toHaveBeenCalled();
  });
});
