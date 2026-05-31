import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    externalContext: {
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

import {
  loadExternalContextsForBrief,
  MAX_BRIEF_EXTERNAL_CONTEXTS,
} from '@/lib/brief/load-external-contexts';

beforeEach(() => {
  findMany.mockReset();
});

describe('loadExternalContextsForBrief', () => {
  it('queries READY rows for the patient/org, ordered by dateOfRecord desc, capped at MAX', async () => {
    findMany.mockResolvedValueOnce([]);
    await loadExternalContextsForBrief({
      patientId: 'pat_1',
      orgId: 'org_1',
      currentVisitStart: new Date('2026-05-18T08:00:00Z'),
    });
    expect(findMany).toHaveBeenCalledOnce();
    const args = findMany.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.where).toMatchObject({
      patientId: 'pat_1',
      orgId: 'org_1',
      status: 'READY',
      deletedAt: null,
    });
    expect(args.where).toMatchObject({
      OR: [
        { mediaKind: { not: 'DOCUMENT' } },
        { verifiedAt: { not: null } },
      ],
    });
    expect(args.orderBy).toEqual({ dateOfRecord: 'desc' });
    expect(args.take).toBe(MAX_BRIEF_EXTERNAL_CONTEXTS);
    expect((args.where as Record<string, unknown>).dateOfRecord).toEqual({
      lte: new Date('2026-05-18T08:00:00Z'),
    });
  });

  it('renders verified document rows from vettedExtractionJson', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 'ec_doc_1',
        dateOfRecord: new Date('2026-04-12T00:00:00Z'),
        source: 'OUTSIDE_PROVIDER',
        sourceLabel: 'Outside lab',
        mediaKind: 'DOCUMENT',
        transcriptClean: 'raw transcript should not win',
        vettedExtractionJson: {
          documentType: 'lab_report',
          summary: 'Clinician-corrected lab summary.',
          diagnoses: [],
          medications: [],
          allergies: [],
          labs: [],
          vitals: [],
          procedures: [],
          documentDateGuess: null,
          extractionNotes: null,
        },
        addedBy: {
          user: { name: 'Dr. Patel', email: 'patel@demo.local' },
        },
      },
    ]);

    const result = await loadExternalContextsForBrief({
      patientId: 'pat_1',
      orgId: 'org_1',
    });

    expect(result[0]?.transcriptClean).toContain('Clinician-corrected lab summary');
    expect(result[0]?.transcriptClean).not.toBe('raw transcript should not win');
  });

  it('projects rows into the BriefExternalContextProjection shape', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 'ec_1',
        dateOfRecord: new Date('2026-04-12T00:00:00Z'),
        source: 'OUTSIDE_PROVIDER',
        sourceLabel: 'Dr. Smith referral',
        transcriptClean: 'Body text.',
        addedBy: {
          user: { name: 'Dr. Patel', email: 'patel@demo.local' },
        },
      },
      {
        id: 'ec_2',
        dateOfRecord: new Date('2026-03-20T00:00:00Z'),
        source: 'PATIENT_SUPPLIED',
        sourceLabel: null,
        transcriptClean: '',
        addedBy: {
          user: { name: null, email: 'clinician@demo.local' },
        },
      },
    ]);
    const result = await loadExternalContextsForBrief({
      patientId: 'pat_1',
      orgId: 'org_1',
    });
    expect(result).toEqual([
      {
        externalContextId: 'ec_1',
        dateOfRecordIso: '2026-04-12T00:00:00.000Z',
        source: 'OUTSIDE_PROVIDER',
        sourceLabel: 'Dr. Smith referral',
        addedByName: 'Dr. Patel',
        transcriptClean: 'Body text.',
      },
      {
        externalContextId: 'ec_2',
        dateOfRecordIso: '2026-03-20T00:00:00.000Z',
        source: 'PATIENT_SUPPLIED',
        sourceLabel: null,
        addedByName: 'clinician@demo.local',
        transcriptClean: '',
      },
    ]);
  });

  it('defaults currentVisitStart to now() when not provided', async () => {
    findMany.mockResolvedValueOnce([]);
    const before = Date.now();
    await loadExternalContextsForBrief({ patientId: 'pat_1', orgId: 'org_1' });
    const after = Date.now();
    const args = findMany.mock.calls[0]?.[0] as Record<string, unknown>;
    const cutoff = (args.where as { dateOfRecord: { lte: Date } }).dateOfRecord.lte;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after);
  });
});
