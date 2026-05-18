import { describe, it, expect } from 'vitest';
import { Division } from '@prisma/client';
import { resolveDivisionForNote } from '@/lib/divisions/resolve';

describe('resolveDivisionForNote (Unit 02 §E)', () => {
  it('episode wins over org and patient', () => {
    const d = resolveDivisionForNote({
      patient: { division: Division.MEDICAL },
      episode: { division: Division.REHAB },
      org: { division: Division.MULTI, defaultDivision: Division.BEHAVIORAL_HEALTH },
    });
    expect(d).toBe(Division.REHAB);
  });

  it('non-MULTI org division wins when no episode', () => {
    const d = resolveDivisionForNote({
      patient: { division: Division.REHAB },
      episode: null,
      org: { division: Division.MEDICAL, defaultDivision: null },
    });
    expect(d).toBe(Division.MEDICAL);
  });

  it('MULTI org falls back to defaultDivision when no episode', () => {
    const d = resolveDivisionForNote({
      patient: { division: Division.REHAB },
      episode: null,
      org: { division: Division.MULTI, defaultDivision: Division.MEDICAL },
    });
    expect(d).toBe(Division.MEDICAL);
  });

  it('MULTI org without defaultDivision falls back to patient.division', () => {
    const d = resolveDivisionForNote({
      patient: { division: Division.BEHAVIORAL_HEALTH },
      episode: null,
      org: { division: Division.MULTI, defaultDivision: null },
    });
    expect(d).toBe(Division.BEHAVIORAL_HEALTH);
  });
});
