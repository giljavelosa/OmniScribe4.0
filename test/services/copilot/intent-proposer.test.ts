import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EncounterIntent } from '@prisma/client';

import {
  isIntentValidForDivision,
  proposeIntent,
  type IntentProposalInput,
  type IntentProposalEpisode,
  type IntentProposalPatient,
  type IntentProposalPriorNote,
} from '@/services/copilot/intent-proposer';

// =============================================================================
// Fixtures — small helpers so test cases stay readable.
//
// The proposer reads `new Date()` internally for cadence math (days since
// last progress note, months since AWV, etc.). We pin the system clock to
// NOW so test fixtures (`daysAgo(7)`) and the proposer's internal "today"
// agree byte-for-byte. Without this the assertions would drift with wall
// time and fail on slow CI runs that cross a midnight boundary.
// =============================================================================

const NOW = new Date('2026-05-26T12:00:00Z');
const MS_PER_DAY = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MS_PER_DAY);
}

function note(intent: EncounterIntent, days: number): IntentProposalPriorNote {
  return { signedAt: daysAgo(days), intent };
}

function rehabEpisode(over: Partial<IntentProposalEpisode> = {}): IntentProposalEpisode {
  return {
    status: 'ACTIVE',
    visitsCompleted: 5,
    startedAt: daysAgo(15),
    recertDueAt: null,
    lastProgressNoteAt: null,
    visitsSinceLastProgressNote: 5,
    ...over,
  };
}

function medicarePatient(over: Partial<IntentProposalPatient> = {}): IntentProposalPatient {
  return {
    medicareEligible: true,
    lastAWVAt: null,
    lastHospitalDischargeAt: null,
    enrolledInCCM: false,
    daysSinceLastSeenInGroup: 30,
    ...over,
  };
}

function input(over: Partial<IntentProposalInput>): IntentProposalInput {
  return {
    division: 'REHAB',
    episode: null,
    priorNotes: [],
    schedule: null,
    patient: null,
    ...over,
  };
}

// =============================================================================
// Division routing
// =============================================================================

describe('proposeIntent — division routing', () => {
  it('routes REHAB division to the REHAB calculator', () => {
    const r = proposeIntent(input({ division: 'REHAB' }));
    expect(r.intent).toBe(EncounterIntent.REHAB_INITIAL_EVAL); // empty priors → IE
  });

  it('routes BEHAVIORAL_HEALTH division to the BH calculator', () => {
    const r = proposeIntent(input({ division: 'BEHAVIORAL_HEALTH' }));
    expect(r.intent).toBe(EncounterIntent.BH_INITIAL_ASSESSMENT);
  });

  it('routes MEDICAL division to the MEDICAL calculator', () => {
    const r = proposeIntent(input({ division: 'MEDICAL' }));
    expect(r.intent).toBe(EncounterIntent.MEDICAL_NEW_PATIENT);
  });

  it('MULTI division returns UNSPECIFIED with low confidence', () => {
    const r = proposeIntent(input({ division: 'MULTI' }));
    expect(r.intent).toBe(EncounterIntent.UNSPECIFIED);
    expect(r.confidence).toBe('low');
    expect(r.reason).toMatch(/multi-division/);
  });
});

// =============================================================================
// REHAB calculator — taxonomy §3.2
// =============================================================================

describe('proposeIntent — REHAB calculator', () => {
  it('zero priors → REHAB_INITIAL_EVAL (high confidence)', () => {
    const r = proposeIntent(input({ division: 'REHAB', priorNotes: [] }));
    expect(r.intent).toBe(EncounterIntent.REHAB_INITIAL_EVAL);
    expect(r.confidence).toBe('high');
    expect(r.reason).toMatch(/first visit/i);
  });

  it('clinician-requested discharge → REHAB_DISCHARGE (high confidence)', () => {
    const r = proposeIntent(
      input({
        division: 'REHAB',
        priorNotes: [note(EncounterIntent.REHAB_DAILY_NOTE, 3)],
        episode: rehabEpisode(),
        clinicianRequestedDischarge: true,
      }),
    );
    expect(r.intent).toBe(EncounterIntent.REHAB_DISCHARGE);
    expect(r.confidence).toBe('high');
  });

  it('episode discharged → REHAB_DISCHARGE (medium confidence — inferred)', () => {
    const r = proposeIntent(
      input({
        division: 'REHAB',
        priorNotes: [note(EncounterIntent.REHAB_DAILY_NOTE, 5)],
        episode: rehabEpisode({ status: 'DISCHARGED' }),
      }),
    );
    expect(r.intent).toBe(EncounterIntent.REHAB_DISCHARGE);
    expect(r.confidence).toBe('medium');
  });

  it('episode cancelled → REHAB_DISCHARGE', () => {
    const r = proposeIntent(
      input({
        division: 'REHAB',
        priorNotes: [note(EncounterIntent.REHAB_DAILY_NOTE, 3)],
        episode: rehabEpisode({ status: 'CANCELLED' }),
      }),
    );
    expect(r.intent).toBe(EncounterIntent.REHAB_DISCHARGE);
  });

  it('clinician-requested reeval → REHAB_REEVAL', () => {
    const r = proposeIntent(
      input({
        division: 'REHAB',
        priorNotes: [note(EncounterIntent.REHAB_DAILY_NOTE, 2)],
        episode: rehabEpisode(),
        clinicianRequestedReeval: true,
      }),
    );
    expect(r.intent).toBe(EncounterIntent.REHAB_REEVAL);
    expect(r.confidence).toBe('high');
  });

  describe('Progress Note cadence (CMS Pub. 100-02 Ch. 15 §220.3)', () => {
    it('exactly 10 visits since last Progress Note → REHAB_PROGRESS_NOTE', () => {
      const priorNotes: IntentProposalPriorNote[] = [
        note(EncounterIntent.REHAB_PROGRESS_NOTE, 25),
        ...Array.from({ length: 10 }, (_, i) =>
          note(EncounterIntent.REHAB_DAILY_NOTE, 22 - i * 2),
        ),
      ];
      const r = proposeIntent(
        input({
          division: 'REHAB',
          priorNotes,
          episode: rehabEpisode({
            visitsCompleted: 11,
            lastProgressNoteAt: daysAgo(25),
            visitsSinceLastProgressNote: 10,
          }),
        }),
      );
      expect(r.intent).toBe(EncounterIntent.REHAB_PROGRESS_NOTE);
      expect(r.confidence).toBe('high');
      expect(r.reason).toMatch(/10 visits/);
    });

    it('9 visits since last Progress Note (under threshold) → REHAB_DAILY_NOTE', () => {
      const r = proposeIntent(
        input({
          division: 'REHAB',
          priorNotes: [
            note(EncounterIntent.REHAB_PROGRESS_NOTE, 20),
            ...Array.from({ length: 9 }, (_, i) =>
              note(EncounterIntent.REHAB_DAILY_NOTE, 18 - i * 2),
            ),
          ],
          episode: rehabEpisode({
            visitsCompleted: 10,
            lastProgressNoteAt: daysAgo(20),
            visitsSinceLastProgressNote: 9,
          }),
        }),
      );
      expect(r.intent).toBe(EncounterIntent.REHAB_DAILY_NOTE);
    });

    it('30 days since last Progress Note (visit threshold not met) → REHAB_PROGRESS_NOTE', () => {
      const r = proposeIntent(
        input({
          division: 'REHAB',
          priorNotes: [
            note(EncounterIntent.REHAB_PROGRESS_NOTE, 30),
            note(EncounterIntent.REHAB_DAILY_NOTE, 20),
            note(EncounterIntent.REHAB_DAILY_NOTE, 10),
          ],
          episode: rehabEpisode({
            visitsCompleted: 3,
            lastProgressNoteAt: daysAgo(30),
            visitsSinceLastProgressNote: 2,
          }),
        }),
      );
      expect(r.intent).toBe(EncounterIntent.REHAB_PROGRESS_NOTE);
      expect(r.reason).toMatch(/30 days/);
    });

    it('29 days since last Progress Note (under both thresholds) → REHAB_DAILY_NOTE', () => {
      const r = proposeIntent(
        input({
          division: 'REHAB',
          priorNotes: [
            note(EncounterIntent.REHAB_PROGRESS_NOTE, 29),
            note(EncounterIntent.REHAB_DAILY_NOTE, 5),
          ],
          episode: rehabEpisode({
            visitsCompleted: 2,
            lastProgressNoteAt: daysAgo(29),
            visitsSinceLastProgressNote: 1,
          }),
        }),
      );
      expect(r.intent).toBe(EncounterIntent.REHAB_DAILY_NOTE);
    });

    it('no Progress Note yet but 30+ days since episode start → REHAB_PROGRESS_NOTE (first progress note for episode)', () => {
      const r = proposeIntent(
        input({
          division: 'REHAB',
          priorNotes: [
            note(EncounterIntent.REHAB_INITIAL_EVAL, 35),
            note(EncounterIntent.REHAB_DAILY_NOTE, 25),
            note(EncounterIntent.REHAB_DAILY_NOTE, 15),
          ],
          episode: rehabEpisode({
            visitsCompleted: 3,
            startedAt: daysAgo(35),
            lastProgressNoteAt: null,
            visitsSinceLastProgressNote: 3,
          }),
        }),
      );
      expect(r.intent).toBe(EncounterIntent.REHAB_PROGRESS_NOTE);
      expect(r.reason).toMatch(/first Progress Note/i);
    });

    it('no Progress Note yet but 10 visits in → REHAB_PROGRESS_NOTE', () => {
      const visits = Array.from({ length: 10 }, (_, i) =>
        note(EncounterIntent.REHAB_DAILY_NOTE, 20 - i * 2),
      );
      const r = proposeIntent(
        input({
          division: 'REHAB',
          priorNotes: [note(EncounterIntent.REHAB_INITIAL_EVAL, 22), ...visits],
          episode: rehabEpisode({
            visitsCompleted: 11,
            startedAt: daysAgo(22),
            lastProgressNoteAt: null,
            visitsSinceLastProgressNote: 11,
          }),
        }),
      );
      expect(r.intent).toBe(EncounterIntent.REHAB_PROGRESS_NOTE);
    });
  });

  it('default for active episode → REHAB_DAILY_NOTE', () => {
    const r = proposeIntent(
      input({
        division: 'REHAB',
        priorNotes: [note(EncounterIntent.REHAB_INITIAL_EVAL, 5)],
        episode: rehabEpisode({
          visitsCompleted: 1,
          startedAt: daysAgo(5),
          lastProgressNoteAt: null,
          visitsSinceLastProgressNote: 1,
        }),
      }),
    );
    expect(r.intent).toBe(EncounterIntent.REHAB_DAILY_NOTE);
    expect(r.confidence).toBe('high');
  });

  it('ad-hoc visit (no episode) → REHAB_DAILY_NOTE', () => {
    const r = proposeIntent(
      input({
        division: 'REHAB',
        priorNotes: [note(EncounterIntent.REHAB_DAILY_NOTE, 5)],
        episode: null,
      }),
    );
    expect(r.intent).toBe(EncounterIntent.REHAB_DAILY_NOTE);
  });
});

// =============================================================================
// BEHAVIORAL_HEALTH calculator — taxonomy §4.2
// =============================================================================

describe('proposeIntent — BEHAVIORAL_HEALTH calculator', () => {
  it('zero priors → BH_INITIAL_ASSESSMENT (high confidence)', () => {
    const r = proposeIntent(input({ division: 'BEHAVIORAL_HEALTH', priorNotes: [] }));
    expect(r.intent).toBe(EncounterIntent.BH_INITIAL_ASSESSMENT);
    expect(r.confidence).toBe('high');
  });

  it('clinician-requested discharge → BH_DISCHARGE', () => {
    const r = proposeIntent(
      input({
        division: 'BEHAVIORAL_HEALTH',
        priorNotes: [note(EncounterIntent.BH_SESSION_INDIVIDUAL, 7)],
        clinicianRequestedDischarge: true,
      }),
    );
    expect(r.intent).toBe(EncounterIntent.BH_DISCHARGE);
  });

  it('exactly 90 days since last Treatment Plan Review → BH_TREATMENT_PLAN_REVIEW', () => {
    const r = proposeIntent(
      input({
        division: 'BEHAVIORAL_HEALTH',
        priorNotes: [
          note(EncounterIntent.BH_TREATMENT_PLAN_REVIEW, 90),
          note(EncounterIntent.BH_SESSION_INDIVIDUAL, 60),
          note(EncounterIntent.BH_SESSION_INDIVIDUAL, 30),
        ],
      }),
    );
    expect(r.intent).toBe(EncounterIntent.BH_TREATMENT_PLAN_REVIEW);
    expect(r.confidence).toBe('high');
    expect(r.reason).toMatch(/90 days/);
  });

  it('89 days since last TPR → still SESSION_INDIVIDUAL', () => {
    const r = proposeIntent(
      input({
        division: 'BEHAVIORAL_HEALTH',
        priorNotes: [
          note(EncounterIntent.BH_TREATMENT_PLAN_REVIEW, 89),
          note(EncounterIntent.BH_SESSION_INDIVIDUAL, 7),
        ],
      }),
    );
    expect(r.intent).toBe(EncounterIntent.BH_SESSION_INDIVIDUAL);
  });

  it('no TPR ever + 90 days since intake → BH_TREATMENT_PLAN_REVIEW (overdue first TPR)', () => {
    const r = proposeIntent(
      input({
        division: 'BEHAVIORAL_HEALTH',
        priorNotes: [
          note(EncounterIntent.BH_INITIAL_ASSESSMENT, 100),
          note(EncounterIntent.BH_SESSION_INDIVIDUAL, 60),
          note(EncounterIntent.BH_SESSION_INDIVIDUAL, 30),
        ],
      }),
    );
    expect(r.intent).toBe(EncounterIntent.BH_TREATMENT_PLAN_REVIEW);
    expect(r.reason).toMatch(/since intake/i);
  });

  it("schedule notes 'family' → BH_SESSION_FAMILY (medium confidence)", () => {
    const r = proposeIntent(
      input({
        division: 'BEHAVIORAL_HEALTH',
        priorNotes: [note(EncounterIntent.BH_SESSION_INDIVIDUAL, 7)],
        schedule: { notes: 'Family session - bring partner' },
      }),
    );
    expect(r.intent).toBe(EncounterIntent.BH_SESSION_FAMILY);
    expect(r.confidence).toBe('medium');
  });

  it("schedule notes 'group' → BH_SESSION_GROUP", () => {
    const r = proposeIntent(
      input({
        division: 'BEHAVIORAL_HEALTH',
        priorNotes: [note(EncounterIntent.BH_SESSION_INDIVIDUAL, 7)],
        schedule: { notes: 'DBT skills group Tuesday' },
      }),
    );
    expect(r.intent).toBe(EncounterIntent.BH_SESSION_GROUP);
  });

  it('default established patient → BH_SESSION_INDIVIDUAL', () => {
    const r = proposeIntent(
      input({
        division: 'BEHAVIORAL_HEALTH',
        priorNotes: [note(EncounterIntent.BH_SESSION_INDIVIDUAL, 7)],
      }),
    );
    expect(r.intent).toBe(EncounterIntent.BH_SESSION_INDIVIDUAL);
    expect(r.confidence).toBe('high');
  });
});

// =============================================================================
// MEDICAL calculator — taxonomy §5.2
// =============================================================================

describe('proposeIntent — MEDICAL calculator', () => {
  it('zero priors → MEDICAL_NEW_PATIENT (high confidence)', () => {
    const r = proposeIntent(input({ division: 'MEDICAL', priorNotes: [] }));
    expect(r.intent).toBe(EncounterIntent.MEDICAL_NEW_PATIENT);
    expect(r.confidence).toBe('high');
    expect(r.reason).toMatch(/first visit/i);
  });

  it('not seen in this group >3 years → MEDICAL_NEW_PATIENT (Medicare definition)', () => {
    const r = proposeIntent(
      input({
        division: 'MEDICAL',
        priorNotes: [note(EncounterIntent.MEDICAL_FOLLOW_UP, 1200)],
        patient: medicarePatient({ daysSinceLastSeenInGroup: 1200 }),
      }),
    );
    expect(r.intent).toBe(EncounterIntent.MEDICAL_NEW_PATIENT);
    expect(r.reason).toMatch(/1200 days/);
  });

  it('seen 1094 days ago (under threshold) → established follow-up', () => {
    const r = proposeIntent(
      input({
        division: 'MEDICAL',
        priorNotes: [note(EncounterIntent.MEDICAL_FOLLOW_UP, 1094)],
        patient: medicarePatient({ daysSinceLastSeenInGroup: 1094, medicareEligible: false }),
      }),
    );
    expect(r.intent).toBe(EncounterIntent.MEDICAL_FOLLOW_UP);
  });

  describe('TCM (hospital discharge follow-up)', () => {
    it('hospital discharge 7 days ago → MEDICAL_DISCHARGE_TCM (high confidence)', () => {
      const r = proposeIntent(
        input({
          division: 'MEDICAL',
          priorNotes: [note(EncounterIntent.MEDICAL_FOLLOW_UP, 30)],
          patient: medicarePatient({ lastHospitalDischargeAt: daysAgo(7) }),
        }),
      );
      expect(r.intent).toBe(EncounterIntent.MEDICAL_DISCHARGE_TCM);
      expect(r.confidence).toBe('high');
      expect(r.reason).toMatch(/7d post/);
    });

    it('hospital discharge exactly 14 days ago → still MEDICAL_DISCHARGE_TCM (window inclusive)', () => {
      const r = proposeIntent(
        input({
          division: 'MEDICAL',
          priorNotes: [note(EncounterIntent.MEDICAL_FOLLOW_UP, 30)],
          patient: medicarePatient({ lastHospitalDischargeAt: daysAgo(14) }),
        }),
      );
      expect(r.intent).toBe(EncounterIntent.MEDICAL_DISCHARGE_TCM);
    });

    it('hospital discharge 15 days ago (past window) → not TCM', () => {
      const r = proposeIntent(
        input({
          division: 'MEDICAL',
          priorNotes: [note(EncounterIntent.MEDICAL_FOLLOW_UP, 30)],
          patient: medicarePatient({ lastHospitalDischargeAt: daysAgo(15) }),
        }),
      );
      expect(r.intent).not.toBe(EncounterIntent.MEDICAL_DISCHARGE_TCM);
    });
  });

  describe('AWV (Annual Wellness Visit)', () => {
    it('Medicare-eligible + never had AWV → MEDICAL_ANNUAL_WELLNESS', () => {
      const r = proposeIntent(
        input({
          division: 'MEDICAL',
          priorNotes: [note(EncounterIntent.MEDICAL_FOLLOW_UP, 30)],
          patient: medicarePatient({ lastAWVAt: null }),
        }),
      );
      expect(r.intent).toBe(EncounterIntent.MEDICAL_ANNUAL_WELLNESS);
      expect(r.reason).toMatch(/first AWV/i);
    });

    it('Medicare-eligible + 11 months since AWV → MEDICAL_ANNUAL_WELLNESS', () => {
      const r = proposeIntent(
        input({
          division: 'MEDICAL',
          priorNotes: [note(EncounterIntent.MEDICAL_ANNUAL_WELLNESS, 335)],
          patient: medicarePatient({ lastAWVAt: daysAgo(335) }),
        }),
      );
      expect(r.intent).toBe(EncounterIntent.MEDICAL_ANNUAL_WELLNESS);
    });

    it('Medicare-eligible + 10 months since AWV → not AWV (under threshold)', () => {
      const r = proposeIntent(
        input({
          division: 'MEDICAL',
          priorNotes: [note(EncounterIntent.MEDICAL_ANNUAL_WELLNESS, 300)],
          patient: medicarePatient({ lastAWVAt: daysAgo(300) }),
        }),
      );
      expect(r.intent).toBe(EncounterIntent.MEDICAL_FOLLOW_UP);
    });

    it('Not Medicare-eligible → AWV branch never fires', () => {
      const r = proposeIntent(
        input({
          division: 'MEDICAL',
          priorNotes: [note(EncounterIntent.MEDICAL_FOLLOW_UP, 400)],
          patient: medicarePatient({ medicareEligible: false, lastAWVAt: null }),
        }),
      );
      expect(r.intent).not.toBe(EncounterIntent.MEDICAL_ANNUAL_WELLNESS);
    });
  });

  it("schedule notes 'urgent' → MEDICAL_ACUTE_VISIT", () => {
    const r = proposeIntent(
      input({
        division: 'MEDICAL',
        priorNotes: [note(EncounterIntent.MEDICAL_FOLLOW_UP, 30)],
        patient: medicarePatient({ medicareEligible: false }),
        schedule: { notes: 'urgent: chest pain x 1 day' },
      }),
    );
    expect(r.intent).toBe(EncounterIntent.MEDICAL_ACUTE_VISIT);
  });

  it("schedule notes 'walk-in' → MEDICAL_ACUTE_VISIT", () => {
    const r = proposeIntent(
      input({
        division: 'MEDICAL',
        priorNotes: [note(EncounterIntent.MEDICAL_FOLLOW_UP, 30)],
        patient: medicarePatient({ medicareEligible: false }),
        schedule: { notes: 'walk-in for rash' },
      }),
    );
    expect(r.intent).toBe(EncounterIntent.MEDICAL_ACUTE_VISIT);
  });

  it('CCM-enrolled (no other signals) → MEDICAL_CHRONIC_CARE', () => {
    const r = proposeIntent(
      input({
        division: 'MEDICAL',
        priorNotes: [note(EncounterIntent.MEDICAL_FOLLOW_UP, 30)],
        patient: medicarePatient({ medicareEligible: false, enrolledInCCM: true }),
      }),
    );
    expect(r.intent).toBe(EncounterIntent.MEDICAL_CHRONIC_CARE);
  });

  it('established patient with nothing special → MEDICAL_FOLLOW_UP', () => {
    const r = proposeIntent(
      input({
        division: 'MEDICAL',
        priorNotes: [note(EncounterIntent.MEDICAL_FOLLOW_UP, 30)],
        patient: medicarePatient({ medicareEligible: false }),
      }),
    );
    expect(r.intent).toBe(EncounterIntent.MEDICAL_FOLLOW_UP);
    expect(r.confidence).toBe('high');
  });
});

// =============================================================================
// MEDICAL precedence — TCM > AWV > ACUTE > CCM > FOLLOW_UP
// (the order matters when multiple signals fire)
// =============================================================================

describe('proposeIntent — MEDICAL precedence', () => {
  it('TCM wins over AWV (recent discharge is higher priority than annual)', () => {
    const r = proposeIntent(
      input({
        division: 'MEDICAL',
        priorNotes: [note(EncounterIntent.MEDICAL_FOLLOW_UP, 30)],
        patient: medicarePatient({
          lastHospitalDischargeAt: daysAgo(5),
          lastAWVAt: daysAgo(400),
        }),
      }),
    );
    expect(r.intent).toBe(EncounterIntent.MEDICAL_DISCHARGE_TCM);
  });

  it('AWV wins over ACUTE schedule cue (preventive trumps acute when both apply)', () => {
    const r = proposeIntent(
      input({
        division: 'MEDICAL',
        priorNotes: [note(EncounterIntent.MEDICAL_FOLLOW_UP, 30)],
        patient: medicarePatient({ lastAWVAt: null }),
        schedule: { notes: 'urgent BP check' },
      }),
    );
    expect(r.intent).toBe(EncounterIntent.MEDICAL_ANNUAL_WELLNESS);
  });

  it('ACUTE wins over CCM (acute symptoms trump chronic touch)', () => {
    const r = proposeIntent(
      input({
        division: 'MEDICAL',
        priorNotes: [note(EncounterIntent.MEDICAL_FOLLOW_UP, 30)],
        patient: medicarePatient({ medicareEligible: false, enrolledInCCM: true }),
        schedule: { notes: 'same-day for back pain' },
      }),
    );
    expect(r.intent).toBe(EncounterIntent.MEDICAL_ACUTE_VISIT);
  });
});

// =============================================================================
// isIntentValidForDivision — used by POST /api/encounters (PR2) for guard
// =============================================================================

describe('isIntentValidForDivision', () => {
  it('REHAB intents valid for REHAB division', () => {
    expect(isIntentValidForDivision(EncounterIntent.REHAB_PROGRESS_NOTE, 'REHAB')).toBe(true);
    expect(isIntentValidForDivision(EncounterIntent.REHAB_INITIAL_EVAL, 'REHAB')).toBe(true);
  });

  it('REHAB intents NOT valid for MEDICAL division', () => {
    expect(isIntentValidForDivision(EncounterIntent.REHAB_PROGRESS_NOTE, 'MEDICAL')).toBe(false);
  });

  it('MEDICAL intents NOT valid for BH division', () => {
    expect(isIntentValidForDivision(EncounterIntent.MEDICAL_FOLLOW_UP, 'BEHAVIORAL_HEALTH')).toBe(false);
  });

  it('BH intents valid for BEHAVIORAL_HEALTH', () => {
    expect(isIntentValidForDivision(EncounterIntent.BH_SESSION_INDIVIDUAL, 'BEHAVIORAL_HEALTH')).toBe(true);
  });

  it('UNSPECIFIED valid for any division (the default null state)', () => {
    expect(isIntentValidForDivision(EncounterIntent.UNSPECIFIED, 'REHAB')).toBe(true);
    expect(isIntentValidForDivision(EncounterIntent.UNSPECIFIED, 'MEDICAL')).toBe(true);
    expect(isIntentValidForDivision(EncounterIntent.UNSPECIFIED, 'BEHAVIORAL_HEALTH')).toBe(true);
    expect(isIntentValidForDivision(EncounterIntent.UNSPECIFIED, 'MULTI')).toBe(true);
  });

  it('MULTI division accepts any intent', () => {
    expect(isIntentValidForDivision(EncounterIntent.REHAB_PROGRESS_NOTE, 'MULTI')).toBe(true);
    expect(isIntentValidForDivision(EncounterIntent.BH_SESSION_GROUP, 'MULTI')).toBe(true);
    expect(isIntentValidForDivision(EncounterIntent.MEDICAL_ANNUAL_WELLNESS, 'MULTI')).toBe(true);
  });
});

// =============================================================================
// Determinism — same input must produce same output (no Date.now() drift
// inside the proposer; all "today" comes from callers)
// =============================================================================

describe('proposeIntent — determinism', () => {
  it('same input produces same output across calls', () => {
    const i = input({
      division: 'REHAB',
      priorNotes: [note(EncounterIntent.REHAB_DAILY_NOTE, 5)],
      episode: rehabEpisode({ visitsCompleted: 5, lastProgressNoteAt: null, visitsSinceLastProgressNote: 5 }),
    });
    const a = proposeIntent(i);
    const b = proposeIntent(i);
    expect(a).toEqual(b);
  });
});
