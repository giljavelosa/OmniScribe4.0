import { describe, expect, it } from 'vitest';

import { projectCachedRows } from '@/lib/fhir/project-ehr-context';
import type {
  SimplifiedAllergyIntolerance,
  SimplifiedCondition,
  SimplifiedDiagnosticReport,
  SimplifiedMedicationRequest,
  SimplifiedMedicationStatement,
  SimplifiedObservation,
  SimplifiedProcedure,
} from '@/services/fhir/adapters';

const NOW = new Date('2026-05-17T12:00:00Z');
const FRESH = new Date('2026-05-16T12:00:00Z');
const STALE = new Date('2026-05-01T12:00:00Z');

function row(
  resourceType: string,
  id: string,
  simplified: unknown,
  fetchedAt = FRESH,
): { resourceType: string; fhirResourceId: string; fetchedAt: Date; resource: unknown } {
  return {
    resourceType,
    fhirResourceId: id,
    fetchedAt,
    resource: { raw: {}, simplified },
  };
}

describe('projectCachedRows', () => {
  it('returns null when no fresh rows', () => {
    const stale: SimplifiedCondition = {
      code: null,
      display: 'X',
      clinicalStatus: 'active',
      onsetDate: null,
      recordedDate: null,
    };
    const out = projectCachedRows({
      ehrSystem: 'nextgen',
      rows: [row('Condition', 'c1', stale, STALE)],
      now: NOW,
    });
    expect(out).toBeNull();
  });

  it('drops conditions with clinicalStatus !== "active"', () => {
    const active: SimplifiedCondition = {
      code: 'E11.9',
      display: 'Type 2 diabetes',
      clinicalStatus: 'active',
      onsetDate: '2019-03-15',
      recordedDate: null,
    };
    const resolved: SimplifiedCondition = {
      code: 'I10',
      display: 'Old hypertension',
      clinicalStatus: 'resolved',
      onsetDate: null,
      recordedDate: null,
    };
    const out = projectCachedRows({
      ehrSystem: 'nextgen',
      rows: [row('Condition', 'c1', active), row('Condition', 'c2', resolved)],
      now: NOW,
    });
    expect(out?.activeConditions.length).toBe(1);
    expect(out?.activeConditions[0]!.display).toBe('Type 2 diabetes');
  });

  it('merges MedicationStatement + MedicationRequest into currentMedications', () => {
    const ms: SimplifiedMedicationStatement = {
      display: 'metformin 500 mg',
      status: 'active',
      effectiveDate: '2024-01-15',
    };
    const mr: SimplifiedMedicationRequest = {
      display: 'atorvastatin 20 mg',
      status: 'active',
      intent: 'order',
      authoredOn: '2025-08-12',
    };
    const out = projectCachedRows({
      ehrSystem: 'nextgen',
      rows: [
        row('MedicationStatement', 'ms1', ms),
        row('MedicationRequest', 'mr1', mr),
      ],
      now: NOW,
    });
    expect(out?.currentMedications.length).toBe(2);
    expect(out?.currentMedications.map((m) => m.sourceType).sort()).toEqual([
      'MedicationRequest',
      'MedicationStatement',
    ]);
  });

  it('drops medications with non-active/non-intended status', () => {
    const stopped: SimplifiedMedicationStatement = {
      display: 'ibuprofen 200 mg',
      status: 'stopped',
      effectiveDate: null,
    };
    const out = projectCachedRows({
      ehrSystem: 'nextgen',
      rows: [row('MedicationStatement', 'ms1', stopped)],
      now: NOW,
    });
    // Fresh row exists, so we get the shape; projection drops the entry.
    expect(out?.currentMedications).toEqual([]);
  });

  it('caps recentObservations at 10, sorted most-recent first', () => {
    const obs = (i: number, date: string): SimplifiedObservation => ({
      code: `LOINC-${i}`,
      display: `obs-${i}`,
      value: '1',
      unit: null,
      effectiveDate: date,
      status: 'final',
    });
    const rows = Array.from({ length: 15 }, (_, i) =>
      row('Observation', `o${i}`, obs(i, `2026-0${(i % 9) + 1}-0${(i % 9) + 1}`)),
    );
    const out = projectCachedRows({ ehrSystem: 'nextgen', rows, now: NOW });
    expect(out?.recentObservations.length).toBe(10);
    const dates = out?.recentObservations.map((o) => o.effectiveDate) ?? [];
    for (let i = 1; i < dates.length; i++) {
      const prev = dates[i - 1];
      const cur = dates[i];
      if (prev && cur) expect(prev >= cur).toBe(true);
    }
  });

  it('skips observations with no value', () => {
    const o: SimplifiedObservation = {
      code: 'X',
      display: 'no-value',
      value: null,
      unit: null,
      effectiveDate: '2026-01-01',
      status: 'final',
    };
    const out = projectCachedRows({
      ehrSystem: 'nextgen',
      rows: [row('Observation', 'o1', o)],
      now: NOW,
    });
    expect(out?.recentObservations).toEqual([]);
  });

  it('keeps all allergies (no status filter)', () => {
    const a: SimplifiedAllergyIntolerance = {
      display: 'Penicillin',
      category: 'medication',
      criticality: 'high',
      recordedDate: '2010-06-21',
    };
    const out = projectCachedRows({
      ehrSystem: 'nextgen',
      rows: [row('AllergyIntolerance', 'a1', a)],
      now: NOW,
    });
    expect(out?.allergies.length).toBe(1);
  });

  it('caps procedures + reports at 5 each, sorted most-recent first', () => {
    const procs: SimplifiedProcedure[] = Array.from({ length: 7 }, (_, i) => ({
      display: `proc-${i}`,
      status: 'completed',
      performedDate: `202${(i % 7)}-01-01`,
    }));
    const reps: SimplifiedDiagnosticReport[] = Array.from({ length: 7 }, (_, i) => ({
      display: `rep-${i}`,
      status: 'final',
      effectiveDate: `202${(i % 7)}-01-01`,
      conclusion: null,
    }));
    const out = projectCachedRows({
      ehrSystem: 'nextgen',
      rows: [
        ...procs.map((p, i) => row('Procedure', `p${i}`, p)),
        ...reps.map((r, i) => row('DiagnosticReport', `r${i}`, r)),
      ],
      now: NOW,
    });
    expect(out?.recentProcedures.length).toBe(5);
    expect(out?.recentDiagnosticReports.length).toBe(5);
  });

  it('attaches provenance to every projected entry', () => {
    const c: SimplifiedCondition = {
      code: 'E11.9',
      display: 'DM2',
      clinicalStatus: 'active',
      onsetDate: '2019-03-15',
      recordedDate: null,
    };
    const out = projectCachedRows({
      ehrSystem: 'nextgen',
      rows: [row('Condition', 'cond-123', c)],
      now: NOW,
    });
    const first = out?.activeConditions[0];
    expect(first?.provenance).toEqual({
      source: 'fhir',
      ehrSystem: 'nextgen',
      fhirResourceType: 'Condition',
      fhirResourceId: 'cond-123',
      fetchedAt: FRESH.toISOString(),
    });
  });

  it('returns the context shape with empty arrays when only Patient rows present', () => {
    const out = projectCachedRows({
      ehrSystem: 'nextgen',
      rows: [
        row('Patient', 'pat-1', {
          given: ['Jane'],
          family: 'Doe',
          birthDate: '1985-04-12',
          gender: 'female',
          mrn: null,
        }),
      ],
      now: NOW,
    });
    expect(out).toEqual({
      ehrSystem: 'nextgen',
      activeConditions: [],
      currentMedications: [],
      allergies: [],
      recentObservations: [],
      recentProcedures: [],
      recentDiagnosticReports: [],
    });
  });
});
