import { describe, expect, it } from 'vitest';

import { hydrateEhrEnrichment } from '@/lib/notes/hydrate-ehr-enrichment';
import type { ExternalEhrContext } from '@/lib/fhir/project-ehr-context';
import type { BriefEhrEnrichment } from '@/types/brief';

const NOW = '2026-05-17T12:00:00Z';
const FRESH = '2026-05-16T12:00:00Z';

function ctx(): ExternalEhrContext {
  return {
    ehrSystem: 'nextgen',
    activeConditions: [
      {
        display: 'Type 2 diabetes',
        code: 'E11.9',
        onsetDate: '2019-03-15',
        provenance: { source: 'fhir', ehrSystem: 'nextgen', fhirResourceType: 'Condition', fhirResourceId: 'cond-1', fetchedAt: FRESH },
      },
    ],
    currentMedications: [
      {
        display: 'metformin 500 mg',
        status: 'active',
        sourceType: 'MedicationStatement',
        provenance: { source: 'fhir', ehrSystem: 'nextgen', fhirResourceType: 'MedicationStatement', fhirResourceId: 'med-1', fetchedAt: FRESH },
      },
    ],
    allergies: [
      {
        display: 'Penicillin',
        category: 'medication',
        criticality: 'high',
        provenance: { source: 'fhir', ehrSystem: 'nextgen', fhirResourceType: 'AllergyIntolerance', fhirResourceId: 'allergy-1', fetchedAt: FRESH },
      },
    ],
    recentObservations: [
      {
        display: 'A1c',
        code: '4548-4',
        value: '7.2',
        unit: '%',
        effectiveDate: '2025-09-04',
        provenance: { source: 'fhir', ehrSystem: 'nextgen', fhirResourceType: 'Observation', fhirResourceId: 'obs-1', fetchedAt: FRESH },
      },
    ],
    recentProcedures: [],
    recentDiagnosticReports: [],
  };
}

const VALID_LLM_OUTPUT: BriefEhrEnrichment = {
  activeConditions: [{ display: 'Type 2 diabetes', code: 'E11.9', onsetDate: '2019-03-15', fhirResourceId: 'cond-1' }],
  currentMedications: [{ display: 'metformin 500 mg', status: 'active', fhirResourceId: 'med-1' }],
  allergies: [{ display: 'Penicillin', criticality: 'high', fhirResourceId: 'allergy-1' }],
  recentObservations: [{ display: 'A1c', value: '7.2', unit: '%', effectiveDate: '2025-09-04', fhirResourceId: 'obs-1' }],
};

void NOW;

describe('hydrateEhrEnrichment', () => {
  it('attaches fetchedAt to every recognized entry', () => {
    const out = hydrateEhrEnrichment(VALID_LLM_OUTPUT, ctx());
    expect(out?.ehrSystem).toBe('nextgen');
    expect(out?.activeConditions?.[0]).toEqual({
      display: 'Type 2 diabetes',
      code: 'E11.9',
      onsetDate: '2019-03-15',
      fhirResourceId: 'cond-1',
      fetchedAt: FRESH,
    });
    expect(out?.currentMedications?.[0]?.fetchedAt).toBe(FRESH);
    expect(out?.allergies?.[0]?.fetchedAt).toBe(FRESH);
    expect(out?.recentObservations?.[0]?.fetchedAt).toBe(FRESH);
  });

  it('drops entries whose fhirResourceId is not in the projected context', () => {
    const hallucinated: BriefEhrEnrichment = {
      activeConditions: [
        { display: 'Type 2 diabetes', code: 'E11.9', onsetDate: '2019-03-15', fhirResourceId: 'cond-1' },
        { display: 'Made up condition', code: null, onsetDate: null, fhirResourceId: 'hallucinated-id' },
      ],
    };
    const out = hydrateEhrEnrichment(hallucinated, ctx());
    expect(out?.activeConditions?.length).toBe(1);
    expect(out?.activeConditions?.[0]?.fhirResourceId).toBe('cond-1');
  });

  it('suppresses the entire block when no LLM entry matches the projection', () => {
    const allHallucinated: BriefEhrEnrichment = {
      activeConditions: [{ display: 'X', code: null, onsetDate: null, fhirResourceId: 'fake-1' }],
      currentMedications: [{ display: 'Y', status: 'active', fhirResourceId: 'fake-2' }],
    };
    const out = hydrateEhrEnrichment(allHallucinated, ctx());
    expect(out).toBeUndefined();
  });

  it('returns undefined when LLM didn’t emit any ehrEnrichment', () => {
    expect(hydrateEhrEnrichment(undefined, ctx())).toBeUndefined();
  });

  it('returns undefined when no externalEhrContext was passed', () => {
    expect(hydrateEhrEnrichment(VALID_LLM_OUTPUT, null)).toBeUndefined();
  });

  it('omits empty category arrays from the output', () => {
    const conditionsOnly: BriefEhrEnrichment = {
      activeConditions: [{ display: 'Type 2 diabetes', code: 'E11.9', onsetDate: '2019-03-15', fhirResourceId: 'cond-1' }],
    };
    const out = hydrateEhrEnrichment(conditionsOnly, ctx());
    expect(out?.activeConditions?.length).toBe(1);
    expect(out?.currentMedications).toBeUndefined();
    expect(out?.allergies).toBeUndefined();
    expect(out?.recentObservations).toBeUndefined();
  });
});
