import { describe, expect, it } from 'vitest';

import { mergeReviewedExtractionBatches } from '@/lib/external-context/batch-merge';
import type { ExtractionJson } from '@/types/external-context-extraction';

describe('mergeReviewedExtractionBatches', () => {
  it('merges clinician-reviewed batch payloads in page order', () => {
    const merged = mergeReviewedExtractionBatches([
      {
        batchIndex: 1,
        pageStart: 6,
        pageEnd: 10,
        ocrText: 'Page 6 OCR',
        extractionJson: null,
        vettedExtractionJson: extraction({
          summary: 'Medication list reviewed.',
          medications: [
            {
              name: 'Metformin',
              dose: '500 mg',
              route: 'PO',
              frequency: 'BID',
              status: 'current',
              sourcePage: 6,
              confidence: 'high',
              verbatim: 'Metformin 500 mg BID',
            },
          ],
        }),
      },
      {
        batchIndex: 0,
        pageStart: 1,
        pageEnd: 5,
        ocrText: 'Page 1 OCR',
        extractionJson: null,
        vettedExtractionJson: extraction({
          summary: 'Referral packet reviewed.',
          diagnoses: [
            {
              text: 'Type 2 diabetes mellitus',
              icdHint: 'E11.9',
              status: 'active',
              sourcePage: 2,
              confidence: 'medium',
              verbatim: 'Type 2 diabetes mellitus',
            },
          ],
        }),
      },
    ]);

    expect(merged.ocrText).toContain('Pages 1-5');
    expect(merged.ocrText.indexOf('Pages 1-5')).toBeLessThan(merged.ocrText.indexOf('Pages 6-10'));
    expect(merged.extraction.summary).toContain('Pages 1-5: Referral packet reviewed.');
    expect(merged.extraction.summary).toContain('Pages 6-10: Medication list reviewed.');
    expect(merged.extraction.diagnoses).toHaveLength(1);
    expect(merged.extraction.medications).toHaveLength(1);
    expect(merged.extraction.extractionNotes).toContain('Merged from 2 clinician-reviewed extraction batches.');
  });
});

function extraction(overrides: Partial<ExtractionJson>) {
  return { ...baseExtraction(), ...overrides };
}

function baseExtraction(): ExtractionJson {
  return {
    documentType: 'referral_letter',
    summary: 'Reviewed batch.',
    diagnoses: [],
    medications: [],
    allergies: [],
    labs: [],
    vitals: [],
    procedures: [],
    documentDateGuess: null,
    extractionNotes: null,
  };
}
