import { describe, expect, it } from 'vitest';

import {
  adaptResource,
  extractSensitivityLevel,
  FHIR_RESOURCE_TYPES,
} from '@/services/fhir/adapters';

/**
 * Per-resource adapter shape lock — Unit 21.
 *
 * Tests the simplified shapes the brief reader (F4) will consume.
 * Each adapter must handle the canonical FHIR shape AND degrade
 * gracefully when fields are missing.
 */

describe('adaptResource — Patient', () => {
  it('maps the canonical Patient shape', () => {
    const out = adaptResource({
      resourceType: 'Patient',
      id: 'p1',
      name: [{ family: 'Doe', given: ['Jane', 'Marie'] }],
      gender: 'female',
      birthDate: '1985-04-12',
      identifier: [{ type: { coding: [{ code: 'MR' }] }, value: 'MRN-12345' }],
    });
    expect(out).toEqual({
      given: ['Jane', 'Marie'],
      family: 'Doe',
      birthDate: '1985-04-12',
      gender: 'female',
      mrn: 'MRN-12345',
    });
  });

  it('degrades gracefully when name + identifier missing', () => {
    const out = adaptResource({ resourceType: 'Patient', id: 'p2' });
    expect(out).toEqual({ given: [], family: '', birthDate: null, gender: null, mrn: null });
  });
});

describe('adaptResource — Condition', () => {
  it('extracts code + display + status + onset', () => {
    const out = adaptResource({
      resourceType: 'Condition',
      id: 'c1',
      code: { coding: [{ code: 'E11.9', display: 'Type 2 diabetes' }] },
      clinicalStatus: { coding: [{ code: 'active' }] },
      onsetDateTime: '2019-03-15T00:00:00Z',
      recordedDate: '2019-03-20T00:00:00Z',
    });
    expect(out).toEqual({
      code: 'E11.9',
      display: 'Type 2 diabetes',
      clinicalStatus: 'active',
      onsetDate: '2019-03-15',
      recordedDate: '2019-03-20',
    });
  });
});

describe('adaptResource — MedicationStatement', () => {
  it('reads medication.text first, falls back to coding.display', () => {
    const a = adaptResource({
      resourceType: 'MedicationStatement',
      id: 'm1',
      status: 'active',
      medicationCodeableConcept: { text: 'metformin 500 mg' },
      effectiveDateTime: '2024-01-15',
    });
    expect(a).toEqual({ display: 'metformin 500 mg', status: 'active', effectiveDate: '2024-01-15' });

    const b = adaptResource({
      resourceType: 'MedicationStatement',
      id: 'm2',
      status: 'active',
      medicationCodeableConcept: { coding: [{ display: 'lisinopril 10 mg' }] },
    });
    expect((b as { display: string }).display).toBe('lisinopril 10 mg');
  });
});

describe('adaptResource — Observation', () => {
  it('reads valueQuantity for numeric labs', () => {
    const out = adaptResource({
      resourceType: 'Observation',
      id: 'o1',
      status: 'final',
      code: { coding: [{ code: '4548-4', display: 'Hemoglobin A1c' }] },
      valueQuantity: { value: 7.2, unit: '%' },
      effectiveDateTime: '2025-09-04',
    });
    expect(out).toEqual({
      code: '4548-4',
      display: 'Hemoglobin A1c',
      value: '7.2',
      unit: '%',
      effectiveDate: '2025-09-04',
      status: 'final',
    });
  });

  it('falls back to valueString for non-quantitative observations', () => {
    const out = adaptResource({
      resourceType: 'Observation',
      id: 'o2',
      status: 'final',
      code: { coding: [{ code: '85354-9' }] },
      valueString: '132/84 mmHg',
    });
    expect((out as { value: string }).value).toBe('132/84 mmHg');
  });
});

describe('adaptResource — AllergyIntolerance', () => {
  it('takes the first category', () => {
    const out = adaptResource({
      resourceType: 'AllergyIntolerance',
      id: 'a1',
      code: { coding: [{ display: 'Penicillin' }] },
      category: ['medication', 'environment'],
      criticality: 'high',
      recordedDate: '2010-06-21',
    });
    expect(out).toEqual({
      display: 'Penicillin',
      category: 'medication',
      criticality: 'high',
      recordedDate: '2010-06-21',
    });
  });
});

describe('adaptResource — Procedure', () => {
  it('reads performedDateTime first, falls back to performedPeriod.start', () => {
    const a = adaptResource({
      resourceType: 'Procedure',
      id: 'pr1',
      status: 'completed',
      code: { coding: [{ display: 'Appendectomy' }] },
      performedDateTime: '2005-08-30',
    });
    expect((a as { performedDate: string }).performedDate).toBe('2005-08-30');

    const b = adaptResource({
      resourceType: 'Procedure',
      id: 'pr2',
      status: 'completed',
      code: { coding: [{ display: 'Knee arthroscopy' }] },
      performedPeriod: { start: '2018-04-10T08:00:00Z', end: '2018-04-10T10:00:00Z' },
    });
    expect((b as { performedDate: string }).performedDate).toBe('2018-04-10');
  });
});

describe('adaptResource — DiagnosticReport', () => {
  it('carries the conclusion string', () => {
    const out = adaptResource({
      resourceType: 'DiagnosticReport',
      id: 'd1',
      status: 'final',
      code: { coding: [{ display: 'Lipid panel' }] },
      effectiveDateTime: '2025-09-04',
      conclusion: 'LDL elevated.',
    });
    expect(out).toEqual({
      display: 'Lipid panel',
      status: 'final',
      effectiveDate: '2025-09-04',
      conclusion: 'LDL elevated.',
    });
  });
});

describe('adaptResource — unknown type', () => {
  it('returns null so the orchestrator can skip cleanly', () => {
    expect(adaptResource({ resourceType: 'Specimen', id: 's1' })).toBeNull();
  });
});

describe('FHIR_RESOURCE_TYPES', () => {
  it('locks the v1 set at 8 types', () => {
    expect(FHIR_RESOURCE_TYPES).toEqual([
      'Patient',
      'Condition',
      'MedicationStatement',
      'MedicationRequest',
      'Observation',
      'AllergyIntolerance',
      'Procedure',
      'DiagnosticReport',
    ]);
  });
});

describe('extractSensitivityLevel', () => {
  it('returns null when no meta.security present', () => {
    expect(extractSensitivityLevel({ resourceType: 'Condition', id: 'c1' })).toBeNull();
  });

  it('returns "restricted" when a known sensitivity code is present', () => {
    const out = extractSensitivityLevel({
      resourceType: 'Condition',
      id: 'c2',
      meta: { security: [{ code: 'SUD' }] },
    });
    expect(out).toBe('restricted');
  });

  it('ignores unrelated security codes', () => {
    const out = extractSensitivityLevel({
      resourceType: 'Condition',
      id: 'c3',
      meta: { security: [{ code: 'XX' }] },
    });
    expect(out).toBeNull();
  });
});
