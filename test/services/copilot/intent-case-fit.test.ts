import { describe, it, expect } from 'vitest';

import { evaluateIntentCaseFit } from '@/services/copilot/intent-case-fit';

describe('evaluateIntentCaseFit', () => {
  it('returns LIKELY_FITS when intent is null (no opinion)', () => {
    const r = evaluateIntentCaseFit({
      encounterIntent: null,
      caseICDs: { primaryIcd: 'M54.50', secondaryIcd: null },
    });
    expect(r.verdict).toBe('LIKELY_FITS');
    expect(r.matchedIcd).toBeNull();
  });

  it('returns LIKELY_FITS when intent is UNSPECIFIED', () => {
    const r = evaluateIntentCaseFit({
      encounterIntent: 'UNSPECIFIED',
      caseICDs: { primaryIcd: 'M54.50', secondaryIcd: null },
    });
    expect(r.verdict).toBe('LIKELY_FITS');
    expect(r.reason).toContain('not specified');
  });

  it('returns LIKELY_FITS when case has no primary ICD', () => {
    const r = evaluateIntentCaseFit({
      encounterIntent: 'REHAB_PROGRESS_NOTE',
      caseICDs: { primaryIcd: null, secondaryIcd: 'M54.50' },
    });
    expect(r.verdict).toBe('LIKELY_FITS');
    expect(r.reason).toContain('no primary ICD');
  });

  it('returns FITS when intent matches primary ICD prefix', () => {
    const r = evaluateIntentCaseFit({
      encounterIntent: 'REHAB_PROGRESS_NOTE',
      caseICDs: { primaryIcd: 'M54.50', secondaryIcd: null },
    });
    expect(r.verdict).toBe('FITS');
    expect(r.matchedIcd).toBe('M54.50');
    expect(r.reason).toContain('M54.50');
  });

  it('returns FITS when intent matches secondary ICD prefix', () => {
    const r = evaluateIntentCaseFit({
      encounterIntent: 'REHAB_INITIAL_EVAL',
      caseICDs: { primaryIcd: 'E11.9', secondaryIcd: 'S83.5' },
    });
    expect(r.verdict).toBe('FITS');
    expect(r.matchedIcd).toBe('S83.5');
  });

  it('returns MISFITS when intent has affinity but neither ICD matches', () => {
    const r = evaluateIntentCaseFit({
      encounterIntent: 'REHAB_PROGRESS_NOTE',
      caseICDs: { primaryIcd: 'E11.9', secondaryIcd: 'F41.1' },
    });
    expect(r.verdict).toBe('MISFITS');
    expect(r.matchedIcd).toBeNull();
    expect(r.reason.toLowerCase()).toContain("doesn't match");
    expect(r.reason).toContain('E11.9');
    expect(r.reason).toContain('F41.1');
  });

  it('returns MISFITS for BH intent against a non-F ICD', () => {
    const r = evaluateIntentCaseFit({
      encounterIntent: 'BH_SESSION_INDIVIDUAL',
      caseICDs: { primaryIcd: 'M54.50', secondaryIcd: null },
    });
    expect(r.verdict).toBe('MISFITS');
  });

  it('returns LIKELY_FITS for an intent with NO defined affinity (cannot prove misfit)', () => {
    // MEDICAL_FOLLOW_UP has no affinity prefixes in the nominator table
    const r = evaluateIntentCaseFit({
      encounterIntent: 'MEDICAL_FOLLOW_UP',
      caseICDs: { primaryIcd: 'M54.50', secondaryIcd: null },
    });
    expect(r.verdict).toBe('LIKELY_FITS');
    expect(r.reason).toContain('no specific ICD affinity');
  });

  it('returns FITS for ANNUAL_WELLNESS against a Z00 ICD', () => {
    const r = evaluateIntentCaseFit({
      encounterIntent: 'MEDICAL_ANNUAL_WELLNESS',
      caseICDs: { primaryIcd: 'Z00.00', secondaryIcd: null },
    });
    expect(r.verdict).toBe('FITS');
    expect(r.matchedIcd).toBe('Z00.00');
  });

  it('reason is always non-empty', () => {
    const verdicts = [
      { encounterIntent: null, caseICDs: { primaryIcd: 'M54.50', secondaryIcd: null } },
      { encounterIntent: 'REHAB_PROGRESS_NOTE' as const, caseICDs: { primaryIcd: 'M54.50', secondaryIcd: null } },
      { encounterIntent: 'REHAB_PROGRESS_NOTE' as const, caseICDs: { primaryIcd: 'E11.9', secondaryIcd: null } },
      { encounterIntent: 'MEDICAL_FOLLOW_UP' as const, caseICDs: { primaryIcd: 'E11.9', secondaryIcd: null } },
    ];
    for (const v of verdicts) {
      const r = evaluateIntentCaseFit(v);
      expect(r.reason).toBeTruthy();
      expect(typeof r.reason).toBe('string');
    }
  });
});
