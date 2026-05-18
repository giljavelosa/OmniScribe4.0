import { describe, it, expect } from 'vitest';

import {
  REHAB_MEASURES,
  MEDICAL_MEASURES,
  BH_MEASURES,
  registryForDivision,
  findMeasureDef,
} from '@/lib/snapshots/registry';
import { derivePatientDivision, MULTI_FALLBACK_DIVISION, renderDivisionFor } from '@/lib/snapshots/division';

describe('snapshot registry', () => {
  it('exposes ≤6 measures per division (UI cap)', () => {
    expect(REHAB_MEASURES.length).toBeLessThanOrEqual(6);
    expect(MEDICAL_MEASURES.length).toBeLessThanOrEqual(6);
    expect(BH_MEASURES.length).toBeLessThanOrEqual(6);
  });

  it('every measure key is unique across all divisions', () => {
    const all = [...REHAB_MEASURES, ...MEDICAL_MEASURES, ...BH_MEASURES];
    const keys = new Set(all.map((m) => m.key));
    expect(keys.size).toBe(all.length);
  });

  it('rehab measures are episode-scoped; medical + BH are patient-scoped', () => {
    for (const m of REHAB_MEASURES) expect(m.scope).toBe('episode');
    for (const m of MEDICAL_MEASURES) expect(m.scope).toBe('patient');
    for (const m of BH_MEASURES) expect(m.scope).toBe('patient');
  });

  it('registryForDivision returns the matching registry', () => {
    expect(registryForDivision('REHAB')).toBe(REHAB_MEASURES);
    expect(registryForDivision('MEDICAL')).toBe(MEDICAL_MEASURES);
    expect(registryForDivision('BEHAVIORAL_HEALTH')).toBe(BH_MEASURES);
  });

  it('findMeasureDef looks up by key across all divisions', () => {
    expect(findMeasureDef('pain-nrs')?.division).toBe('REHAB');
    expect(findMeasureDef('bp')?.division).toBe('MEDICAL');
    expect(findMeasureDef('phq9-total')?.division).toBe('BEHAVIORAL_HEALTH');
    expect(findMeasureDef('not-a-real-key')).toBeNull();
  });
});

describe('derivePatientDivision', () => {
  it('prefers active episode division over site + org', () => {
    const result = derivePatientDivision({
      activeEpisode: { division: 'REHAB' },
      site: { primaryDivision: 'MEDICAL' },
      org: { defaultDivision: 'BEHAVIORAL_HEALTH', division: 'MULTI' },
    });
    expect(result).toBe('REHAB');
  });

  it('falls back to site primaryDivision when no active episode', () => {
    const result = derivePatientDivision({
      activeEpisode: null,
      site: { primaryDivision: 'MEDICAL' },
      org: { defaultDivision: 'BEHAVIORAL_HEALTH', division: 'MULTI' },
    });
    expect(result).toBe('MEDICAL');
  });

  it('falls back to org defaultDivision when no episode + no site division', () => {
    const result = derivePatientDivision({
      activeEpisode: null,
      site: { primaryDivision: null },
      org: { defaultDivision: 'BEHAVIORAL_HEALTH', division: 'MULTI' },
    });
    expect(result).toBe('BEHAVIORAL_HEALTH');
  });

  it('falls back to org division when defaultDivision is null', () => {
    const result = derivePatientDivision({
      activeEpisode: null,
      site: null,
      org: { defaultDivision: null, division: 'MULTI' },
    });
    expect(result).toBe('MULTI');
  });
});

describe('renderDivisionFor', () => {
  it('collapses MULTI to the M1 fallback (REHAB for LRCHC pilot)', () => {
    expect(renderDivisionFor('MULTI')).toBe(MULTI_FALLBACK_DIVISION);
    expect(MULTI_FALLBACK_DIVISION).toBe('REHAB');
  });

  it('passes non-MULTI divisions through unchanged', () => {
    expect(renderDivisionFor('REHAB')).toBe('REHAB');
    expect(renderDivisionFor('MEDICAL')).toBe('MEDICAL');
    expect(renderDivisionFor('BEHAVIORAL_HEALTH')).toBe('BEHAVIORAL_HEALTH');
  });
});
