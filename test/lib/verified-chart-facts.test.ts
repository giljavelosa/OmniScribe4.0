import { describe, expect, it } from 'vitest';

import {
  buildVerifiedDocumentDomainSummaries,
  buildVerifiedLabFacts,
  buildVerifiedMedicationFacts,
  buildVerifiedProcedureFacts,
  sourceMatchLabel,
} from '@/lib/external-context/verified-chart-facts';

const extraction = {
  documentType: 'medication_list',
  summary: 'Verified med list.',
  diagnoses: [],
  medications: [
    {
      name: 'Tacrolimus',
      dose: '2 mg every morning and 1.5 mg every evening',
      route: 'PO',
      frequency: null,
      status: 'current',
      sourcePage: 3,
      confidence: 'high',
      verbatim: 'Tacrolimus 2 mg PO every morning and 1.5 mg PO every evening',
    },
    {
      name: 'Aspirin',
      dose: '81 mg',
      route: 'PO',
      frequency: 'daily',
      status: 'current',
      sourcePage: 3,
      confidence: 'high',
      verbatim: 'Aspirin 81 mg PO daily',
    },
  ],
  allergies: [],
  labs: [],
  vitals: [],
  procedures: [],
  documentDateGuess: null,
  extractionNotes: null,
} as const;

describe('buildVerifiedMedicationFacts', () => {
  it('projects medications from verified READY documents only', () => {
    const result = buildVerifiedMedicationFacts([
      {
        id: 'verified-doc',
        dateOfRecord: new Date('2026-05-01T00:00:00Z'),
        sourceLabel: 'Outside medication list',
        status: 'READY',
        mediaKind: 'DOCUMENT',
        verifiedAt: new Date('2026-05-02T00:00:00Z'),
        vettedExtractionJson: extraction,
      },
      {
        id: 'unverified-doc',
        dateOfRecord: new Date('2026-05-03T00:00:00Z'),
        sourceLabel: 'Unverified packet',
        status: 'EXTRACTED',
        mediaKind: 'DOCUMENT',
        verifiedAt: null,
        vettedExtractionJson: extraction,
      },
      {
        id: 'ready-paste',
        dateOfRecord: new Date('2026-05-04T00:00:00Z'),
        sourceLabel: 'Paste',
        status: 'READY',
        mediaKind: 'PASTE',
        verifiedAt: null,
        vettedExtractionJson: extraction,
      },
    ]);

    expect(result.map((med) => med.name)).toEqual(['Aspirin', 'Tacrolimus']);
    expect(result.every((med) => med.externalContextId === 'verified-doc')).toBe(true);
  });

  it('deduplicates equivalent medications and keeps the newest verified source', () => {
    const older = {
      ...extraction,
      medications: [extraction.medications[0]],
    };
    const newer = {
      ...extraction,
      medications: [
        {
          ...extraction.medications[0],
          confidence: 'medium',
        },
      ],
    };

    const result = buildVerifiedMedicationFacts([
      {
        id: 'older-doc',
        dateOfRecord: new Date('2026-04-01T00:00:00Z'),
        sourceLabel: 'Older packet',
        status: 'READY',
        mediaKind: 'DOCUMENT',
        verifiedAt: new Date('2026-04-02T00:00:00Z'),
        vettedExtractionJson: older,
      },
      {
        id: 'newer-doc',
        dateOfRecord: new Date('2026-05-01T00:00:00Z'),
        sourceLabel: 'Newer packet',
        status: 'READY',
        mediaKind: 'DOCUMENT',
        verifiedAt: new Date('2026-05-02T00:00:00Z'),
        vettedExtractionJson: newer,
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.externalContextId).toBe('newer-doc');
    expect(result[0]?.confidence).toBe('medium');
  });
});

describe('verified uploaded record fact projections', () => {
  const richExtraction = {
    ...extraction,
    medications: extraction.medications.slice(0, 1),
    allergies: [
      {
        substance: 'Penicillin',
        reaction: 'Anaphylaxis',
        severity: 'severe',
        sourcePage: 1,
        confidence: 'high',
        verbatim: 'Penicillin - anaphylaxis',
      },
    ],
    labs: [
      {
        name: 'Creatinine',
        value: '1.42',
        unit: 'mg/dL',
        referenceRange: '0.70-1.30',
        abnormalFlag: 'high',
        collectedDate: '2026-05-21',
        sourcePage: 24,
        confidence: 'high',
        verbatim: 'Creatinine 1.42 H',
      },
    ],
    vitals: [
      {
        type: 'BP',
        value: '142/86',
        unit: 'mmHg',
        measuredDate: '2026-05-21',
        sourcePage: 7,
        confidence: 'medium',
        verbatim: 'BP 142/86',
      },
    ],
    procedures: [
      {
        text: 'Orthotopic heart transplant',
        date: '2026-02-07',
        sourcePage: 12,
        confidence: 'high',
        verbatim: 'Orthotopic heart transplantation',
      },
    ],
  } as const;

  const verifiedRow = {
    id: 'verified-doc-rich',
    dateOfRecord: new Date('2026-05-21T00:00:00Z'),
    sourceLabel: 'Synthetic outside packet',
    status: 'READY',
    mediaKind: 'DOCUMENT',
    verifiedAt: new Date('2026-05-22T00:00:00Z'),
    pageCount: 40,
    _count: { documentPages: 40 },
    vettedExtractionJson: richExtraction,
  } as const;

  it('projects labs, procedures, and domain summaries only from verified documents', () => {
    const rows: Parameters<typeof buildVerifiedLabFacts>[0] = [
      verifiedRow,
      {
        ...verifiedRow,
        id: 'pending-doc',
        status: 'EXTRACTED' as const,
        verifiedAt: null,
      },
    ];

    expect(buildVerifiedLabFacts(rows)).toMatchObject([
      {
        externalContextId: 'verified-doc-rich',
        name: 'Creatinine',
        value: '1.42',
        abnormalFlag: 'high',
        sourcePage: 24,
      },
    ]);
    expect(buildVerifiedProcedureFacts(rows)).toMatchObject([
      {
        externalContextId: 'verified-doc-rich',
        text: 'Orthotopic heart transplant',
        sourcePage: 12,
      },
    ]);
    expect(buildVerifiedDocumentDomainSummaries(rows)).toMatchObject([
      {
        externalContextId: 'verified-doc-rich',
        pageCount: 40,
        indexedPageCount: 40,
        hasPageText: true,
        domains: expect.arrayContaining([
          { key: 'medications', label: 'Medications', count: 1 },
          { key: 'allergies', label: 'Allergies', count: 1 },
          { key: 'labs', label: 'Labs', count: 1 },
          { key: 'procedures', label: 'Procedures / imaging', count: 1 },
        ]),
      },
    ]);
  });

  it('uses clinician-readable source match labels instead of raw confidence terms', () => {
    expect(sourceMatchLabel('high')).toBe('Clear source match');
    expect(sourceMatchLabel('medium')).toBe('Needs clinician check');
    expect(sourceMatchLabel('low')).toBe('Weak or unclear source');
  });
});
