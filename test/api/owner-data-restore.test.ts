import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { PlatformRole } from '@prisma/client';

const requirePlatformOwner = vi.fn();
vi.mock('@/lib/authz/platform', () => ({
  requirePlatformOwner: (...args: unknown[]) => requirePlatformOwner(...args),
}));

const writePlatformAuditLog = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  writePlatformAuditLog: (...args: unknown[]) => writePlatformAuditLog(...args),
}));

const organizationFindFirst = vi.fn();
const userFindFirst = vi.fn();
const deletedRecordLedgerFindFirst = vi.fn();
const organizationUpdate = vi.fn();
const userUpdate = vi.fn();
const seatUpdateMany = vi.fn();
const orgUserUpdateMany = vi.fn();
const deletedRecordLedgerUpdate = vi.fn();
const transaction = vi.fn();

const tx = {
  organization: { update: (...args: unknown[]) => organizationUpdate(...args) },
  user: { update: (...args: unknown[]) => userUpdate(...args) },
  seat: { updateMany: (...args: unknown[]) => seatUpdateMany(...args) },
  orgUser: { updateMany: (...args: unknown[]) => orgUserUpdateMany(...args) },
  deletedRecordLedger: { update: (...args: unknown[]) => deletedRecordLedgerUpdate(...args) },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { findFirst: (...args: unknown[]) => organizationFindFirst(...args) },
    user: { findFirst: (...args: unknown[]) => userFindFirst(...args) },
    deletedRecordLedger: { findFirst: (...args: unknown[]) => deletedRecordLedgerFindFirst(...args) },
    $transaction: (cb: (client: typeof tx) => Promise<unknown>) => transaction(cb),
  },
}));

import { POST as RESTORE_ORG } from '@/app/api/owner/orgs/[id]/restore/route';
import { POST as RESTORE_USER } from '@/app/api/owner/users/[id]/restore/route';

function postReq(url: string) {
  return new Request(url, { method: 'POST' });
}

beforeEach(() => {
  requirePlatformOwner.mockReset().mockResolvedValue({
    user: { id: 'owner-1', email: 'owner@demo.local' },
  });
  writePlatformAuditLog.mockReset().mockResolvedValue(undefined);
  organizationFindFirst.mockReset();
  userFindFirst.mockReset();
  deletedRecordLedgerFindFirst.mockReset();
  organizationUpdate.mockReset().mockResolvedValue({});
  userUpdate.mockReset().mockResolvedValue({});
  seatUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  orgUserUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  deletedRecordLedgerUpdate.mockReset().mockResolvedValue({});
  transaction.mockReset().mockImplementation(async (cb) => cb(tx));
});

describe('owner organization restore', () => {
  it('un-hides the org and reactivates exactly the recorded seats + memberships', async () => {
    organizationFindFirst.mockResolvedValueOnce({ id: 'org-1', name: 'Demo Clinic' });
    deletedRecordLedgerFindFirst.mockResolvedValueOnce({
      id: 'ledger-1',
      deactivatedOrgUserIds: ['ou-1', 'ou-2'],
      deactivatedSeatIds: ['seat-1'],
    });

    const res = await RESTORE_ORG(postReq('http://test.local/api/owner/orgs/org-1/restore'), {
      params: Promise.resolve({ id: 'org-1' }),
    });

    expect(res.status).toBe(200);
    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { isDeleted: false, deletedAt: null, deletedByUserId: null },
    });
    expect(seatUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['seat-1'] } },
      data: { isActive: true },
    });
    // Memberships reactivate only where the user isn't itself soft-deleted.
    expect(orgUserUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ou-1', 'ou-2'] }, user: { isDeleted: false } },
      data: { isActive: true },
    });
    expect(deletedRecordLedgerUpdate).toHaveBeenCalledWith({
      where: { id: 'ledger-1' },
      data: { restoredAt: expect.any(Date), restoredByUserId: 'owner-1' },
    });
    expect(writePlatformAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PLATFORM_ORG_RESTORED',
        resourceType: 'Organization',
        resourceId: 'org-1',
        metadata: expect.objectContaining({
          reactivatedOrgUserCount: 2,
          reactivatedSeatCount: 1,
          hadLedger: true,
        }),
        tx,
      }),
    );
  });

  it('restores even when no recovery ledger exists (no rows to reactivate)', async () => {
    organizationFindFirst.mockResolvedValueOnce({ id: 'org-2', name: 'Ledgerless' });
    deletedRecordLedgerFindFirst.mockResolvedValueOnce(null);

    const res = await RESTORE_ORG(postReq('http://test.local/api/owner/orgs/org-2/restore'), {
      params: Promise.resolve({ id: 'org-2' }),
    });

    expect(res.status).toBe(200);
    expect(organizationUpdate).toHaveBeenCalled();
    expect(seatUpdateMany).not.toHaveBeenCalled();
    expect(orgUserUpdateMany).not.toHaveBeenCalled();
    expect(deletedRecordLedgerUpdate).not.toHaveBeenCalled();
    expect(writePlatformAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PLATFORM_ORG_RESTORED',
        metadata: expect.objectContaining({ hadLedger: false }),
      }),
    );
  });

  it('404s when the org is not soft-deleted', async () => {
    organizationFindFirst.mockResolvedValueOnce(null);

    const res = await RESTORE_ORG(postReq('http://test.local/api/owner/orgs/missing/restore'), {
      params: Promise.resolve({ id: 'missing' }),
    });

    expect(res.status).toBe(404);
    expect(transaction).not.toHaveBeenCalled();
    expect(writePlatformAuditLog).not.toHaveBeenCalled();
  });

  it('blocks non-owners (guard error short-circuits before any work)', async () => {
    requirePlatformOwner.mockResolvedValueOnce({
      error: NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 }),
    });

    const res = await RESTORE_ORG(postReq('http://test.local/api/owner/orgs/org-1/restore'), {
      params: Promise.resolve({ id: 'org-1' }),
    });

    expect(res.status).toBe(403);
    expect(organizationFindFirst).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('owner user restore', () => {
  function ledger(overrides: Record<string, unknown> = {}) {
    return {
      id: 'uledger-1',
      originalEmail: 'jane@demo.local',
      originalName: 'Jane Doe',
      originalImage: null,
      originalPasswordHash: 'orig-hash',
      originalSigningPinHash: 'orig-pin',
      originalPlatformRole: PlatformRole.NONE,
      deactivatedOrgUserIds: ['ou-9'],
      ...overrides,
    };
  }

  it('reconstitutes identity from the ledger and reactivates memberships', async () => {
    userFindFirst.mockResolvedValueOnce({ id: 'user-1' }); // target
    deletedRecordLedgerFindFirst.mockResolvedValueOnce(ledger());
    userFindFirst.mockResolvedValueOnce(null); // no email collision

    const res = await RESTORE_USER(postReq('http://test.local/api/owner/users/user-1/restore'), {
      params: Promise.resolve({ id: 'user-1' }),
    });

    expect(res.status).toBe(200);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        email: 'jane@demo.local',
        name: 'Jane Doe',
        signingPinHash: 'orig-pin',
        platformRole: PlatformRole.NONE,
        isDeleted: false,
        deletedAt: null,
        deletedByUserId: null,
      }),
    });
    // Memberships reactivate only where the org isn't itself soft-deleted.
    expect(orgUserUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ou-9'] }, organization: { isDeleted: false } },
      data: { isActive: true },
    });
    expect(deletedRecordLedgerUpdate).toHaveBeenCalledWith({
      where: { id: 'uledger-1' },
      data: { restoredAt: expect.any(Date), restoredByUserId: 'owner-1' },
    });
    expect(writePlatformAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PLATFORM_USER_RESTORED',
        resourceType: 'User',
        resourceId: 'user-1',
        tx,
      }),
    );
  });

  it('never restores straight into PLATFORM_OWNER — clamps to NONE', async () => {
    userFindFirst.mockResolvedValueOnce({ id: 'user-2' });
    deletedRecordLedgerFindFirst.mockResolvedValueOnce(
      ledger({ originalPlatformRole: PlatformRole.PLATFORM_OWNER }),
    );
    userFindFirst.mockResolvedValueOnce(null);

    const res = await RESTORE_USER(postReq('http://test.local/api/owner/users/user-2/restore'), {
      params: Promise.resolve({ id: 'user-2' }),
    });

    expect(res.status).toBe(200);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: expect.objectContaining({ platformRole: PlatformRole.NONE }),
    });
    expect(writePlatformAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ restoredPlatformRole: PlatformRole.NONE }),
      }),
    );
  });

  it('404s when the user is not soft-deleted', async () => {
    userFindFirst.mockResolvedValueOnce(null);

    const res = await RESTORE_USER(postReq('http://test.local/api/owner/users/missing/restore'), {
      params: Promise.resolve({ id: 'missing' }),
    });

    expect(res.status).toBe(404);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('409s when there is no recovery ledger to reconstitute from', async () => {
    userFindFirst.mockResolvedValueOnce({ id: 'user-3' });
    deletedRecordLedgerFindFirst.mockResolvedValueOnce(null);

    const res = await RESTORE_USER(postReq('http://test.local/api/owner/users/user-3/restore'), {
      params: Promise.resolve({ id: 'user-3' }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('no_recovery_ledger');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('409s when the original email is now taken by another account', async () => {
    userFindFirst.mockResolvedValueOnce({ id: 'user-4' }); // target
    deletedRecordLedgerFindFirst.mockResolvedValueOnce(ledger());
    userFindFirst.mockResolvedValueOnce({ id: 'someone-else' }); // collision

    const res = await RESTORE_USER(postReq('http://test.local/api/owner/users/user-4/restore'), {
      params: Promise.resolve({ id: 'user-4' }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('email_in_use');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('blocks non-owners (guard error short-circuits before any work)', async () => {
    requirePlatformOwner.mockResolvedValueOnce({
      error: NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 }),
    });

    const res = await RESTORE_USER(postReq('http://test.local/api/owner/users/user-1/restore'), {
      params: Promise.resolve({ id: 'user-1' }),
    });

    expect(res.status).toBe(403);
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
