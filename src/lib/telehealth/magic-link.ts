import { randomBytes } from 'node:crypto';

/**
 * Magic-link helpers — Unit 15 §B.
 *
 * Anti-enumeration discipline: callers should map every "invalid token /
 * wrong DOB / expired / consumed" outcome to a SINGLE generic error
 * surface. The audit row captures the internal reason for ops triage; the
 * external response never distinguishes them.
 */

const MAGIC_TOKEN_BYTES = 16; // 16 bytes → 22 chars after base64url + strip padding
const HOURS_24_MS = 24 * 60 * 60 * 1000;
const HOURS_2_MS = 2 * 60 * 60 * 1000;

/** Generate a 22-char URL-safe magic link token. ~131 bits of entropy. */
export function generateMagicToken(): string {
  return randomBytes(MAGIC_TOKEN_BYTES)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Compute the expiration boundary for a magic link.
 * Earliest of: issuedAt + 24h, scheduledEnd + 2h grace period.
 * The grace period gives the patient breathing room if the visit runs
 * over or they show up late; the 24h cap prevents the link from
 * outliving the visit by more than a day.
 */
export function computeMagicExpiresAt(input: {
  issuedAt: Date;
  scheduledEnd: Date;
}): Date {
  const fromIssue = new Date(input.issuedAt.getTime() + HOURS_24_MS);
  const fromVisit = new Date(input.scheduledEnd.getTime() + HOURS_2_MS);
  return fromIssue.getTime() < fromVisit.getTime() ? fromIssue : fromVisit;
}

/**
 * Strict DOB equality at day granularity. Patient.dob is a Date; the
 * input is an ISO YYYY-MM-DD string from the patient's form submission.
 * We compare day-only — time-component drift can't matter for date of
 * birth. Returns boolean; callers map false to the generic error.
 */
export function verifyDobAgainst(stored: Date, suppliedIso: string): boolean {
  if (!suppliedIso || !/^\d{4}-\d{2}-\d{2}$/.test(suppliedIso)) return false;
  const storedIso = stored.toISOString().slice(0, 10);
  return storedIso === suppliedIso;
}

/** Single check covering expiration. */
export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() < now.getTime();
}
