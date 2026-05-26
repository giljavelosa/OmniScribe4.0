/**
 * AI command classifier — Tier 2 telemetry primitive.
 *
 * Background
 * ----------
 * The home `<AiCommandPanel>` is a Wave-8 stub: it routes every query
 * straight to `/patients?query=…`. We have no idea whether clinicians
 * are typing patient names, draft commands, schedule questions, or
 * random keystrokes. Tier 2's whole reason for existing is to find
 * out — so the next tier (deterministic command vocabulary) can be
 * designed from real data, not guesses.
 *
 * What this file is
 * -----------------
 * A pure function that classifies the SHAPE of a query without
 * persisting the words themselves. It's the PHI guard at the entry
 * point: the API route that receives queries calls this, audits the
 * shape, and throws away the raw text. The classifier itself is
 * defensive — even if a caller forgets to scrub, this never returns
 * the input string in any field.
 *
 * Output is structural only:
 *   - `pattern`      — one of six enum values (no free text)
 *   - `commandVerb`  — for known-vocabulary commands, the CANONICAL
 *                      verb (e.g. "drafts" / "schedule"). Null
 *                      otherwise. Verbs are a closed enum — the
 *                      classifier never returns user-typed words.
 *   - `queryLength`  — character count of the trimmed query
 *   - `wordCount`    — whitespace-separated word count
 *
 * Anti-regression
 * ---------------
 * - The classifier has ZERO dependencies on Prisma, the DB, or any
 *   network IO. Cheap to run on every keystroke if we ever want to
 *   live-classify in the UI.
 * - All branches are tested. If you add a new pattern, add a test.
 * - The PHI fence is the closed `commandVerb` enum: only strings
 *   from `KNOWN_COMMAND_VERBS` can ever land in audit metadata.
 */

/** PHI-free shape labels. Closed enum — never extend without
 *  updating the admin dashboard's column legend too. */
export type AiCommandPattern =
  | 'empty'
  | 'looks_like_name'
  | 'looks_like_command'
  | 'looks_like_question'
  | 'mrn_pattern'
  | 'other';

/** Closed enum of canonical command verbs. The classifier ONLY
 *  returns strings from this set as `commandVerb`. No user-typed
 *  text ever leaks through this field. */
export const KNOWN_COMMAND_VERBS = [
  'drafts',
  'schedule',
  'followups',
  'unsigned',
  'start_visit',
  'find_patient',
  'home',
  'patients',
] as const;

export type KnownCommandVerb = (typeof KNOWN_COMMAND_VERBS)[number];

export interface ClassificationResult {
  pattern: AiCommandPattern;
  /** Canonical command verb when pattern === 'looks_like_command'.
   *  Null otherwise. ALWAYS one of `KNOWN_COMMAND_VERBS` — never a
   *  user-typed word. */
  commandVerb: KnownCommandVerb | null;
  /** Character count of the trimmed query. PHI-free aggregate. */
  queryLength: number;
  /** Whitespace-separated word count of the trimmed query. */
  wordCount: number;
}

/**
 * Pattern → set of regex matchers. Each matcher is anchored loosely
 * (the user might type "show me my drafts pls" and we still want
 * `drafts`). Order in `KNOWN_COMMAND_VERBS` is the priority — first
 * match wins, so put more-specific verbs first if there's overlap.
 *
 * NOTE: matchers are tested as case-insensitive `RegExp.test` against
 * the trimmed query. They do NOT capture; we only care that ONE of
 * the verb's signals fired.
 */
const COMMAND_MATCHERS: Record<KnownCommandVerb, readonly RegExp[]> = {
  drafts: [/\bdrafts?\b/i, /\bunfinished\b/i, /\bin[-\s]?progress\b/i],
  schedule: [
    /\bschedule\b/i,
    /\btoday'?s?\b/i,
    /\bvisits?\s+today\b/i,
    /\btoday'?s?\s+(visits?|patients?|schedule)\b/i,
    /\bappointments?\b/i,
  ],
  followups: [
    /\bfollow[-\s]?ups?\b/i,
    /\boutstanding\s+follow/i,
    /\bopen\s+follow/i,
  ],
  unsigned: [
    /\bunsigned\s+(notes?|visits?)\b/i,
    /\breview\s+unsigned\b/i,
    /\bnotes?\s+to\s+sign\b/i,
  ],
  start_visit: [
    /\bstart\s+(a\s+)?(visit|encounter|note|recording|session)\b/i,
    /\bnew\s+(visit|encounter|note|recording|session)\b/i,
    /\bbegin\s+(a\s+)?(visit|encounter|note|recording|session)\b/i,
  ],
  find_patient: [
    /\bfind\s+(a\s+)?patient\b/i,
    /\bsearch\s+(for\s+)?(a\s+)?patient\b/i,
    /\bpatient\s+search\b/i,
    /\blook\s+up\s+(a\s+)?patient\b/i,
  ],
  home: [/\b(go\s+to\s+)?home\s*(screen|page)?\b/i, /\bdashboard\b/i],
  patients: [
    /\b(all\s+)?(my\s+)?patients?\s*(list)?\b/i,
    /\bpatient\s+list\b/i,
    /\bview\s+patients\b/i,
  ],
};

/**
 * MRN heuristic: 6–12 characters, mostly digits, may include hyphens
 * or one alpha prefix. We deliberately keep this loose — an org may
 * use "ACME-1001" or "MRN-1234" or pure digits. The point is to
 * recognize a SHAPE, not validate a real MRN. Pure digits ≥ 6 chars
 * also count.
 */
const MRN_REGEX = /^[A-Z]{0,4}-?\d{4,10}$/i;

/**
 * Loose name heuristic: 1–3 alphabetic tokens, optionally separated
 * by hyphens or spaces, no digits. Matches "Smith", "Maria Alvarez",
 * "Smith-Jones", "Jean-Luc Picard". Lowercase is still acceptable
 * (`alvarez`) — clinicians type carelessly — but the AGGREGATE
 * shape is "letters only, ≤ 3 words".
 */
const NAME_REGEX = /^[A-Za-z][A-Za-z'\-]*(\s[A-Za-z][A-Za-z'\-]*){0,2}$/;

/**
 * Anti-gibberish guard. Real names have vowels and don't have long
 * consonant runs; "aksdjfhkajsdhf" does. Five+ consonants in a row
 * is the gibberish tell. ("Skrrtl" exists in the world but is
 * vanishingly rare in clinic; the false-negative cost is trivial
 * compared to the false-positive cost of bucketing keystroke spam
 * as a name search.)
 */
const GIBBERISH_RE = /[bcdfghjklmnpqrstvwxz]{5,}/i;
const VOWEL_RE = /[aeiouy]/i;

/**
 * Question shape: ends with `?`, OR starts with one of the
 * interrogative words. Errs on the side of recognizing questions
 * because "what's on my schedule" is a legitimate use we want to see
 * in the dashboard.
 */
const QUESTION_LEADERS = new Set([
  'what',
  'whats',
  "what's",
  'how',
  'why',
  'when',
  'where',
  'who',
  'which',
  'can',
  'should',
  'do',
  'does',
  'is',
  'are',
]);

/**
 * Classify a free-text query. Returns a structural label + bounded
 * counts. NEVER returns user-typed substrings.
 */
export function classifyAiCommand(rawQuery: string): ClassificationResult {
  const trimmed = (rawQuery ?? '').trim();
  const queryLength = trimmed.length;
  const wordCount = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;

  if (queryLength === 0) {
    return { pattern: 'empty', commandVerb: null, queryLength, wordCount };
  }

  // 1. Known commands first — they may use words that ALSO look like
  //    a question ("show me my drafts" — leading "show" isn't a
  //    question leader, but "what's pending?" might be both). The
  //    verb is more specific so it wins.
  const verb = matchCommandVerb(trimmed);
  if (verb) {
    return {
      pattern: 'looks_like_command',
      commandVerb: verb,
      queryLength,
      wordCount,
    };
  }

  // 2. Question shape — `?` suffix or interrogative leader.
  if (looksLikeQuestion(trimmed)) {
    return { pattern: 'looks_like_question', commandVerb: null, queryLength, wordCount };
  }

  // 3. MRN — narrow shape, single token, alphanumeric/dash only.
  //    Single-token only; multi-word strings can't be an MRN by
  //    definition.
  if (wordCount === 1 && MRN_REGEX.test(trimmed)) {
    return { pattern: 'mrn_pattern', commandVerb: null, queryLength, wordCount };
  }

  // 4. Name — letters-only, ≤ 3 words, with a real-name "vibe":
  //    contains at least one vowel and no 5-consonant runs (which
  //    look like keystroke spam rather than typed names).
  if (
    wordCount <= 3 &&
    NAME_REGEX.test(trimmed) &&
    VOWEL_RE.test(trimmed) &&
    !GIBBERISH_RE.test(trimmed)
  ) {
    return { pattern: 'looks_like_name', commandVerb: null, queryLength, wordCount };
  }

  // 5. Fallback bucket — anything that didn't match. The dashboard
  //    treats `other` as the "design space" — high `other` rates are
  //    a signal we're missing a vocabulary cluster.
  return { pattern: 'other', commandVerb: null, queryLength, wordCount };
}

function matchCommandVerb(query: string): KnownCommandVerb | null {
  for (const verb of KNOWN_COMMAND_VERBS) {
    const matchers = COMMAND_MATCHERS[verb];
    for (const re of matchers) {
      if (re.test(query)) return verb;
    }
  }
  return null;
}

function looksLikeQuestion(query: string): boolean {
  if (query.endsWith('?')) return true;
  const firstWord = query.split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  // Strip trailing punctuation so "what's" / "how?" still match.
  const cleaned = firstWord.replace(/[?.!,;:]$/, '');
  return QUESTION_LEADERS.has(cleaned);
}
