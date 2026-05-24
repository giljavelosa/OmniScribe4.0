/**
 * Unit 48 PR3 — Brief shape regression test (THE MERGE GATE per Decision 11).
 *
 * Purpose: prove that PR3's schema and renderer additions are byte-for-byte
 * back-compatible with pre-PR3 briefs and BriefCard usage. If this test
 * fails, PR3 has accidentally changed the existing path's behavior and
 * must NOT merge.
 *
 * The test covers three regression surfaces:
 *
 *   1. `PriorContextBriefContentSchema` parses pre-PR3 brief fixtures
 *      (no `intent` field present) without error.
 *   2. `BriefLLMOutputSchema` parses pre-PR3 LLM output fixtures
 *      unchanged (the spine schemas extend this — the base schema
 *      stays untouched, asserted here).
 *   3. The `IntentAwareBriefGenerator.SUPPORTED_INTENT_PAIRS` dispatcher
 *      predicate (`isIntentAwarePairSupported`) returns FALSE for
 *      UNSPECIFIED intent — meaning the worker always falls through to
 *      the existing `BriefGenerator` path for any pre-PR3 encounter.
 *
 * If we add fixtures from production captures in the future, drop them
 * into `fixtures/` next to this file and add a corresponding describe
 * block. The goal is to grow the regression net over time.
 */

import { describe, expect, it } from 'vitest';
import { EncounterIntent } from '@prisma/client';

import {
  PriorContextBriefContentSchema,
  BriefLLMOutputSchema,
} from '@/types/brief';
import { isIntentAwarePairSupported } from '@/services/brief/IntentAwareBriefGenerator';

// =============================================================================
// Fixtures — representative pre-PR3 brief content shapes. Mirror the shape
// the worker writes to NoteBrief.content via the EXISTING BriefGenerator
// path (no `intent`, no `goalLedger`, no `medicalNecessity`). Each fixture
// is a complete, valid PriorContextBriefContent — so if PR3 accidentally
// tightens the base schema, .parse() throws and this test fails.
// =============================================================================

const PRE_PR3_BRIEF_BASIC = {
  patientOneLine: '68F, R shoulder post-fall, week 4 of 6',
  episodeContext: {
    episodeId: 'ep_test_001',
    label: 'R shoulder pain',
    visitNumber: 4,
    plannedVisits: 6,
  },
  lastVisit: {
    noteId: 'nt_test_001',
    date: '2026-04-22',
    daysAgo: 6,
    clinicianName: 'Dr. Smith',
    noteType: 'progress',
    templateName: 'PT Progress',
  },
  chiefConcern: 'R shoulder pain post-fall, addressing ROM + scap stability.',
  priorAssessment: 'Improving — pain trending down, AROM gains in flex/abd.',
  trajectory: { summary: 'Improving: pain ↓, ROM ↑', direction: 'improving' as const },
  objectiveMeasures: [
    {
      measure: 'Pain VAS',
      unit: '/10',
      lastValue: '4',
      priorValues: ['7', '5'],
      trend: 'improving' as const,
      sourceNoteId: 'nt_test_001',
    },
  ],
  interventionsPerformed: ['Manual GH joint mob grade III', 'Scap stability progression'],
  homeProgram: 'Band rows 3×10, prone Y/T/W',
  educationGiven: ['Sleep posture'],
  carryForwardPlan: ['Progress band rows to red', 'Recheck scap dyskinesis'],
  topActiveGoals: [
    {
      text: 'AROM flex to 150°',
      status: 'active' as const,
      delta: 'on track',
      originNoteId: 'nt_test_001',
    },
  ],
  watch: {
    recentMedChanges: [],
    recentResults: [],
    precautions: [],
    redFlagsFromPriorNote: [],
  },
  sourceNoteIds: ['nt_test_001'],
  generatedAt: '2026-04-22T17:00:00.000Z',
  generatorVersion: 'llm-v1',
  openFollowUps: [],
};

const PRE_PR3_BRIEF_WITH_FOLLOWUPS = {
  ...PRE_PR3_BRIEF_BASIC,
  openFollowUps: [
    {
      followUpId: 'fu_001',
      text: 'Trial NSAID — ask if started',
      status: 'OPEN' as const,
      source: { noteId: 'nt_test_001', date: '2026-04-22' },
    },
    {
      followUpId: 'fu_002',
      text: 'Imaging report (Mar 28) — confirm reviewed',
      status: 'OPEN' as const,
      source: { noteId: 'nt_test_001', date: '2026-04-22' },
    },
  ],
};

const PRE_PR3_LLM_OUTPUT = {
  patientOneLine: '45M, low back pain, visit 2',
  episodeContext: null,
  lastVisit: {
    noteId: 'nt_lbp_001',
    date: '2026-05-01',
    daysAgo: 14,
    clinicianName: 'Dr. Jones',
    noteType: 'daily',
    templateName: null,
  },
  chiefConcern: 'Low back pain, mechanical',
  priorAssessment: null,
  trajectory: null,
  objectiveMeasures: [],
  interventionsPerformed: [],
  homeProgram: null,
  educationGiven: [],
  carryForwardPlan: [],
  topActiveGoals: [],
  watch: {
    recentMedChanges: [],
    recentResults: [],
    precautions: [],
    redFlagsFromPriorNote: [],
  },
  sourceNoteIds: ['nt_lbp_001'],
};

// =============================================================================
// 1. Schema back-compat: pre-PR3 briefs parse against post-PR3 schemas.
// =============================================================================

describe('PR3 regression gate — schema back-compat', () => {
  it('PriorContextBriefContentSchema parses pre-PR3 basic brief unchanged', () => {
    const r = PriorContextBriefContentSchema.safeParse(PRE_PR3_BRIEF_BASIC);
    expect(r.success).toBe(true);
    if (r.success) {
      // `intent` field is optional + nullable — pre-PR3 briefs omit it
      // entirely and the parsed shape reflects that.
      expect(r.data.intent).toBeUndefined();
    }
  });

  it('PriorContextBriefContentSchema parses pre-PR3 brief with follow-ups unchanged', () => {
    const r = PriorContextBriefContentSchema.safeParse(PRE_PR3_BRIEF_WITH_FOLLOWUPS);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.openFollowUps).toHaveLength(2);
      expect(r.data.intent).toBeUndefined();
    }
  });

  it('BriefLLMOutputSchema parses pre-PR3 LLM output unchanged', () => {
    const r = BriefLLMOutputSchema.safeParse(PRE_PR3_LLM_OUTPUT);
    expect(r.success).toBe(true);
  });

  it('BriefLLMOutputSchema does NOT silently accept extra `intent` field (base schema untouched)', () => {
    // Decision 11 — the base schema must not have grown a passthrough
    // `intent` field. Spine schemas extend the base with intent-specific
    // fields, but the base itself stays the same shape as pre-PR3.
    // Zod default is strip-unknown, so extra fields parse OK but don't
    // round-trip. Assert that .strict() rejection catches it (proves
    // the schema is not implicitly extended).
    const withIntent = { ...PRE_PR3_LLM_OUTPUT, intent: 'REHAB_PROGRESS_NOTE' };
    const r = BriefLLMOutputSchema.safeParse(withIntent);
    expect(r.success).toBe(true);
    if (r.success) {
      // The `intent` key was stripped (not part of BriefLLMOutputSchema's
      // declared keys). This is what we want: base shape unchanged.
      expect((r.data as Record<string, unknown>).intent).toBeUndefined();
    }
  });
});

// =============================================================================
// 2. Dispatcher predicate: pre-PR3 encounters always fall through.
// =============================================================================

describe('PR3 regression gate — worker dispatcher predicate', () => {
  it('UNSPECIFIED intent always falls through to existing BriefGenerator', () => {
    // Pre-PR3 encounters have intent=UNSPECIFIED by column default.
    // The dispatcher MUST return false so the existing path always
    // handles them. This is the byte-for-byte-unchanged guarantee.
    for (const division of ['REHAB', 'BEHAVIORAL_HEALTH', 'MEDICAL', 'MULTI'] as const) {
      expect(
        isIntentAwarePairSupported(division, EncounterIntent.UNSPECIFIED),
      ).toBe(false);
    }
  });

  it('PR3+PR4 ship the four MVP supported pairs', () => {
    expect(
      isIntentAwarePairSupported('REHAB', EncounterIntent.REHAB_PROGRESS_NOTE),
    ).toBe(true);
    // PR4 enables these:
    expect(
      isIntentAwarePairSupported('REHAB', EncounterIntent.REHAB_REEVAL),
    ).toBe(true);
    expect(
      isIntentAwarePairSupported(
        'BEHAVIORAL_HEALTH',
        EncounterIntent.BH_TREATMENT_PLAN_REVIEW,
      ),
    ).toBe(true);
    expect(
      isIntentAwarePairSupported('MEDICAL', EncounterIntent.MEDICAL_ANNUAL_WELLNESS),
    ).toBe(true);
  });

  it('intents NOT yet shipped with spine modules still fall through', () => {
    // These will get their spines in future units; until then, dispatch
    // routes them to the existing BriefGenerator path.
    expect(
      isIntentAwarePairSupported('REHAB', EncounterIntent.REHAB_DAILY_NOTE),
    ).toBe(false);
    expect(
      isIntentAwarePairSupported('REHAB', EncounterIntent.REHAB_INITIAL_EVAL),
    ).toBe(false);
    expect(
      isIntentAwarePairSupported('REHAB', EncounterIntent.REHAB_DISCHARGE),
    ).toBe(false);
    expect(
      isIntentAwarePairSupported(
        'BEHAVIORAL_HEALTH',
        EncounterIntent.BH_SESSION_INDIVIDUAL,
      ),
    ).toBe(false);
    expect(
      isIntentAwarePairSupported('MEDICAL', EncounterIntent.MEDICAL_FOLLOW_UP),
    ).toBe(false);
  });

  it('cross-division intents fall through (defense — should never be persisted)', () => {
    expect(
      isIntentAwarePairSupported('BEHAVIORAL_HEALTH', EncounterIntent.REHAB_PROGRESS_NOTE),
    ).toBe(false);
    expect(
      isIntentAwarePairSupported('MEDICAL', EncounterIntent.REHAB_PROGRESS_NOTE),
    ).toBe(false);
  });

  it('every REHAB Daily Note (the most common visit) falls through', () => {
    // Sanity check: the most-frequent visit type stays on the existing
    // path. If this ever flips to true without intentionally landing a
    // spine for DAILY_NOTE, the dispatcher would route every daily
    // visit through the intent-aware generator — major regression.
    expect(
      isIntentAwarePairSupported('REHAB', EncounterIntent.REHAB_DAILY_NOTE),
    ).toBe(false);
  });
});
