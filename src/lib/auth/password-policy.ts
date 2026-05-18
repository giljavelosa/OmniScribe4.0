/**
 * D7 — Password policy. 12+ chars, ≥3 of {upper, lower, digit, symbol}.
 * NIST 800-63B aligned ("memorized secret" guidance favors length over complexity).
 *
 * Used identically by:
 *   - POST /api/auth/password-reset/confirm
 *   - POST /api/onboarding/[token]/password (Commit 10)
 */

const MIN_LEN = 12;

export type PasswordValidation = { ok: true } | { ok: false; reason: string };

export function validatePassword(pw: string): PasswordValidation {
  if (typeof pw !== 'string' || pw.length < MIN_LEN) {
    return { ok: false, reason: `Password must be at least ${MIN_LEN} characters.` };
  }
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^A-Za-z0-9]/.test(pw)) classes++;

  if (classes < 3) {
    return {
      ok: false,
      reason: 'Password must include at least 3 of: uppercase, lowercase, digit, symbol.',
    };
  }
  return { ok: true };
}

export const PASSWORD_POLICY_DESCRIPTION =
  'At least 12 characters, with at least 3 of: uppercase letter, lowercase letter, digit, symbol.';
