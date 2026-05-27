import { describe, it, expect, beforeEach, vi } from 'vitest';

const patientUploadFindFirst = vi.fn();
const patientUploadUpdate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    patientUpload: {
      findFirst: (...a: unknown[]) => patientUploadFindFirst(...a),
      update: (...a: unknown[]) => patientUploadUpdate(...a),
    },
  },
}));

const requireFeatureAccess = vi.fn();
vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));

const writeAuditLog = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

vi.mock('@/lib/phi-access', () => ({
  assertOrgScoped: vi.fn(),
}));

import { POST as attestPost } from '@/app/api/patients/[id]/uploads/[uploadId]/attest/route';
import { POST as rejectPost } from '@/app/api/patients/[id]/uploads/[uploadId]/reject/route';

function authedGuard() {
  return {
    user: { id: 'user_1' },
    orgUser: { orgId: 'org_1', orgUserId: 'ou_1' },
    authorizationUser: { orgId: 'org_1', orgUserId: 'ou_1' },
  };
}

describe('patient upload attestation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireFeatureAccess.mockResolvedValue(authedGuard());
  });

  it('POST attest promotes EXTRACTED to ATTESTED', async () => {
    patientUploadFindFirst.mockResolvedValue({
      id: 'up_1',
      orgId: 'org_1',
      status: 'EXTRACTED',
      extractedJson: { medications: [{ name: 'Metformin' }] },
      captureContext: null,
    });
    patientUploadUpdate.mockResolvedValue({
      id: 'up_1',
      status: 'ATTESTED',
      kind: 'MED_LIST',
      attestedAt: new Date('2026-05-28'),
    });

    const req = new Request('http://localhost/api/patients/p1/uploads/up_1/attest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ captureContext: 'Paper med list' }),
    });
    const res = await attestPost(req, {
      params: Promise.resolve({ id: 'p1', uploadId: 'up_1' }),
    });
    expect(res.status).toBe(200);
    expect(patientUploadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'up_1' },
        data: expect.objectContaining({ status: 'ATTESTED' }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PATIENT_UPLOAD_ATTESTED' }),
    );
  });

  it('POST attest returns 409 when already ATTESTED', async () => {
    patientUploadFindFirst.mockResolvedValue({
      id: 'up_1',
      orgId: 'org_1',
      status: 'ATTESTED',
      extractedJson: {},
      captureContext: null,
    });

    const req = new Request('http://localhost/api/patients/p1/uploads/up_1/attest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const res = await attestPost(req, {
      params: Promise.resolve({ id: 'p1', uploadId: 'up_1' }),
    });
    expect(res.status).toBe(409);
  });

  it('POST reject promotes EXTRACTED to REJECTED', async () => {
    patientUploadFindFirst.mockResolvedValue({
      id: 'up_1',
      orgId: 'org_1',
      status: 'EXTRACTED',
      kind: 'LAB_REPORT',
      captureContext: null,
    });
    patientUploadUpdate.mockResolvedValue({
      id: 'up_1',
      status: 'REJECTED',
      rejectedAt: new Date(),
    });

    const req = new Request('http://localhost/api/patients/p1/uploads/up_1/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const res = await rejectPost(req, {
      params: Promise.resolve({ id: 'p1', uploadId: 'up_1' }),
    });
    expect(res.status).toBe(200);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PATIENT_UPLOAD_REJECTED' }),
    );
  });
});
