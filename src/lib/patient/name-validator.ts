/**
 * Person-name validator — Polish (post-Wave 6).
 *
 * Rejects obvious bad input (control characters, backslashes,
 * angle brackets, common injection markers) while permitting the full
 * range of real person names: letters from any script, diacritics,
 * spaces, hyphens, apostrophes, periods.
 *
 * Discovered during local smoke testing 2026-05-18 when a typo
 * produced "G\il" in the DB — server + client were both clean, the
 * literal backslash came from user input. This validator is defense-
 * in-depth so a future typo (or a copy-paste from a malformed source)
 * doesn't reach the DB.
 *
 * NOT a fuzzy match — the intent is to refuse characters that
 * shouldn't be in a name AT ALL. Names with apostrophes (O'Brien),
 * hyphens (Jean-Pierre), periods (St. John), or unicode letters
 * (José, 田中) all pass.
 */

const DISALLOWED = /[\\<>{}\[\]`|\x00-\x1f\x7f]/;

export type NameValidationResult = { ok: true } | { ok: false; reason: string };

export function validatePersonName(input: string): NameValidationResult {
  if (typeof input !== 'string') {
    return { ok: false, reason: 'name must be a string' };
  }
  // Check DISALLOWED against the raw input — trim() strips \t, \n, \v, \f, \r
  // (all in the 0x00-0x1f range we want to reject) before the check otherwise
  // sees them, letting control-char-prefixed names through.
  if (DISALLOWED.test(input)) {
    return {
      ok: false,
      reason:
        'name contains disallowed characters (backslash, brackets, control chars)',
    };
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'name cannot be empty' };
  }
  if (trimmed.length > 100) {
    return { ok: false, reason: 'name too long (max 100 chars)' };
  }
  return { ok: true };
}

/**
 * Convenience for Zod refine() integration:
 *   z.string().refine(isValidPersonName, { message: 'invalid name' })
 */
export function isValidPersonName(input: string): boolean {
  return validatePersonName(input).ok;
}
