import { describe, it, expect, vi, beforeEach } from 'vitest';

const patientFindUnique = vi.fn();
const patientUploadFindMany = vi.fn();
const assertOrgScopedMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    patient: { findUnique: (...a: unknown[]) => patientFindUnique(...a) },
    patientUpload: { findMany: (...a: unknown[]) => patientUploadFindMany(...a) },
  },
}));
vi.mock('@/lib/phi-access', () => ({
  assertOrgScoped: (...a: unknown[]) => assertOrgScopedMock(...a),
}));

import { runTool } from '@/services/copilot/tools';

const ORG = 'org_1';
const PATIENT = 'pat_1';
const CTX = { orgId: ORG, clinicianOrgUserId: 'ou_1', userId: 'user_1' } as const;

beforeEach(() => {
  patientFindUnique.mockReset();
  patientUploadFindMany.mockReset();
  assertOrgScopedMock.mockReset();
  patientFindUnique.mockResolvedValue({ id: PATIENT, orgId: ORG });
});

describe('runTool lookupPatientUploads — rule 20 defaults', () => {
  it('defaults to ATTESTED only', async () => {
    patientUploadFindMany.mockResolvedValue([]);
    await runTool('lookupPatientUploads', { patientId: PATIENT }, CTX);
    const where = patientUploadFindMany.mock.calls[0]?.[0].where;
    expect(where).toMatchObject({
      orgId: ORG,
      patientId: PATIENT,
      isDeleted: false,
      status: 'ATTESTED',
    });
  });

  it('reviewable filter widens to EXTRACTED + MANUAL_ONLY + ATTESTED', async () => {
    patientUploadFindMany.mockResolvedValue([]);
    await runTool(
      'lookupPatientUploads',
      { patientId: PATIENT, statusFilter: 'reviewable' },
      CTX,
    );
    const where = patientUploadFindMany.mock.calls[0]?.[0].where;
    expect(where.status).toEqual({
      in: ['ATTESTED', 'EXTRACTED', 'MANUAL_ONLY'],
    });
  });

  it('all filter omits status constraint', async () => {
    patientUploadFindMany.mockResolvedValue([]);
    await runTool(
      'lookupPatientUploads',
      { patientId: PATIENT, statusFilter: 'all' },
      CTX,
    );
    const where = patientUploadFindMany.mock.calls[0]?.[0].where;
    expect(where).not.toHaveProperty('status');
  });

  it('returns attestedAt + captureContext on every row', async () => {
    patientUploadFindMany.mockResolvedValue([
      {
        id: 'up_1',
        kind: 'LAB_REPORT',
        mimeType: 'image/jpeg',
        filename: 'lab.jpg',
        byteSize: 12345,
        status: 'ATTESTED',
        createdAt: new Date('2026-05-20T10:00:00.000Z'),
        attestedAt: new Date('2026-05-20T10:05:00.000Z'),
        captureContext: 'Paper lab printout',
      },
    ]);
    const res = await runTool(
      'lookupPatientUploads',
      { patientId: PATIENT },
      CTX,
    );
    expect(res).toMatchObject({ ok: true, rowCount: 1 });
    if (!res.ok) throw new Error('expected ok');
    const data = res.data as {
      statusFilter: string;
      uploads: Array<Record<string, unknown>>;
    };
    expect(data.statusFilter).toBe('attested_only');
    expect(data.uploads[0]).toMatchObject({
      uploadId: 'up_1',
      kind: 'LAB_REPORT',
      status: 'ATTESTED',
      attestedAt: '2026-05-20T10:05:00.000Z',
      captureContext: 'Paper lab printout',
    });
  });

  it('prefers attestedJson over extractedJson when includeExtracted + ATTESTED', async () => {
    patientUploadFindMany.mockResolvedValue([
      {
        id: 'up_2',
        kind: 'LAB_REPORT',
        mimeType: 'image/png',
        filename: null,
        byteSize: 100,
        status: 'ATTESTED',
        createdAt: new Date('2026-05-20'),
        attestedAt: new Date('2026-05-20'),
        captureContext: null,
        ocrText: 'raw ocr',
        extractedJson: { labs: [{ name: 'A1C', value: '7.2 raw' }] },
        attestedJson: { labs: [{ name: 'A1C', value: '7.2 confirmed' }] },
      },
    ]);
    const res = await runTool(
      'lookupPatientUploads',
      { patientId: PATIENT, includeExtracted: true },
      CTX,
    );
    if (!res.ok) throw new Error('expected ok');
    const upload = (res.data as { uploads: Array<Record<string, unknown>> })
      .uploads[0]!;
    expect(upload.extractedJson).toEqual({
      labs: [{ name: 'A1C', value: '7.2 confirmed' }],
    });
    expect(upload.attestedOnly).toBe(true);
  });
});
