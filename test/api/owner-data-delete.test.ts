import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformRole } from '@prisma/client';

const requirePlatformOwner = vi.fn();
vi.mock('@/lib/authz/platform', () => ({
  requirePlatformOwner: (...args: unknown[]) => requirePlatformOwner(...args),
}));

const writePlatformAuditLog = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  writePlatformAuditLog: (...args: unknown[]) => writePlatformAuditLog(...args),
}));

const hashPassword = vi.fn();
vi.mock('bcryptjs', () => ({
  default: { hash: (...args: unknown[]) => hashPassword(...args) },
}));

const organizationFindFirst = vi.fn();
const organizationUpdate = vi.fn();
const inviteDeleteMany = vi.fn();
const seatUpdateMany = vi.fn();
const seatFindMany = vi.fn();
const orgUserUpdateMany = vi.fn();
const orgUserFindMany = vi.fn();
const deletedRecordLedgerCreate = vi.fn();
const userFindFirst = vi.fn();
const userUpdate = vi.fn();
const passwordResetTokenDeleteMany = vi.fn();
const userSessionDeleteMany = vi.fn();
const platformSessionDeleteMany = vi.fn();
const copilotMessageDeleteMany = vi.fn();
const copilotConversationDeleteMany = vi.fn();
const copilotPatientStateDeleteMany = vi.fn();
const cleoNudgeDeleteMany = vi.fn();
const fhirIdentityDeleteMany = vi.fn();
const practitionerProfileDeleteMany = vi.fn();
const voiceProfileUpdateMany = vi.fn();
const orgUserSiteDeleteMany = vi.fn();
const transaction = vi.fn();

const tx = {
  organization: { update: (...args: unknown[]) => organizationUpdate(...args) },
  invite: { deleteMany: (...args: unknown[]) => inviteDeleteMany(...args) },
  seat: {
    updateMany: (...args: unknown[]) => seatUpdateMany(...args),
    findMany: (...args: unknown[]) => seatFindMany(...args),
  },
  orgUser: {
    updateMany: (...args: unknown[]) => orgUserUpdateMany(...args),
    findMany: (...args: unknown[]) => orgUserFindMany(...args),
  },
  deletedRecordLedger: { create: (...args: unknown[]) => deletedRecordLedgerCreate(...args) },
  user: { update: (...args: unknown[]) => userUpdate(...args) },
  passwordResetToken: { deleteMany: (...args: unknown[]) => passwordResetTokenDeleteMany(...args) },
  userSession: { deleteMany: (...args: unknown[]) => userSessionDeleteMany(...args) },
  platformSession: { deleteMany: (...args: unknown[]) => platformSessionDeleteMany(...args) },
  copilotMessage: { deleteMany: (...args: unknown[]) => copilotMessageDeleteMany(...args) },
  copilotConversation: { deleteMany: (...args: unknown[]) => copilotConversationDeleteMany(...args) },
  copilotPatientState: { deleteMany: (...args: unknown[]) => copilotPatientStateDeleteMany(...args) },
  cleoNudge: { deleteMany: (...args: unknown[]) => cleoNudgeDeleteMany(...args) },
  fhirIdentity: { deleteMany: (...args: unknown[]) => fhirIdentityDeleteMany(...args) },
  practitionerProfile: { deleteMany: (...args: unknown[]) => practitionerProfileDeleteMany(...args) },
  voiceProfile: { updateMany: (...args: unknown[]) => voiceProfileUpdateMany(...args) },
  orgUserSite: { deleteMany: (...args: unknown[]) => orgUserSiteDeleteMany(...args) },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { findFirst: (...args: unknown[]) => organizationFindFirst(...args) },
    user: { findFirst: (...args: unknown[]) => userFindFirst(...args) },
    $transaction: (cb: (client: typeof tx) => Promise<unknown>) => transaction(cb),
  },
}));

import { DELETE as DELETE_ORG } from '@/app/api/owner/orgs/[id]/route';
import { DELETE as DELETE_USER } from '@/app/api/owner/users/[id]/route';

function deleteReq(url: string, body: object) {
  return new Request(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requirePlatformOwner.mockReset().mockResolvedValue({
    user: { id: 'owner-1', email: 'owner@demo.local' },
  });
  writePlatformAuditLog.mockReset().mockResolvedValue(undefined);
  hashPassword.mockReset().mockResolvedValue('hashed-deleted-password');
  organizationFindFirst.mockReset();
  organizationUpdate.mockReset().mockResolvedValue({});
  inviteDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  seatUpdateMany.mockReset().mockResolvedValue({ count: 2 });
  seatFindMany.mockReset().mockResolvedValue([{ id: 'seat-1' }, { id: 'seat-2' }]);
  orgUserUpdateMany.mockReset().mockResolvedValue({ count: 3 });
  orgUserFindMany.mockReset().mockResolvedValue([{ id: 'ou-1' }, { id: 'ou-2' }]);
  deletedRecordLedgerCreate.mockReset().mockResolvedValue({ id: 'ledger-1' });
  userFindFirst.mockReset();
  userUpdate.mockReset().mockResolvedValue({});
  passwordResetTokenDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  userSessionDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  platformSessionDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  copilotMessageDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  copilotConversationDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  copilotPatientStateDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  cleoNudgeDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  fhirIdentityDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  practitionerProfileDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  voiceProfileUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  orgUserSiteDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  transaction.mockReset().mockImplementation(async (cb) => cb(tx));
});

describe('owner data deletion', () => {
  it('soft-deletes an organization and deactivates access rows', async () => {
    organizationFindFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Demo Clinic',
      _count: { orgUsers: 3, patients: 12, seats: 3, invites: 1 },
    });

    const res = await DELETE_ORG(
      deleteReq('http://test.local/api/owner/orgs/org-1', { confirmName: 'Demo Clinic' }),
      { params: Promise.resolve({ id: 'org-1' }) },
    );

    expect(res.status).toBe(200);
    // Reversal snapshot captured for restore.
    expect(deletedRecordLedgerCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recordType: 'ORGANIZATION',
        recordId: 'org-1',
        deactivatedOrgUserIds: ['ou-1', 'ou-2'],
        deactivatedSeatIds: ['seat-1', 'seat-2'],
      }),
    });
    expect(inviteDeleteMany).toHaveBeenCalledWith({ where: { orgId: 'org-1' } });
    expect(seatUpdateMany).toHaveBeenCalledWith({
      where: { orgId: 'org-1' },
      data: { isActive: false },
    });
    expect(orgUserUpdateMany).toHaveBeenCalledWith({
      where: { orgId: 'org-1' },
      data: { isActive: false, seatId: null },
    });
    expect(organizationUpdate).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: expect.objectContaining({
        isDeleted: true,
        deletedAt: expect.any(Date),
        deletedByUserId: 'owner-1',
      }),
    });
    expect(writePlatformAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PLATFORM_ORG_DELETED',
        resourceType: 'Organization',
        resourceId: 'org-1',
        metadata: expect.objectContaining({ softDelete: true, patientCount: 12 }),
        tx,
      }),
    );
  });

  it('refuses organization deletion when the confirmation does not match', async () => {
    organizationFindFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Demo Clinic',
      _count: { orgUsers: 0, patients: 0, seats: 0, invites: 0 },
    });

    const res = await DELETE_ORG(
      deleteReq('http://test.local/api/owner/orgs/org-1', { confirmName: 'Wrong' }),
      { params: Promise.resolve({ id: 'org-1' }) },
    );

    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
    expect(writePlatformAuditLog).not.toHaveBeenCalled();
  });

  it('anonymizes and deactivates a non-owner user', async () => {
    userFindFirst.mockResolvedValueOnce({
      id: 'user-1',
      email: 'clinician@demo.local',
      name: 'Casey Clinician',
      image: null,
      passwordHash: 'original-hash',
      signingPinHash: 'original-pin-hash',
      platformRole: PlatformRole.NONE,
      orgUsers: [{ id: 'ou-1', orgId: 'org-1', isActive: true }],
    });

    const res = await DELETE_USER(
      deleteReq('http://test.local/api/owner/users/user-1', { confirmEmail: 'clinician@demo.local' }),
      { params: Promise.resolve({ id: 'user-1' }) },
    );

    expect(res.status).toBe(200);
    // Original identity is stashed in the owner-only recovery ledger BEFORE
    // the live row is anonymized, so a restore can reconstitute it.
    expect(deletedRecordLedgerCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recordType: 'USER',
        recordId: 'user-1',
        originalEmail: 'clinician@demo.local',
        originalName: 'Casey Clinician',
        originalPasswordHash: 'original-hash',
        originalSigningPinHash: 'original-pin-hash',
        originalPlatformRole: PlatformRole.NONE,
        deactivatedOrgUserIds: ['ou-1'],
      }),
    });
    expect(orgUserUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ou-1'] } },
      data: { isActive: false, seatId: null },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        email: 'deleted-user-1@deleted.local',
        name: null,
        image: null,
        passwordHash: 'hashed-deleted-password',
        platformRole: PlatformRole.NONE,
        isDeleted: true,
        deletedAt: expect.any(Date),
        deletedByUserId: 'owner-1',
      }),
    });
    expect(writePlatformAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PLATFORM_USER_DELETED',
        resourceType: 'User',
        resourceId: 'user-1',
        metadata: expect.objectContaining({ softDelete: true, anonymized: true }),
        tx,
      }),
    );
  });

  it('protects platform-owner accounts from user deletion', async () => {
    userFindFirst.mockResolvedValueOnce({
      id: 'user-2',
      email: 'owner2@demo.local',
      platformRole: PlatformRole.PLATFORM_OWNER,
      orgUsers: [],
    });

    const res = await DELETE_USER(
      deleteReq('http://test.local/api/owner/users/user-2', { confirmEmail: 'owner2@demo.local' }),
      { params: Promise.resolve({ id: 'user-2' }) },
    );

    expect(res.status).toBe(409);
    expect(transaction).not.toHaveBeenCalled();
  });
});
