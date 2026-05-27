import { describe, expect, it } from 'vitest';

import { buildFindings } from '@/lib/patient-uploads/findings-format';

/**
 * Pure formatter for the scan-review sheet's "What we read" panel.
 *
 * Background
 * ----------
 * Reported 2026-05-25: a clinician opened an `OUTSIDE_RECORDS` scan
 * that had been correctly extracted by the vision LLM, but the sheet
 * showed raw JSON in a `<pre>` block (curly braces, key names, etc.).
 * The original `formatFindings` only had branches for MED_LIST,
 * LAB_REPORT, and IMAGING_REPORT — all five other kinds (including
 * OUTSIDE_RECORDS, INSURANCE_CARD, ID_CARD, OTHER, and the default
 * fallback) hit a `JSON.stringify` fallback.
 *
 * The new helper returns a structured `{ sections, isEmpty }` shape
 * that the sheet renders as a labeled `<dl>` instead of a code block.
 * Every kind has a hand-curated branch + the generic fallback for
 * future shapes still produces sensible output (no JSON syntax leaks
 * into the UI).
 */

describe('buildFindings — OUTSIDE_RECORDS (the reported regression)', () => {
  it('renders a real LLM extraction as labeled sections, not raw JSON', () => {
    const result = buildFindings('OUTSIDE_RECORDS', {
      dateIso: '2025-04-30',
      summary:
        'MRI brain without contrast performed on a 69-year-old male with stroke protocol evaluation…',
      diagnoses: [],
      medications: [],
    });
    expect(result.isEmpty).toBe(false);
    expect(result.sections).toEqual([
      { label: 'Document date', value: 'April 30, 2025' },
      {
        label: 'Summary',
        value:
          'MRI brain without contrast performed on a 69-year-old male with stroke protocol evaluation…',
      },
    ]);
  });

  it('lists diagnoses + medications as bullet arrays when present', () => {
    const result = buildFindings('OUTSIDE_RECORDS', {
      dateIso: '2025-04-30',
      summary: 'Hospital discharge.',
      diagnoses: ['Acute ischemic stroke', 'Atrial fibrillation'],
      medications: ['Aspirin 81 mg', 'Apixaban 5 mg BID'],
    });
    expect(result.sections.map((s) => s.label)).toEqual([
      'Document date',
      'Summary',
      'Diagnoses mentioned',
      'Medications mentioned',
    ]);
    const dx = result.sections.find((s) => s.label === 'Diagnoses mentioned');
    expect(Array.isArray(dx?.value)).toBe(true);
    expect(dx?.value).toEqual(['Acute ischemic stroke', 'Atrial fibrillation']);
  });

  it('returns isEmpty=true when the JSON is null', () => {
    expect(buildFindings('OUTSIDE_RECORDS', null).isEmpty).toBe(true);
  });

  it('drops empty/whitespace strings from the section list', () => {
    const result = buildFindings('OUTSIDE_RECORDS', {
      dateIso: '',
      summary: '   ',
      diagnoses: ['', '   '],
      medications: [],
    });
    expect(result.isEmpty).toBe(true);
  });
});

describe('buildFindings — MED_LIST', () => {
  it('joins name/dose/frequency/route with bullet separators', () => {
    const result = buildFindings('MED_LIST', {
      medications: [
        { name: 'Lisinopril', dose: '10 mg', frequency: 'daily', route: 'PO' },
        { name: 'Metformin', dose: '500 mg', frequency: 'BID' },
      ],
    });
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toEqual({
      label: 'Medications',
      value: [
        'Lisinopril · 10 mg · daily · PO',
        'Metformin · 500 mg · BID',
      ],
    });
  });

  it('returns isEmpty=true on an empty medications array', () => {
    expect(buildFindings('MED_LIST', { medications: [] }).isEmpty).toBe(true);
  });
});

describe('buildFindings — LAB_REPORT', () => {
  it('formats values with units, flags, and reference ranges', () => {
    const result = buildFindings('LAB_REPORT', {
      collectionDateIso: '2026-04-15',
      labs: [
        {
          name: 'Hemoglobin',
          value: '13.2',
          unit: 'g/dL',
          refLow: '13.5',
          refHigh: '17.5',
          flag: 'L',
        },
        { name: 'Glucose', value: '95', unit: 'mg/dL' },
      ],
    });
    expect(result.sections.map((s) => s.label)).toEqual([
      'Collection date',
      'Labs',
    ]);
    const labs = result.sections.find((s) => s.label === 'Labs')!.value as string[];
    expect(labs[0]).toBe('Hemoglobin: 13.2 g/dL [L] (ref 13.5–17.5 g/dL)');
    expect(labs[1]).toBe('Glucose: 95 mg/dL');
  });
});

describe('buildFindings — IMAGING_REPORT', () => {
  it('renders study/date/findings/impression as separate sections', () => {
    const result = buildFindings('IMAGING_REPORT', {
      studyType: 'MRI brain without contrast',
      dateIso: '2025-04-30',
      findings: 'Small focal area of restricted diffusion…',
      impression: 'Acute to early subacute ischemia.',
    });
    expect(result.sections.map((s) => s.label)).toEqual([
      'Study',
      'Study date',
      'Findings',
      'Impression',
    ]);
  });

  it('skips missing fields rather than rendering empty labels', () => {
    const result = buildFindings('IMAGING_REPORT', {
      studyType: 'CT chest',
      // dateIso, findings, impression all missing
    });
    expect(result.sections).toEqual([{ label: 'Study', value: 'CT chest' }]);
  });
});

describe('buildFindings — INSURANCE_CARD', () => {
  it('orders Carrier → Plan → Member ID → Group ID', () => {
    const result = buildFindings('INSURANCE_CARD', {
      carrier: 'Acme Health',
      planName: 'Bronze HMO',
      memberId: 'A123456',
      groupId: 'G7890',
    });
    expect(result.sections.map((s) => s.label)).toEqual([
      'Carrier',
      'Plan',
      'Member ID',
      'Group ID',
    ]);
  });
});

describe('buildFindings — ID_CARD', () => {
  it('combines first + last name into a single Name section', () => {
    const result = buildFindings('ID_CARD', {
      firstName: 'Jane',
      lastName: 'Doe',
      dob: '1980-06-15',
      idNumber: 'D1234567',
    });
    expect(result.sections).toEqual([
      { label: 'Name', value: 'Jane Doe' },
      { label: 'Date of birth', value: 'June 15, 1980' },
      { label: 'ID number', value: 'D1234567' },
    ]);
  });
});

describe('buildFindings — OTHER + default fallback', () => {
  it('renders an arbitrary object as humanized labels (no JSON syntax)', () => {
    const result = buildFindings('OTHER', {
      summary: 'Patient brought a discharge sheet.',
      patientReportedAllergies: ['Penicillin', 'Latex'],
    });
    expect(result.sections).toEqual([
      { label: 'Summary', value: 'Patient brought a discharge sheet.' },
      {
        label: 'Patient reported allergies',
        value: ['Penicillin', 'Latex'],
      },
    ]);
  });

  it('formats date-shaped string fields under generic keys', () => {
    const result = buildFindings('OTHER', {
      visitDate: '2025-12-31',
      summary: 'Note',
    });
    const visit = result.sections.find((s) => s.label === 'Visit date');
    expect(visit?.value).toBe('December 31, 2025');
  });

  it('squeezes a nested object into a one-liner JSON instead of a multi-line dump', () => {
    // Defense against future shapes — never let raw JSON multi-line
    // syntax leak into the UI.
    const result = buildFindings('OTHER', {
      vitals: { hr: 72, bp: '120/80' },
    });
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.label).toBe('Vitals');
    expect(typeof result.sections[0]!.value).toBe('string');
    // Compact form, single line — original bug rendered this as
    // formatted multi-line JSON.
    expect((result.sections[0]!.value as string).includes('\n')).toBe(false);
  });

  it('returns isEmpty=true when the object is empty', () => {
    expect(buildFindings('OTHER', {}).isEmpty).toBe(true);
  });
});

describe('buildFindings — type-safety / robustness', () => {
  it('returns isEmpty=true when JSON is a string (worker stub edge case)', () => {
    expect(buildFindings('OUTSIDE_RECORDS', 'not an object').isEmpty).toBe(true);
  });

  it('returns isEmpty=true when JSON is undefined', () => {
    expect(buildFindings('MED_LIST', undefined).isEmpty).toBe(true);
  });

  it('handles an unknown date string by falling back to the raw value', () => {
    // Generic branch + non-ISO date → just print the raw string so
    // the user sees something rather than nothing.
    const result = buildFindings('OTHER', {
      reportDate: 'spring 2024',
    });
    expect(result.sections[0]!.value).toBe('spring 2024');
  });
});
