/**
 * Topic matcher for Watch v2 — Unit 26.
 *
 * Pure substring/token match between live transcript text and the
 * patient's cached EHR row displays. No LLM, no embeddings, no
 * stemming — v1 ships the simplest thing that gets the clinician's
 * eye to the right card during a visit. False positives are
 * acceptable because the raise is non-destructive (highlight only;
 * never dismisses or inserts content).
 *
 * Strategy:
 *   1. Build an index per card at context-load time. Each row's
 *      display string is tokenized, lowercased, filtered for length
 *      ≥ MIN_TOKEN_LEN, and dedup against the STOPWORDS set.
 *   2. On each transcript update, lowercase the incoming text and
 *      check substring presence per token. If any token of a row
 *      appears in the transcript, raise that row.
 *
 * Index built ONCE per context — keeps the per-update path O(rows ×
 * avg-tokens-per-row), tiny in practice (~50 rows × ~3 tokens = 150
 * comparisons). Fine to run on every transcript chunk.
 */

import type { ExternalEhrContext } from '@/lib/fhir/project-ehr-context';

export type Row = { fhirResourceId: string; tokens: string[] };

export type CardIndex = {
  activeConditions: Row[];
  currentMedications: Row[];
  recentObservations: Row[];
  allergies: Row[];
};

export type MatchResult = {
  activeConditions: Set<string>;
  currentMedications: Set<string>;
  recentObservations: Set<string>;
  allergies: Set<string>;
};

const MIN_TOKEN_LEN_ALPHA = 4;
/** Digit-containing tokens are highly specific (a1c, b12, sa02, hba1c)
 *  so we keep them at a lower length threshold. Pure-alpha 3-char
 *  tokens (the, and, etc.) are too noisy. */
const MIN_TOKEN_LEN_ALPHANUM = 3;

// Hardcoded English stopword set covering common words a clinical
// transcript would frequently contain without the row being relevant.
// Intentionally small — anything not on this list survives. Medical
// stopword expansion is a future polish.
const STOPWORDS = new Set([
  'with',
  'from',
  'have',
  'this',
  'that',
  'they',
  'were',
  'been',
  'about',
  'into',
  'patient',
  'today',
  'visit',
  'note',
  'plan',
  'level',
  'value',
  'unit',
  'units',
  'oral',
  'tablet',
  'mg',
  'mcg',
  'after',
  'before',
  'twice',
  'once',
  'daily',
]);

/** Tokenize: lowercased, alphanumeric runs only, filtered for length
 *  and stopwords. Pure numeric tokens (dosages like "500", years like
 *  "2019") dropped — they're noisy and rarely the intended match.
 *  Digit-containing tokens accepted at length ≥ 3 (medical abbreviations
 *  like 'a1c' are short but very specific). */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().matchAll(/[a-z][a-z0-9]*/g)) {
    const tok = raw[0];
    if (!tok) continue;
    const hasDigit = /\d/.test(tok);
    const minLen = hasDigit ? MIN_TOKEN_LEN_ALPHANUM : MIN_TOKEN_LEN_ALPHA;
    if (tok.length < minLen) continue;
    if (STOPWORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

/** Build the per-card index from a projected ExternalEhrContext.
 *  Called once per context (e.g. when the capture page loads). */
export function buildIndex(context: ExternalEhrContext | null): CardIndex {
  if (!context) {
    return { activeConditions: [], currentMedications: [], recentObservations: [], allergies: [] };
  }
  return {
    activeConditions: context.activeConditions.map((c) => ({
      fhirResourceId: c.provenance.fhirResourceId,
      tokens: tokenize(`${c.display} ${c.code ?? ''}`),
    })),
    currentMedications: context.currentMedications.map((m) => ({
      fhirResourceId: m.provenance.fhirResourceId,
      tokens: tokenize(m.display),
    })),
    recentObservations: context.recentObservations.map((o) => ({
      fhirResourceId: o.provenance.fhirResourceId,
      tokens: tokenize(`${o.display} ${o.code ?? ''}`),
    })),
    allergies: context.allergies.map((a) => ({
      fhirResourceId: a.provenance.fhirResourceId,
      tokens: tokenize(a.display),
    })),
  };
}

/** Match a transcript fragment against the index. Returns the set of
 *  fhirResourceIds (per category) whose tokens appear in the transcript.
 *  Caller is responsible for accumulating across multiple updates (the
 *  matcher is stateless per call). */
export function matchTranscript(transcriptText: string, index: CardIndex): MatchResult {
  const lowered = transcriptText.toLowerCase();
  return {
    activeConditions: matchCategory(lowered, index.activeConditions),
    currentMedications: matchCategory(lowered, index.currentMedications),
    recentObservations: matchCategory(lowered, index.recentObservations),
    allergies: matchCategory(lowered, index.allergies),
  };
}

function matchCategory(loweredText: string, rows: Row[]): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    for (const tok of row.tokens) {
      // Word-boundary substring check: token surrounded by non-letter
      // chars (or start/end of text). Prevents "art" matching inside
      // "heart" while still catching plurals + suffixes.
      const pattern = new RegExp(`\\b${escapeRegex(tok)}[a-z]*\\b`);
      if (pattern.test(loweredText)) {
        out.add(row.fhirResourceId);
        break;
      }
    }
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
