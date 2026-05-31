import { describe, expect, it } from 'vitest';

import {
  ExtractionEnvelopeSchema,
  MAX_EXTRACTION_ITEMS_PER_GROUP,
} from '@/types/external-context-extraction';

const provenance = {
  sourcePage: 1,
  confidence: 'high',
  verbatim: 'Creatinine 1.0 mg/dL.',
} as const;

const validEnvelope = {
  ocrText: 'Outside lab report. Creatinine 1.0 mg/dL.',
  extraction: {
    documentType: 'lab_report',
    summary: 'Outside lab report with a normal creatinine.',
    diagnoses: [
      {
        text: 'Hypertension',
        icdHint: 'I10',
        status: 'active',
        sourcePage: 1,
        confidence: 'medium',
        verbatim: 'History: HTN.',
      },
    ],
    medications: [
      {
        name: 'Lisinopril',
        dose: '20 mg',
        route: 'PO',
        frequency: 'daily',
        status: 'current',
        sourcePage: 1,
        confidence: 'high',
        verbatim: 'Lisinopril 20 mg PO daily.',
      },
    ],
    allergies: [
      {
        substance: 'No known drug allergies',
        reaction: null,
        severity: 'unknown',
        sourcePage: 1,
        confidence: 'medium',
        verbatim: 'NKDA.',
      },
    ],
    labs: [
      {
        name: 'Creatinine',
        value: '1.0',
        unit: 'mg/dL',
        referenceRange: '0.7-1.3',
        abnormalFlag: 'normal',
        collectedDate: '2026-04-12',
        ...provenance,
      },
    ],
    vitals: [
      {
        type: 'Blood pressure',
        value: '138/86',
        unit: 'mmHg',
        measuredDate: '2026-04-12',
        sourcePage: 1,
        confidence: 'low',
        verbatim: 'BP handwritten as 138/86.',
      },
    ],
    procedures: [
      {
        text: 'Standing AP knee x-ray',
        date: null,
        sourcePage: 1,
        confidence: 'medium',
        verbatim: 'Standing AP view reviewed.',
      },
    ],
    documentDateGuess: '2026-04-12',
    extractionNotes: null,
  },
};

describe('ExtractionEnvelopeSchema', () => {
  it('accepts a valid OCR + structured extraction envelope', () => {
    const parsed = ExtractionEnvelopeSchema.safeParse(validEnvelope);
    expect(parsed.success).toBe(true);
  });

  it('rejects clinical arrays over the v1 cap', () => {
    const overCap = {
      ...validEnvelope,
      extraction: {
        ...validEnvelope.extraction,
        labs: Array.from({ length: MAX_EXTRACTION_ITEMS_PER_GROUP + 1 }, (_, index) => ({
          name: `Lab ${index}`,
          value: '1.0',
          unit: null,
          referenceRange: null,
          abnormalFlag: 'unknown',
          collectedDate: null,
          ...provenance,
        })),
      },
    };
    const parsed = ExtractionEnvelopeSchema.safeParse(overCap);
    expect(parsed.success).toBe(false);
  });

  it('rejects bad enums from the model output', () => {
    const badDocumentType = {
      ...validEnvelope,
      extraction: {
        ...validEnvelope.extraction,
        documentType: 'clinical_guesswork',
      },
    };
    expect(ExtractionEnvelopeSchema.safeParse(badDocumentType).success).toBe(false);

    const badConfidence = {
      ...validEnvelope,
      extraction: {
        ...validEnvelope.extraction,
        labs: [{ ...validEnvelope.extraction.labs[0]!, confidence: 'certain' }],
      },
    };
    expect(ExtractionEnvelopeSchema.safeParse(badConfidence).success).toBe(false);
  });
});

