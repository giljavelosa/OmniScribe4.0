import { describe, expect, it } from 'vitest';

import {
  buildGreeting,
  buildPersonaSystemBlock,
  COPILOT_DISPLAY_NAME,
  PERSONA_ANTI_DRIFT_BLOCK,
  PERSONA_VERSION,
  RESEARCH_FALLBACK_ADDENDUM,
} from '@/services/copilot/persona';

/**
 * Unit 42 — persona module unit tests.
 *
 * Locks the persona contract: name, version, anti-drift block presence
 * in both modes, and PHI-safety of the greeting templates (no MRN, DOB,
 * last names, ICD codes, free patient data).
 */

describe('persona module — constants', () => {
  it('exports the locked display name + version', () => {
    expect(COPILOT_DISPLAY_NAME).toBe('Miss Cleo');
    expect(PERSONA_VERSION).toBe('miss-cleo-v1');
  });

  it('anti-drift block reminds the model of the source-grounded rule', () => {
    expect(PERSONA_ANTI_DRIFT_BLOCK).toMatch(/source-grounded/i);
    expect(PERSONA_ANTI_DRIFT_BLOCK).toMatch(/never\s+recommend/i);
    expect(PERSONA_ANTI_DRIFT_BLOCK).toMatch(/cite/i);
  });
});

describe('buildPersonaSystemBlock', () => {
  it('chart mode opens with Miss Cleo + chart-flavored language', () => {
    const block = buildPersonaSystemBlock('chart');
    expect(block).toContain('Miss Cleo');
    expect(block.toLowerCase()).toContain('clinical co-pilot');
    expect(block).toContain(PERSONA_ANTI_DRIFT_BLOCK);
  });

  it('research mode opens with Miss Cleo + research-flavored language', () => {
    const block = buildPersonaSystemBlock('research');
    expect(block).toContain('Miss Cleo');
    expect(block.toLowerCase()).toContain('research');
    expect(block).toContain(PERSONA_ANTI_DRIFT_BLOCK);
  });

  it('both modes contain the anti-drift block exactly once', () => {
    for (const mode of ['chart', 'research'] as const) {
      const block = buildPersonaSystemBlock(mode);
      const matches = block.split(PERSONA_ANTI_DRIFT_BLOCK).length - 1;
      expect(matches).toBe(1);
    }
  });

  it('research mode appends the fallback addendum; chart mode does not', () => {
    // The addendum is the prompt-level lever that makes the
    // answer-from-knowledge path fire when the literature corpus is
    // silent (user feedback 2026-05-21). Carries the explicit MUST
    // instruction + the "never explain corpus limitations" rule.
    const research = buildPersonaSystemBlock('research');
    const chart = buildPersonaSystemBlock('chart');
    expect(research).toContain(RESEARCH_FALLBACK_ADDENDUM);
    expect(chart).not.toContain(RESEARCH_FALLBACK_ADDENDUM);
    // Addendum directs the model to USE answer-from-knowledge, not
    // explain why it can't.
    expect(RESEARCH_FALLBACK_ADDENDUM).toMatch(/answer-from-knowledge/);
    expect(RESEARCH_FALLBACK_ADDENDUM).toMatch(/MUST/);
    expect(RESEARCH_FALLBACK_ADDENDUM.toLowerCase()).toMatch(/stub|pending|in development/);
  });
});

describe('buildGreeting — PHI safety + template selection', () => {
  it('research-mode greeting never references a patient (patient-agnostic by design)', () => {
    const greeting = buildGreeting({
      clinicianName: 'Dr. Anita Vasquez DPT',
      patientFirstName: 'Anthony',
      surface: 'review',
      mode: 'research',
    });
    expect(greeting).not.toContain('Anthony');
    expect(greeting).toMatch(/Miss Cleo/);
  });

  it('chart-mode greeting uses clinician first name + patient first name only', () => {
    const greeting = buildGreeting({
      clinicianName: 'Anita Vasquez DPT',
      patientFirstName: 'Anthony',
      surface: 'patient-cockpit',
      mode: 'chart',
    });
    expect(greeting).toContain('Anita');
    expect(greeting).toContain('Anthony');
    expect(greeting).not.toContain('Vasquez');
    expect(greeting).not.toContain('DPT');
  });

  it('strips Dr./Doctor honorific so we greet by first name', () => {
    const greeting = buildGreeting({
      clinicianName: 'Dr. Anita Vasquez',
      patientFirstName: 'Anthony',
      surface: 'prepare',
      mode: 'chart',
    });
    expect(greeting).toContain('Anita');
    expect(greeting).not.toMatch(/Dr\.?\s+Anita/);
  });

  it('falls back to "Hi there" when clinician name is missing', () => {
    const greeting = buildGreeting({
      clinicianName: null,
      patientFirstName: 'Anthony',
      surface: 'review',
      mode: 'chart',
    });
    expect(greeting).toMatch(/Hi there/);
    expect(greeting).toContain('Anthony');
  });

  it('falls back to a patient-agnostic chart greeting when patientFirstName is missing', () => {
    const greeting = buildGreeting({
      clinicianName: 'Anita',
      patientFirstName: null,
      surface: 'patient-cockpit',
      mode: 'chart',
    });
    expect(greeting).toContain('Anita');
    expect(greeting).toMatch(/Miss Cleo/);
  });

  it('per-surface chart copy varies (prepare vs capture vs cockpit)', () => {
    const input = {
      clinicianName: 'Anita',
      patientFirstName: 'Anthony',
      mode: 'chart' as const,
    };
    const prepare = buildGreeting({ ...input, surface: 'prepare' });
    const capture = buildGreeting({ ...input, surface: 'capture' });
    const cockpit = buildGreeting({ ...input, surface: 'patient-cockpit' });
    // Each surface produces a distinct greeting (vs collapsing onto
    // one generic template).
    expect(new Set([prepare, capture, cockpit]).size).toBe(3);
  });

  it('greeting templates never include MRN/DOB/credential tokens', () => {
    const input = {
      clinicianName: 'Anita Vasquez DPT, OCS',
      patientFirstName: 'Anthony',
      mode: 'chart' as const,
    };
    for (const surface of [
      'prepare',
      'capture',
      'review',
      'visit',
      'patient-cockpit',
    ] as const) {
      const g = buildGreeting({ ...input, surface });
      // No DOB-shaped strings.
      expect(g).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      // No MRN-shaped strings.
      expect(g).not.toMatch(/MRN[:\s]+/i);
      // No credentials.
      expect(g).not.toMatch(/\bDPT\b|\bOCS\b|\bMD\b|\bRN\b/);
      // No last name.
      expect(g).not.toContain('Vasquez');
    }
  });
});
