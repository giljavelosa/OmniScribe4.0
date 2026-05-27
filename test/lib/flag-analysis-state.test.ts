import { describe, expect, it } from 'vitest';

import {
  FLAG_ANALYSIS_RUN_CAP,
  computeSectionHashes,
  deriveFlagAnalysisState,
  diffSectionHashes,
  hasEditsSinceLastAnalysis,
  hashSectionContent,
  isFlagAnalysisPending,
  normalizeClaim,
  parseSectionHashes,
  signatureFor,
} from '@/lib/notes/flag-analysis-state';

/**
 * Sprint 0 flag-analysis lockdown — pure helper tests.
 *
 * These helpers are the shared truth for the analyzer worker (decision-
 * memory + diff-skip), the /flags read route (meta payload), and the
 * sign route (edited-since-analysis gate). A bug in any of these
 * helpers compromises all three surfaces — pin them with focused
 * unit tests so regressions surface in CI before they reach a clinical
 * surface.
 */

describe('FLAG_ANALYSIS_RUN_CAP', () => {
  it('is 2 — locked per spec L-3', () => {
    expect(FLAG_ANALYSIS_RUN_CAP).toBe(2);
  });
});

describe('normalizeClaim', () => {
  it('lowercases', () => {
    expect(normalizeClaim('Hello World')).toBe('hello world');
  });

  it('collapses whitespace', () => {
    expect(normalizeClaim('a\t  b\n\nc')).toBe('a b c');
  });

  it('strips punctuation and collapses internal whitespace', () => {
    // Punctuation strips first, then \s+ collapses, so the spaces
    // either side of removed punctuation merge into a single space.
    expect(normalizeClaim('Pt. denies SI, HI; reports + cough.')).toBe(
      'pt denies si hi reports cough',
    );
  });

  it('treats trivially-different wording as the same signature input', () => {
    const a = normalizeClaim('Patient denies neuro symptoms.');
    const b = normalizeClaim('  patient denies neuro symptoms  ');
    expect(a).toBe(b);
  });
});

describe('signatureFor', () => {
  it('is stable across runs with the same inputs', () => {
    const a = signatureFor('subjective', 'Patient denies neuro symptoms.');
    const b = signatureFor('subjective', 'Patient denies neuro symptoms.');
    expect(a).toBe(b);
  });

  it('changes when sectionId changes (signatures are section-scoped)', () => {
    const a = signatureFor('subjective', 'Patient denies neuro symptoms.');
    const b = signatureFor('assessment', 'Patient denies neuro symptoms.');
    expect(a).not.toBe(b);
  });

  it('absorbs LLM re-wording that only differs in case/whitespace/punctuation', () => {
    // The whole point of normalize+sign — model output drift on the
    // same underlying claim must hash to the same value so the
    // carry-forward branch fires.
    const a = signatureFor('subjective', 'Patient denies neuro symptoms.');
    const b = signatureFor('subjective', '  patient denies neuro symptoms  ');
    expect(a).toBe(b);
  });

  it('does NOT absorb deep paraphrases (acceptable per spec — fails open)', () => {
    const a = signatureFor('subjective', 'Patient denies neuro symptoms.');
    const b = signatureFor('subjective', 'No neurological complaints reported.');
    expect(a).not.toBe(b);
  });

  it('returns a 64-char hex string (sha256)', () => {
    const sig = signatureFor('s', 'claim');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashSectionContent', () => {
  it('hashes empty / null / undefined content to a consistent value', () => {
    const empty = hashSectionContent('');
    expect(hashSectionContent(null)).toBe(empty);
    expect(hashSectionContent(undefined)).toBe(empty);
  });

  it('differs across content changes', () => {
    const a = hashSectionContent('Patient reports cough.');
    const b = hashSectionContent('Patient reports cough x 3 days.');
    expect(a).not.toBe(b);
  });
});

describe('computeSectionHashes', () => {
  it('returns one entry per section id', () => {
    const out = computeSectionHashes(
      {
        s1: { content: 'a' },
        s2: { content: 'b' },
      },
      ['s1', 's2'],
    );
    expect(Object.keys(out).sort()).toEqual(['s1', 's2']);
  });

  it('hashes empty for sections not present in the draft', () => {
    const out = computeSectionHashes({ s1: { content: 'x' } }, ['s1', 's2']);
    expect(out.s2).toBe(hashSectionContent(''));
  });

  it('tolerates null/missing draftJson', () => {
    const out = computeSectionHashes(null, ['s1']);
    expect(out.s1).toBe(hashSectionContent(''));
  });
});

describe('parseSectionHashes', () => {
  it('returns null for null / non-object / empty input', () => {
    expect(parseSectionHashes(null)).toBeNull();
    expect(parseSectionHashes(undefined)).toBeNull();
    expect(parseSectionHashes(42)).toBeNull();
    expect(parseSectionHashes('not-an-object')).toBeNull();
    expect(parseSectionHashes([])).toBeNull();
    expect(parseSectionHashes({})).toBeNull();
  });

  it('returns the typed map for a well-formed JSON object', () => {
    const out = parseSectionHashes({ s1: 'abc', s2: 'def' });
    expect(out).toEqual({ s1: 'abc', s2: 'def' });
  });

  it('drops non-string values without throwing', () => {
    const out = parseSectionHashes({ s1: 'abc', s2: 123, s3: null });
    expect(out).toEqual({ s1: 'abc' });
  });
});

describe('diffSectionHashes / hasEditsSinceLastAnalysis', () => {
  it('returns no edits when prior is null (no baseline)', () => {
    const diff = diffSectionHashes(null, { s1: 'a' });
    expect(diff).toEqual({ edited: false, editedSectionIds: [] });
    expect(hasEditsSinceLastAnalysis(null, { s1: 'a' })).toBe(false);
  });

  it('returns no edits when current matches prior exactly', () => {
    const diff = diffSectionHashes({ s1: 'a', s2: 'b' }, { s1: 'a', s2: 'b' });
    expect(diff.edited).toBe(false);
    expect(diff.editedSectionIds).toEqual([]);
  });

  it('flags edits for sections whose hash changed', () => {
    const diff = diffSectionHashes(
      { s1: 'a', s2: 'b' },
      { s1: 'a', s2: 'CHANGED' },
    );
    expect(diff.edited).toBe(true);
    expect(diff.editedSectionIds).toEqual(['s2']);
  });

  it('ignores newly-added sections not present in prior (no edit)', () => {
    const diff = diffSectionHashes({ s1: 'a' }, { s1: 'a', s2: 'b' });
    expect(diff.edited).toBe(false);
  });
});

describe('deriveFlagAnalysisState / isFlagAnalysisPending', () => {
  // Existing helpers — included here so the lockdown additions stay
  // covered alongside their callers in a single test file.
  it('idle when never analyzed', () => {
    expect(
      deriveFlagAnalysisState({
        flagAnalysisStartedAt: null,
        flagAnalysisCompletedAt: null,
      }),
    ).toBe('idle');
  });

  it('pending when started but not completed', () => {
    expect(
      isFlagAnalysisPending({
        flagAnalysisStartedAt: new Date(),
        flagAnalysisCompletedAt: null,
      }),
    ).toBe(true);
  });

  it('completed when completed >= started', () => {
    const t = new Date();
    expect(
      deriveFlagAnalysisState({
        flagAnalysisStartedAt: t,
        flagAnalysisCompletedAt: t,
      }),
    ).toBe('completed');
  });

  it('downgrades stale-pending to completed past the threshold', () => {
    const old = new Date(Date.now() - 11 * 60 * 1000); // > 10 min
    expect(
      deriveFlagAnalysisState({
        flagAnalysisStartedAt: old,
        flagAnalysisCompletedAt: null,
      }),
    ).toBe('completed');
  });
});
