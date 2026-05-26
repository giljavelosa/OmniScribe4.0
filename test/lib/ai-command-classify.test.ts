import { describe, expect, it } from 'vitest';

import {
  classifyAiCommand,
  KNOWN_COMMAND_VERBS,
  type AiCommandPattern,
} from '@/lib/ai-command/classify';

/**
 * Classifier tests — Tier 2 telemetry primitive.
 *
 * Each describe block locks one pattern bucket. We test:
 *   - the happy path (a representative query of that shape)
 *   - the boundary cases (empty input, one char, very long, weird whitespace)
 *   - the PHI-safety contract (commandVerb is always either null OR
 *     a member of `KNOWN_COMMAND_VERBS` — never user-typed text)
 *
 * If a future PR teaches the classifier a new vocabulary verb, it
 * MUST land here as a test row first.
 */

function pattern(query: string): AiCommandPattern {
  return classifyAiCommand(query).pattern;
}

describe('classifyAiCommand — empty / whitespace', () => {
  it('returns "empty" for an empty string', () => {
    expect(classifyAiCommand('')).toEqual({
      pattern: 'empty',
      commandVerb: null,
      queryLength: 0,
      wordCount: 0,
    });
  });

  it('returns "empty" for whitespace only', () => {
    expect(pattern('   \t\n')).toBe('empty');
  });

  it('does not crash on null/undefined-shaped inputs', () => {
    // The classifier coerces nullish to '' rather than throw — the
    // panel's submit handler should never call this with null, but
    // defense in depth.
    expect(pattern(undefined as unknown as string)).toBe('empty');
    expect(pattern(null as unknown as string)).toBe('empty');
  });
});

describe('classifyAiCommand — looks_like_name', () => {
  it.each([
    'Smith',
    'Maria Alvarez',
    'james park',
    'Devon Mitchell',
    'Jean-Luc Picard',
    'OConnor',
    "O'Connor",
    'Robert Hayes Jr', // 3 tokens, still allowed
  ])('classifies "%s" as a name', (q) => {
    expect(pattern(q)).toBe('looks_like_name');
  });

  it('does NOT classify 4+ words as a name (likely a question/command)', () => {
    expect(pattern('Maria Alvarez is the patient')).not.toBe('looks_like_name');
  });

  it('does NOT classify a name when digits are present', () => {
    expect(pattern('Smith123')).not.toBe('looks_like_name');
  });
});

describe('classifyAiCommand — looks_like_command', () => {
  it.each<[string, (typeof KNOWN_COMMAND_VERBS)[number]]>([
    ['drafts', 'drafts'],
    ['show drafts', 'drafts'],
    ['show me my drafts please', 'drafts'],
    ['unfinished notes', 'drafts'],
    ['schedule', 'schedule'],
    ['today', 'schedule'],
    ["today's visits", 'schedule'],
    ["what's today's schedule", 'schedule'],
    ['my appointments', 'schedule'],
    ['follow ups', 'followups'],
    ['followups', 'followups'],
    ['follow-up list', 'followups'],
    ['open follow ups', 'followups'],
    ['unsigned notes', 'unsigned'],
    ['review unsigned visits', 'unsigned'],
    ['notes to sign', 'unsigned'],
    ['start a visit', 'start_visit'],
    ['new encounter', 'start_visit'],
    ['begin a recording', 'start_visit'],
    ['find a patient', 'find_patient'],
    ['search patient', 'find_patient'],
    ['look up a patient', 'find_patient'],
    ['home', 'home'],
    ['go to home', 'home'],
    ['dashboard', 'home'],
    ['my patients', 'patients'],
    ['patient list', 'patients'],
  ])('classifies "%s" as command verb "%s"', (q, expectedVerb) => {
    const result = classifyAiCommand(q);
    expect(result.pattern).toBe('looks_like_command');
    expect(result.commandVerb).toBe(expectedVerb);
  });

  it('returns ONLY canonical verbs in commandVerb (PHI fence)', () => {
    // Throw a varied set at it; assert verb is always either null
    // or a member of the closed enum.
    const inputs = [
      'show drafts',
      'today',
      'banana smoothie',
      'Maria Alvarez',
      '',
      "what's the weather",
      'ACME-1001',
    ];
    for (const q of inputs) {
      const verb = classifyAiCommand(q).commandVerb;
      if (verb !== null) {
        expect(KNOWN_COMMAND_VERBS).toContain(verb);
      }
    }
  });
});

describe('classifyAiCommand — looks_like_question', () => {
  it.each([
    'What is the protocol for diabetic foot pain?',
    'how do I sign a note',
    'when did Maria last come in',
    'should I add an addendum',
  ])('classifies "%s" as a question', (q) => {
    expect(pattern(q)).toBe('looks_like_question');
  });

  it('a one-word question with `?` still classifies as question', () => {
    expect(pattern('really?')).toBe('looks_like_question');
  });

  it('command verbs WIN over question shape (e.g. "what\'s on my schedule" → command:schedule)', () => {
    // Hierarchy by design: command > question > MRN > name > other.
    // A question ABOUT the schedule and a command "schedule" both
    // resolve to the same intent, so the dashboard groups them
    // under one verb. This is intentional — the classifier doc
    // says first-match-wins on commands.
    const result = classifyAiCommand("what's on my schedule for the afternoon");
    expect(result.pattern).toBe('looks_like_command');
    expect(result.commandVerb).toBe('schedule');
  });
});

describe('classifyAiCommand — mrn_pattern', () => {
  it.each([
    '123456',
    '1234567890',
    'ACME-1001',
    'MRN-1234',
    'a-1234',
  ])('classifies "%s" as an MRN', (q) => {
    expect(pattern(q)).toBe('mrn_pattern');
  });

  it('rejects MRN shape when too short', () => {
    expect(pattern('123')).not.toBe('mrn_pattern');
  });

  it('rejects MRN shape when multi-word', () => {
    expect(pattern('MRN 1234')).not.toBe('mrn_pattern');
  });
});

describe('classifyAiCommand — other (the design-space bucket)', () => {
  it.each([
    'aksdjfhkajsdhf',
    '!!!!!!!',
    'Smith and also Jones',
    "I just spilled my coffee on the keyboard",
  ])('falls back to "other" for "%s"', (q) => {
    expect(pattern(q)).toBe('other');
  });
});

describe('classifyAiCommand — counts are PHI-safe aggregates', () => {
  it('queryLength reflects the trimmed length, not raw input', () => {
    expect(classifyAiCommand('  drafts  ').queryLength).toBe('drafts'.length);
  });

  it('wordCount counts whitespace-separated tokens after trim', () => {
    expect(classifyAiCommand('Maria   Alvarez').wordCount).toBe(2);
    expect(classifyAiCommand('').wordCount).toBe(0);
  });
});
