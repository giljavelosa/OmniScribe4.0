import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    patientUpload: { findMany: (...a: unknown[]) => findMany(...a) },
  },
}));

import { loadAttestedUploadsForBrief } from '@/lib/brief/load-attested-uploads';
import { buildBriefUserMessage } from '@/lib/notes/build-brief-prompt';

describe('loadAttestedUploadsForBrief', () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it('loads only ATTESTED rows', async () => {
    findMany.mockResolvedValue([
      {
        id: 'up_1',
        kind: 'MED_LIST',
        attestedAt: new Date('2026-05-01'),
        captureContext: 'Paper list',
        attestedJson: { medications: [{ name: 'Metformin' }] },
      },
    ]);
    const rows = await loadAttestedUploadsForBrief({ patientId: 'p1', orgId: 'org_1' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ATTESTED' }),
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.uploadId).toBe('up_1');
    expect(rows[0]?.findingsSummary).toContain('Metformin');
  });
});

describe('buildBriefUserMessage attested scans', () => {
  it('includes attested_scanned_documents block when uploads present', () => {
    const msg = buildBriefUserMessage({
      division: 'MEDICAL',
      todayIso: '2026-05-28',
      patient: {
        id: 'p1',
        displayAge: 54,
        sex: 'MALE',
        displayName: 'James Park',
        preferredLanguage: 'English',
        mrn: '123',
      },
      episode: null,
      priorNotes: [
        {
          noteId: 'n1',
          signedAtIso: '2026-05-01',
          clinicianName: 'Dr. Chen',
          noteType: 'Office Visit',
          templateName: 'Follow-up',
          division: 'MEDICAL',
          finalJson: {
            signedAt: '2026-05-01T00:00:00.000Z',
            schemaVersion: 1,
            sections: [{ id: 'plan', label: 'Plan', content: 'Continue lisinopril.', required: false }],
          },
        },
      ],
      topActiveGoals: [],
      attestedUploads: [
        {
          uploadId: 'up_1',
          kindLabel: 'Medication list',
          attestedAtIso: '2026-05-02T12:00:00.000Z',
          captureContext: 'Patient-supplied list',
          findingsSummary: 'Metformin',
        },
      ],
    });
    expect(msg).toContain('<attested_scanned_documents');
    expect(msg).toContain('up_1');
    expect(msg).toContain('Metformin');
  });
});
