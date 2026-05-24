/**
 * Unit 48 PR3 — IntentAwareBriefGenerator unit tests.
 *
 * Coverage:
 *   - SUPPORTED_INTENT_PAIRS predicate (PR3 ships exactly one pair)
 *   - selectSpine resolves to REHAB_PROGRESS_SPINE for the supported pair
 *   - throws for unsupported pairs (defensive — dispatcher should pre-filter)
 *   - stub-mode envelope → synthesizes valid RehabProgressBriefShape
 *   - sonnet output → validates against RehabProgressBriefShapeSchema
 *   - falls back to Haiku on schema failure
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EncounterIntent } from '@prisma/client';

import {
  IntentAwareBriefGenerator,
  INTENT_AWARE_BRIEF_GENERATOR_VERSION,
  INTENT_AWARE_BRIEF_GENERATOR_FALLBACK_VERSION,
  SUPPORTED_INTENT_PAIRS,
  isIntentAwarePairSupported,
} from '@/services/brief/IntentAwareBriefGenerator';
import type { LLMService } from '@/services/llm';
import type { BuildBriefPromptInput } from '@/lib/notes/build-brief-prompt';

// =============================================================================
// Helpers — small mock LLMService factory; minimal valid input fixture.
// =============================================================================

function mockLLM(behaviors: Array<() => { text: string; stub?: boolean }>): LLMService {
  let call = 0;
  return {
    generate: vi.fn(async () => {
      const next = behaviors[call] ?? behaviors[behaviors.length - 1]!;
      call += 1;
      return next();
    }),
    // The full LLMService has more methods; cast through `unknown` to
    // satisfy the type without implementing the unused surface.
  } as unknown as LLMService;
}

function input(): BuildBriefPromptInput {
  return {
    division: 'REHAB',
    todayIso: '2026-05-26T12:00:00.000Z',
    patient: {
      id: 'pt_test',
      displayAge: 68,
      sex: 'F',
      displayName: 'Maria G.',
      preferredLanguage: 'English',
      mrn: 'MRN-001',
    },
    episode: {
      id: 'ep_test',
      label: 'R shoulder pain',
      diagnosis: 'R shoulder pain',
      bodyPart: 'R shoulder',
      visitsAuthorized: 12,
      visitsCompleted: 10,
      status: 'ACTIVE',
    },
    priorNotes: [
      {
        noteId: 'nt_prior_001',
        signedAtIso: '2026-04-22T10:00:00.000Z',
        noteType: 'progress',
        templateName: 'PT Progress',
        clinicianName: 'Dr. Smith',
        division: 'REHAB',
        finalJson: {
          sections: [
            {
              id: 'subjective',
              label: 'Subjective',
              content: 'Reports pain at 4/10.',
              required: true,
            },
          ],
          signedAt: '2026-04-22T10:00:00.000Z',
          schemaVersion: 1,
        },
      },
    ],
    topActiveGoals: [
      {
        id: 'g1',
        goalText: 'AROM flex to 150°',
        goalType: 'LTG',
        status: 'ACTIVE',
      },
    ],
    externalEhrContext: null,
    externalContexts: [],
  };
}

const validSonnetOutput = {
  patientOneLine: '68F, R shoulder',
  episodeContext: {
    episodeId: 'ep_test',
    label: 'R shoulder pain',
    visitNumber: 10,
    plannedVisits: 12,
  },
  lastVisit: {
    noteId: 'nt_prior_001',
    date: '2026-04-22',
    daysAgo: 34,
    clinicianName: 'Dr. Smith',
    noteType: 'progress',
    templateName: 'PT Progress',
  },
  chiefConcern: 'R shoulder pain post-fall.',
  priorAssessment: 'Improving slowly.',
  trajectory: { summary: 'Pain ↓, ROM ↑', direction: 'improving' as const },
  objectiveMeasures: [],
  interventionsPerformed: ['Manual GH joint mob'],
  homeProgram: 'Band rows 3×10',
  educationGiven: [],
  carryForwardPlan: ['Progress to red bands'],
  topActiveGoals: [
    {
      text: 'AROM flex to 150°',
      status: 'active' as const,
      delta: null,
      originNoteId: 'nt_prior_001',
    },
  ],
  watch: {
    recentMedChanges: [],
    recentResults: [],
    precautions: [],
    redFlagsFromPriorNote: [],
  },
  sourceNoteIds: ['nt_prior_001'],
  goalLedger: [
    {
      goalText: 'AROM flex to 150°',
      goalType: 'LTG' as const,
      status: 'ACTIVE' as const,
      delta: 'flex 95° → 125°',
      sourceNoteId: 'nt_prior_001',
    },
  ],
  medicalNecessity: {
    remainingLimitations: 'Unable to reach overhead with R UE.',
    whySkilledCare: 'Joint mobilization requires skilled hand placement.',
    pocJustification: 'On track for 4 more weeks per trajectory.',
  },
};

// =============================================================================
// 1. Pair support — what PR3 ships
// =============================================================================

describe('SUPPORTED_INTENT_PAIRS', () => {
  it('contains exactly one pair in PR3 (REHAB:REHAB_PROGRESS_NOTE)', () => {
    expect(SUPPORTED_INTENT_PAIRS.size).toBe(1);
    expect(
      SUPPORTED_INTENT_PAIRS.has(`REHAB:${EncounterIntent.REHAB_PROGRESS_NOTE}`),
    ).toBe(true);
  });
});

describe('isIntentAwarePairSupported', () => {
  it('returns true for REHAB + REHAB_PROGRESS_NOTE', () => {
    expect(
      isIntentAwarePairSupported('REHAB', EncounterIntent.REHAB_PROGRESS_NOTE),
    ).toBe(true);
  });

  it('returns false for UNSPECIFIED regardless of division', () => {
    expect(isIntentAwarePairSupported('REHAB', EncounterIntent.UNSPECIFIED)).toBe(false);
    expect(isIntentAwarePairSupported('MEDICAL', EncounterIntent.UNSPECIFIED)).toBe(false);
    expect(
      isIntentAwarePairSupported('BEHAVIORAL_HEALTH', EncounterIntent.UNSPECIFIED),
    ).toBe(false);
  });

  it('returns false for intents not yet shipped with spine modules', () => {
    expect(isIntentAwarePairSupported('REHAB', EncounterIntent.REHAB_DAILY_NOTE)).toBe(false);
    expect(isIntentAwarePairSupported('REHAB', EncounterIntent.REHAB_REEVAL)).toBe(false);
  });

  it('returns false for cross-division pairs', () => {
    expect(
      isIntentAwarePairSupported('MEDICAL', EncounterIntent.REHAB_PROGRESS_NOTE),
    ).toBe(false);
  });
});

// =============================================================================
// 2. Generator behavior — sonnet, fallback, stub mode
// =============================================================================

describe('IntentAwareBriefGenerator.generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a valid spine output on first Sonnet attempt', async () => {
    const llm = mockLLM([
      () => ({ text: JSON.stringify(validSonnetOutput) }),
    ]);
    const g = new IntentAwareBriefGenerator(llm);
    const result = await g.generate(input(), EncounterIntent.REHAB_PROGRESS_NOTE);
    expect(result.generatorVersion).toBe(INTENT_AWARE_BRIEF_GENERATOR_VERSION);
    expect(result.model).toBe('sonnet');
    expect(result.attempts).toBe(1);
    expect(result.brief.intent).toBe(EncounterIntent.REHAB_PROGRESS_NOTE);
    expect(result.brief.goalLedger).toHaveLength(1);
    expect(result.brief.medicalNecessity.remainingLimitations).toContain(
      'Unable to reach overhead',
    );
  });

  it('tolerates markdown JSON fences from the model', async () => {
    const fenced = `\`\`\`json\n${JSON.stringify(validSonnetOutput)}\n\`\`\``;
    const llm = mockLLM([() => ({ text: fenced })]);
    const g = new IntentAwareBriefGenerator(llm);
    const result = await g.generate(input(), EncounterIntent.REHAB_PROGRESS_NOTE);
    expect(result.brief.goalLedger).toHaveLength(1);
  });

  it('re-prompts Sonnet on first schema failure', async () => {
    const llm = mockLLM([
      () => ({ text: JSON.stringify({ broken: true }) }),
      () => ({ text: JSON.stringify(validSonnetOutput) }),
    ]);
    const g = new IntentAwareBriefGenerator(llm);
    const result = await g.generate(input(), EncounterIntent.REHAB_PROGRESS_NOTE);
    expect(result.model).toBe('sonnet');
    expect(result.attempts).toBe(2);
  });

  it('falls back to Haiku after two Sonnet schema failures', async () => {
    const llm = mockLLM([
      () => ({ text: JSON.stringify({ broken: true }) }),
      () => ({ text: JSON.stringify({ still: 'broken' }) }),
      () => ({ text: JSON.stringify(validSonnetOutput) }),
    ]);
    const g = new IntentAwareBriefGenerator(llm);
    const result = await g.generate(input(), EncounterIntent.REHAB_PROGRESS_NOTE);
    expect(result.model).toBe('haiku');
    expect(result.attempts).toBe(3);
    expect(result.generatorVersion).toBe(INTENT_AWARE_BRIEF_GENERATOR_FALLBACK_VERSION);
  });

  it('throws when both Sonnet attempts AND Haiku fail validation', async () => {
    const llm = mockLLM([
      () => ({ text: JSON.stringify({ broken: 1 }) }),
      () => ({ text: JSON.stringify({ broken: 2 }) }),
      () => ({ text: JSON.stringify({ broken: 3 }) }),
    ]);
    const g = new IntentAwareBriefGenerator(llm);
    await expect(
      g.generate(input(), EncounterIntent.REHAB_PROGRESS_NOTE),
    ).rejects.toThrow(/produced invalid output/);
  });

  it('synthesizes a valid stub spine when LLM service returns stub envelope', async () => {
    const llm = mockLLM([
      () => ({ text: JSON.stringify({ stub: true, text: 'no bedrock' }), stub: true }),
    ]);
    const g = new IntentAwareBriefGenerator(llm);
    const result = await g.generate(input(), EncounterIntent.REHAB_PROGRESS_NOTE);
    expect(result.stub).toBe(true);
    expect(result.brief.intent).toBe(EncounterIntent.REHAB_PROGRESS_NOTE);
    // Stub synthesizer derives goalLedger from topActiveGoals.
    expect(result.brief.goalLedger).toHaveLength(1);
    expect(result.brief.goalLedger[0]!.goalText).toBe('AROM flex to 150°');
    // Stub synthesizer fills medical-necessity with [stub …] placeholders.
    expect(result.brief.medicalNecessity.remainingLimitations).toContain('[stub');
  });

  it('throws (defense) when called with an unsupported (division, intent) pair', async () => {
    const llm = mockLLM([() => ({ text: JSON.stringify(validSonnetOutput) })]);
    const g = new IntentAwareBriefGenerator(llm);
    await expect(
      g.generate(input(), EncounterIntent.REHAB_DAILY_NOTE),
    ).rejects.toThrow(/unsupported \(division, intent\) pair/);
  });
});
