import { describe, it, expect } from 'vitest';
import { Division, Profession } from '@prisma/client';
import {
  resolveDivisionForNote,
  DivisionResolutionError,
} from '@/lib/divisions/resolve';

describe('resolveDivisionForNote (profession-driven)', () => {
  it('profession maps to its canonical division (PT → REHAB)', () => {
    const d = resolveDivisionForNote({
      clinician: { professionType: Profession.PT, division: Division.MEDICAL },
      org: { division: Division.MULTI, defaultDivision: Division.MEDICAL },
    });
    expect(d).toBe(Division.REHAB);
  });

  it('profession maps to its canonical division (MD → MEDICAL)', () => {
    const d = resolveDivisionForNote({
      clinician: { professionType: Profession.MD, division: Division.REHAB },
      org: { division: Division.REHAB, defaultDivision: null },
    });
    expect(d).toBe(Division.MEDICAL);
  });

  it('profession maps to its canonical division (LCSW → BEHAVIORAL_HEALTH)', () => {
    const d = resolveDivisionForNote({
      clinician: { professionType: Profession.LCSW, division: Division.MEDICAL },
      org: { division: Division.MEDICAL, defaultDivision: null },
    });
    expect(d).toBe(Division.BEHAVIORAL_HEALTH);
  });

  it('profession=OTHER throws — must be refused before reaching this path', () => {
    expect(() =>
      resolveDivisionForNote({
        clinician: { professionType: Profession.OTHER, division: Division.MEDICAL },
        org: { division: Division.MEDICAL, defaultDivision: null },
      }),
    ).toThrow(DivisionResolutionError);
  });

  it('null professionType falls back to clinician.division', () => {
    const d = resolveDivisionForNote({
      clinician: { professionType: null, division: Division.REHAB },
      org: { division: Division.MULTI, defaultDivision: Division.MEDICAL },
    });
    expect(d).toBe(Division.REHAB);
  });

  it('null professionType + null clinician.division falls back to org.defaultDivision', () => {
    const d = resolveDivisionForNote({
      clinician: { professionType: null, division: null },
      org: { division: Division.MULTI, defaultDivision: Division.BEHAVIORAL_HEALTH },
    });
    expect(d).toBe(Division.BEHAVIORAL_HEALTH);
  });

  it('null professionType + null clinician.division + non-MULTI org falls to org.division', () => {
    const d = resolveDivisionForNote({
      clinician: { professionType: null, division: null },
      org: { division: Division.MEDICAL, defaultDivision: null },
    });
    expect(d).toBe(Division.MEDICAL);
  });

  it('throws when nothing can derive a division', () => {
    expect(() =>
      resolveDivisionForNote({
        clinician: { professionType: null, division: null },
        org: { division: Division.MULTI, defaultDivision: null },
      }),
    ).toThrow(DivisionResolutionError);
  });
});
