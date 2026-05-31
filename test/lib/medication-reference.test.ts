import { describe, expect, it } from 'vitest';

import { lookupMedicationReference } from '@/services/copilot/medication-reference';
import { runTool } from '@/services/copilot/tools';

describe('medication reference lookup', () => {
  it('returns DailyMed-backed losartan adult hypertension guidance', async () => {
    const reference = lookupMedicationReference('Cozaar');
    expect(reference?.canonicalName).toBe('losartan');
    expect(reference?.sourceId).toBe('dailymed:losartan-potassium');
    expect(reference?.adultDosing[0]).toMatchObject({
      indication: 'adult hypertension',
      usualStartingDose: '50 mg by mouth once daily',
      maximumDose: '100 mg by mouth once daily',
    });
    expect(reference?.adultDosing[0]?.lowerStartingDoseConsiderations).toContain(
      '25 mg once daily for possible intravascular volume depletion, such as active diuretic therapy.',
    );
  });

  it('is exposed as a chart-safe copilot tool without patient arguments', async () => {
    const result = await runTool(
      'lookupMedicationReference',
      { medicationName: 'losartan' },
      { orgId: 'org-does-not-matter' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rowCount).toBe(1);
    expect(result.data).toMatchObject({
      medicationName: 'losartan',
      reference: {
        canonicalName: 'losartan',
        sourceLabel: 'DailyMed losartan potassium label',
      },
    });
  });

  it('returns an empty reference result for unsupported drugs', async () => {
    const result = await runTool(
      'lookupMedicationReference',
      { medicationName: 'not-a-real-medication' },
      { orgId: 'org-does-not-matter' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rowCount).toBe(0);
    expect(result.data).toMatchObject({
      medicationName: 'not-a-real-medication',
      reference: null,
    });
  });
});
