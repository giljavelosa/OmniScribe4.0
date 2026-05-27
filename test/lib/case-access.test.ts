import { describe, it, expect } from 'vitest';
import {
  assertCanContinueCase,
  assertCanTriageFollowUp,
  CaseDivisionDeniedError,
  FollowUpDivisionDeniedError,
} from '@/lib/case-access';
import type { Division } from '@prisma/client';

function mkCase(id: string, division: Division) {
  return { id, division };
}

function mkClinician(division: Division) {
  return { division };
}

describe('assertCanContinueCase', () => {
  it('passes when clinician division matches case division (REHAB)', () => {
    expect(() =>
      assertCanContinueCase(
        mkCase('case-1', 'REHAB' as Division),
        mkClinician('REHAB' as Division),
      ),
    ).not.toThrow();
  });

  it('passes when clinician division matches case division (MEDICAL)', () => {
    expect(() =>
      assertCanContinueCase(
        mkCase('case-2', 'MEDICAL' as Division),
        mkClinician('MEDICAL' as Division),
      ),
    ).not.toThrow();
  });

  it('passes when clinician division matches case division (BEHAVIORAL_HEALTH)', () => {
    expect(() =>
      assertCanContinueCase(
        mkCase('case-3', 'BEHAVIORAL_HEALTH' as Division),
        mkClinician('BEHAVIORAL_HEALTH' as Division),
      ),
    ).not.toThrow();
  });

  it('passes for any clinician when case is MULTI (escape hatch)', () => {
    for (const cd of ['REHAB', 'MEDICAL', 'BEHAVIORAL_HEALTH', 'MULTI'] as Division[]) {
      expect(() =>
        assertCanContinueCase(
          mkCase('case-multi', 'MULTI' as Division),
          mkClinician(cd),
        ),
      ).not.toThrow();
    }
  });

  it('passes for MULTI clinician against any same-or-not case', () => {
    // MULTI clinician only passes when case is also MULTI (no broad bypass).
    // Same-division match for MULTI clinician = case is MULTI.
    expect(() =>
      assertCanContinueCase(
        mkCase('case-multi-2', 'MULTI' as Division),
        mkClinician('MULTI' as Division),
      ),
    ).not.toThrow();
  });

  it('throws CaseDivisionDeniedError when REHAB clinician hits MEDICAL case', () => {
    expect(() =>
      assertCanContinueCase(
        mkCase('case-med', 'MEDICAL' as Division),
        mkClinician('REHAB' as Division),
      ),
    ).toThrow(CaseDivisionDeniedError);
  });

  it('throws CaseDivisionDeniedError when MEDICAL clinician hits BH case', () => {
    expect(() =>
      assertCanContinueCase(
        mkCase('case-bh', 'BEHAVIORAL_HEALTH' as Division),
        mkClinician('MEDICAL' as Division),
      ),
    ).toThrow(CaseDivisionDeniedError);
  });

  it('throws CaseDivisionDeniedError when MULTI-only clinician hits a non-MULTI case', () => {
    // Anti-bypass: a MULTI-labeled clinician does NOT silently pass into
    // every case. The rule is symmetric on the case side, not the clinician.
    expect(() =>
      assertCanContinueCase(
        mkCase('case-rehab', 'REHAB' as Division),
        mkClinician('MULTI' as Division),
      ),
    ).toThrow(CaseDivisionDeniedError);
  });

  it('error carries the caseId and both divisions for audit metadata', () => {
    try {
      assertCanContinueCase(
        mkCase('case-with-id', 'MEDICAL' as Division),
        mkClinician('REHAB' as Division),
      );
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CaseDivisionDeniedError);
      const e = err as CaseDivisionDeniedError;
      expect(e.name).toBe('CaseDivisionDeniedError');
      expect(e.caseId).toBe('case-with-id');
      expect(e.caseDivision).toBe('MEDICAL');
      expect(e.clinicianDivision).toBe('REHAB');
      expect(e.message).toContain('REHAB');
      expect(e.message).toContain('MEDICAL');
      expect(e.message).toContain('case-with-id');
    }
  });
});

// ============================================================================
// PR2 — Follow-up triage gate (mirror coverage of the case gate).
// ============================================================================

function mkFollowUp(id: string, division: Division) {
  return { id, division };
}

describe('assertCanTriageFollowUp', () => {
  it('passes when clinician division matches follow-up division (REHAB)', () => {
    expect(() =>
      assertCanTriageFollowUp(
        mkFollowUp('fu-1', 'REHAB' as Division),
        mkClinician('REHAB' as Division),
      ),
    ).not.toThrow();
  });

  it('passes when clinician division matches follow-up division (MEDICAL)', () => {
    expect(() =>
      assertCanTriageFollowUp(
        mkFollowUp('fu-2', 'MEDICAL' as Division),
        mkClinician('MEDICAL' as Division),
      ),
    ).not.toThrow();
  });

  it('passes when clinician division matches follow-up division (BEHAVIORAL_HEALTH)', () => {
    expect(() =>
      assertCanTriageFollowUp(
        mkFollowUp('fu-3', 'BEHAVIORAL_HEALTH' as Division),
        mkClinician('BEHAVIORAL_HEALTH' as Division),
      ),
    ).not.toThrow();
  });

  it('passes for any clinician when follow-up is MULTI (escape hatch)', () => {
    for (const cd of ['REHAB', 'MEDICAL', 'BEHAVIORAL_HEALTH', 'MULTI'] as Division[]) {
      expect(() =>
        assertCanTriageFollowUp(
          mkFollowUp('fu-multi', 'MULTI' as Division),
          mkClinician(cd),
        ),
      ).not.toThrow();
    }
  });

  it('throws FollowUpDivisionDeniedError when PT (REHAB) hits a MEDICAL follow-up', () => {
    // The exact hole PR2 closes: a PT could mark a primary-care MD's
    // follow-up as MET/DROPPED/CARRIED. Now refused.
    expect(() =>
      assertCanTriageFollowUp(
        mkFollowUp('fu-med', 'MEDICAL' as Division),
        mkClinician('REHAB' as Division),
      ),
    ).toThrow(FollowUpDivisionDeniedError);
  });

  it('throws FollowUpDivisionDeniedError when MEDICAL clinician hits a BH follow-up', () => {
    expect(() =>
      assertCanTriageFollowUp(
        mkFollowUp('fu-bh', 'BEHAVIORAL_HEALTH' as Division),
        mkClinician('MEDICAL' as Division),
      ),
    ).toThrow(FollowUpDivisionDeniedError);
  });

  it('throws FollowUpDivisionDeniedError when MULTI clinician hits a non-MULTI follow-up', () => {
    // Mirrors the case-gate anti-bypass: a MULTI-labeled clinician does
    // NOT silently pass into every follow-up. The rule is symmetric on
    // the follow-up side, not the clinician side.
    expect(() =>
      assertCanTriageFollowUp(
        mkFollowUp('fu-rehab', 'REHAB' as Division),
        mkClinician('MULTI' as Division),
      ),
    ).toThrow(FollowUpDivisionDeniedError);
  });

  it('error carries the followUpId and both divisions for audit metadata', () => {
    try {
      assertCanTriageFollowUp(
        mkFollowUp('fu-with-id', 'MEDICAL' as Division),
        mkClinician('REHAB' as Division),
      );
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FollowUpDivisionDeniedError);
      const e = err as FollowUpDivisionDeniedError;
      expect(e.name).toBe('FollowUpDivisionDeniedError');
      expect(e.followUpId).toBe('fu-with-id');
      expect(e.followUpDivision).toBe('MEDICAL');
      expect(e.clinicianDivision).toBe('REHAB');
      expect(e.message).toContain('REHAB');
      expect(e.message).toContain('MEDICAL');
      expect(e.message).toContain('fu-with-id');
    }
  });
});
