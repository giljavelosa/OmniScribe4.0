import { describe, expect, it } from 'vitest';

import { buildIndex, matchTranscript, tokenize } from '@/lib/copilot/topic-match';
import type { ExternalEhrContext } from '@/lib/fhir/project-ehr-context';

function ctx(): ExternalEhrContext {
  return {
    ehrSystem: 'nextgen',
    activeConditions: [
      {
        display: 'Type 2 diabetes mellitus',
        code: 'E11.9',
        onsetDate: '2019-03-15',
        provenance: { source: 'fhir', ehrSystem: 'nextgen', fhirResourceType: 'Condition', fhirResourceId: 'cond-diabetes', fetchedAt: '2026-05-17T00:00:00Z' },
      },
      {
        display: 'Essential hypertension',
        code: 'I10',
        onsetDate: '2017-11-02',
        provenance: { source: 'fhir', ehrSystem: 'nextgen', fhirResourceType: 'Condition', fhirResourceId: 'cond-htn', fetchedAt: '2026-05-17T00:00:00Z' },
      },
    ],
    currentMedications: [
      {
        display: 'metformin 500 mg oral tablet',
        status: 'active',
        sourceType: 'MedicationStatement',
        provenance: { source: 'fhir', ehrSystem: 'nextgen', fhirResourceType: 'MedicationStatement', fhirResourceId: 'med-metformin', fetchedAt: '2026-05-17T00:00:00Z' },
      },
      {
        display: 'lisinopril 10 mg',
        status: 'active',
        sourceType: 'MedicationStatement',
        provenance: { source: 'fhir', ehrSystem: 'nextgen', fhirResourceType: 'MedicationStatement', fhirResourceId: 'med-lisinopril', fetchedAt: '2026-05-17T00:00:00Z' },
      },
    ],
    allergies: [
      {
        display: 'Penicillin',
        category: 'medication',
        criticality: 'high',
        provenance: { source: 'fhir', ehrSystem: 'nextgen', fhirResourceType: 'AllergyIntolerance', fhirResourceId: 'allergy-pcn', fetchedAt: '2026-05-17T00:00:00Z' },
      },
    ],
    recentObservations: [
      {
        display: 'Hemoglobin A1c',
        code: '4548-4',
        value: '7.2',
        unit: '%',
        effectiveDate: '2025-09-04',
        provenance: { source: 'fhir', ehrSystem: 'nextgen', fhirResourceType: 'Observation', fhirResourceId: 'obs-a1c', fetchedAt: '2026-05-17T00:00:00Z' },
      },
    ],
    recentProcedures: [],
    recentDiagnosticReports: [],
  };
}

describe('tokenize', () => {
  it('drops short pure-alpha tokens (< 4 chars)', () => {
    expect(tokenize('a be I am pen')).toEqual([]);
  });

  it('keeps short digit-containing tokens (≥ 3 chars)', () => {
    expect(tokenize('a1c b12 sa02')).toEqual(['a1c', 'b12', 'sa02']);
  });

  it('drops common stopwords (with, from, tablet, etc.)', () => {
    expect(tokenize('metformin 500 mg oral tablet')).toEqual(['metformin']);
  });

  it('lowercases + dedups', () => {
    expect(tokenize('Diabetes diabetes DIABETES')).toEqual(['diabetes']);
  });

  it('drops pure-numeric tokens', () => {
    expect(tokenize('500 1000 2019')).toEqual([]);
  });

  it('handles multi-word displays', () => {
    expect(tokenize('Type 2 diabetes mellitus').sort()).toEqual(['diabetes', 'mellitus', 'type']);
  });
});

describe('buildIndex', () => {
  it('returns empty arrays for null context', () => {
    const idx = buildIndex(null);
    expect(idx.activeConditions).toEqual([]);
    expect(idx.currentMedications).toEqual([]);
  });

  it('builds tokens per row in each category', () => {
    const idx = buildIndex(ctx());
    expect(idx.activeConditions[0]!.fhirResourceId).toBe('cond-diabetes');
    expect(idx.activeConditions[0]!.tokens).toContain('diabetes');
    expect(idx.currentMedications[0]!.tokens).toContain('metformin');
    expect(idx.allergies[0]!.tokens).toContain('penicillin');
  });
});

describe('matchTranscript', () => {
  const index = buildIndex(ctx());

  it('matches a medication by token', () => {
    const result = matchTranscript("let's talk about your metformin", index);
    expect(result.currentMedications.has('med-metformin')).toBe(true);
    expect(result.currentMedications.has('med-lisinopril')).toBe(false);
  });

  it('matches a condition by token', () => {
    const result = matchTranscript('how is the diabetes management going', index);
    expect(result.activeConditions.has('cond-diabetes')).toBe(true);
  });

  it('matches an allergy by token', () => {
    const result = matchTranscript('any reaction to penicillin in the past?', index);
    expect(result.allergies.has('allergy-pcn')).toBe(true);
  });

  it('matches an observation by token', () => {
    const result = matchTranscript('what was your last a1c value? 7 point 2', index);
    expect(result.recentObservations.has('obs-a1c')).toBe(true);
  });

  it('catches suffix variants via the word-boundary pattern', () => {
    // The pattern allows suffix expansion but requires the literal
    // token as the root. Stemming (diabetes → diabetic) is a future
    // polish; here we lock the exact-root + suffix behavior.
    const result = matchTranscript('hemoglobinopathy screening', index);
    expect(result.recentObservations.has('obs-a1c')).toBe(true);
  });

  it('does NOT match across word boundaries (substring trap)', () => {
    // 'art' inside 'heart' must NOT match a fake row containing 'art'.
    const customCtx: ExternalEhrContext = {
      ...ctx(),
      activeConditions: [
        {
          display: 'Arts therapy',
          code: null,
          onsetDate: null,
          provenance: { source: 'fhir', ehrSystem: 'nextgen', fhirResourceType: 'Condition', fhirResourceId: 'art-row', fetchedAt: '' },
        },
      ],
    };
    const idx = buildIndex(customCtx);
    const result = matchTranscript('listening to her heart sounds', idx);
    expect(result.activeConditions.has('art-row')).toBe(false);
  });

  it('returns empty sets for an empty transcript', () => {
    const result = matchTranscript('', index);
    expect(result.activeConditions.size).toBe(0);
    expect(result.currentMedications.size).toBe(0);
    expect(result.allergies.size).toBe(0);
    expect(result.recentObservations.size).toBe(0);
  });

  it('returns empty sets when transcript has no matching tokens', () => {
    const result = matchTranscript('we will see you next month', index);
    expect(result.activeConditions.size).toBe(0);
    expect(result.currentMedications.size).toBe(0);
  });
});
