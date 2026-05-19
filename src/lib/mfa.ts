/**
 * MFA TOTP helpers — spec §C + D2 (MFA always required for everyone).
 *
 * otplib v13 dropped the `authenticator` singleton; everything is now named
 * functions taking `{ secret }` opts. Functions are async to match the upstream
 * shape (some implementations use promise-based crypto).
 */

import bcrypt from 'bcryptjs';
import { generate, verify as otpVerify, generateSecret, generateURI } from 'otplib';
import { randomBytes } from 'node:crypto';

const ISSUER = 'OmniScribe';
const SECRET_BYTES = 20; // 20 bytes / 160 bits — comfortably above otplib's 16-byte minimum
const RECOVERY_CODE_COUNT = 10;
const BCRYPT_ROUNDS = 12;

export async function newMfaSecret(): Promise<string> {
  return generateSecret({ length: SECRET_BYTES });
}

export function buildOtpAuthUri(opts: { email: string; secret: string }): Promise<string> {
  return Promise.resolve(generateURI({ secret: opts.secret, label: opts.email, issuer: ISSUER }));
}

export async function generateTotpToken(secret: string): Promise<string> {
  return generate({ secret });
}

export async function verifyTotpToken(opts: { secret: string; token: string }): Promise<boolean> {
  if (!/^\d{6}$/.test(opts.token)) return false;
  // epochTolerance: 30s → accept the prior, current, and next 30s TOTP
  // windows (90s total). otplib v13's default is 0 (zero clock-skew), which
  // rejects valid codes when the authenticator app or server clock drifts —
  // common during enrollment when the user takes a few seconds between
  // scanning the QR and typing the code. NIST 800-63B endorses small skew
  // tolerance; ±1 step is the conventional value. (v13 renamed `window` →
  // `epochTolerance`, in seconds.)
  const r = await otpVerify({ secret: opts.secret, token: opts.token, epochTolerance: 30 });
  return r.valid;
}

/**
 * Generate `count` recovery codes. Returns both the plain codes (shown to the
 * user exactly once) and their bcrypt hashes (stored on User.mfaRecoveryCodes).
 */
export async function newRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const plain: string[] = [];
  const hashed: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = formatRecoveryCode(randomBytes(5).toString('hex'));
    plain.push(code);
    hashed.push(await bcrypt.hash(code, BCRYPT_ROUNDS));
  }
  return { plain, hashed };
}

function formatRecoveryCode(rawHex: string): string {
  // 10 hex chars → ABCDE-FGHIJ for readability.
  return `${rawHex.slice(0, 5)}-${rawHex.slice(5, 10)}`.toLowerCase();
}

/**
 * Check `code` against the user's hashed recovery-code list.
 * Returns the matched index (so the caller can splice it out and persist the
 * shorter list) OR -1 if no match.
 */
export async function consumeRecoveryCode(
  code: string,
  hashedList: readonly string[],
): Promise<number> {
  const normalized = code.trim().toLowerCase();
  for (let i = 0; i < hashedList.length; i++) {
    const ok = await bcrypt.compare(normalized, hashedList[i] ?? '');
    if (ok) return i;
  }
  return -1;
}
