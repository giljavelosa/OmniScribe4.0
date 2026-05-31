import { describe, expect, it, beforeEach, vi } from 'vitest';

const requireFeatureAccess = vi.fn();
vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...args: unknown[]) => requireFeatureAccess(...args),
}));

const patientFindFirst = vi.fn();
const patientUpdate = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    patient: {
      findFirst: (...args: unknown[]) => patientFindFirst(...args),
      update: (...args: unknown[]) => patientUpdate(...args),
    },
  },
}));

const writeAuditLog = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLog(...args),
}));

const assertOrgScoped = vi.fn();
vi.mock('@/lib/phi-access', () => ({
  assertOrgScoped: (...args: unknown[]) => assertOrgScoped(...args),
}));

vi.mock('@/lib/snapshots/build-snapshot-strip', () => ({
  buildSnapshotStrip: vi.fn(),
}));

vi.mock('@/lib/notes/note-text', () => ({
  deriveAssessmentSnippet: vi.fn(),
}));

import { DELETE } from '@/app/api/patients/[id]/route';

function guard(role: 'ORG_ADMIN' | 'CLINICIAN') {
  return {
    user: { id: 'user-1' },
    orgUser: { id: 'ou-1' },
    authorizationUser: {
      userId: 'user-1',
      orgUserId: 'ou-1',
      orgId: 'org-1',
      role,
      division: 'MEDICAL',
      platformRole: 'NONE',
      canManagePatients: role === 'CLINICIAN',
    },
  };
}

function req() {
  return new Request('http://test.local/api/patients/patient-1', { method: 'DELETE' });
}

describe('DELETE /api/patients/[id]', () => {
  beforeEach(() => {
    requireFeatureAccess.mockReset();
    patientFindFirst.mockReset();
    patientUpdate.mockReset();
    writeAuditLog.mockReset();
    assertOrgScoped.mockReset();
  });

  it('allows organization admins to soft-delete patient records', async () => {
    requireFeatureAccess.mockResolvedValueOnce(guard('ORG_ADMIN'));
    patientFindFirst.mockResolvedValueOnce({ id: 'patient-1', orgId: 'org-1' });
    patientUpdate.mockResolvedValueOnce({ id: 'patient-1' });

    const res = await DELETE(req(), { params: Promise.resolve({ id: 'patient-1' }) });

    expect(res.status).toBe(200);
    expect(patientUpdate).toHaveBeenCalledWith({
      where: { id: 'patient-1' },
      data: { isDeleted: true, deletedAt: expect.any(Date) },
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PATIENT_DELETED',
        resourceType: 'Patient',
        resourceId: 'patient-1',
        metadata: { softDelete: true },
      }),
    );
  });

  it('does not allow non-org-admin patient managers to delete patient records', async () => {
    requireFeatureAccess.mockResolvedValueOnce(guard('CLINICIAN'));

    const res = await DELETE(req(), { params: Promise.resolve({ id: 'patient-1' }) });
    const body = await res.json() as { error?: { code?: string } };

    expect(res.status).toBe(403);
    expect(body.error?.code).toBe('forbidden');
    expect(patientFindFirst).not.toHaveBeenCalled();
    expect(patientUpdate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
