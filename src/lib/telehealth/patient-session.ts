import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

/**
 * Patient telehealth session cookie — Unit 15 §E.
 *
 * After the patient verifies DOB on /v/[token], the magic token is moved
 * out of the URL and into an httpOnly cookie so the waiting room never
 * needs to expose the token to JS or pass it around as a prop. All
 * post-verify endpoints (/me/status, /me/consent) resolve the token from
 * this cookie. Keeps the magic token entirely server-side after step 1.
 *
 * Lifetime: 2 hours. Roughly covers a delayed clinician + the visit
 * itself, while keeping the surface narrow if a patient leaves the tab
 * open and walks away. Magic link's own expiresAt still bounds whether a
 * resolved session is usable; the cookie just transports the lookup key.
 */
export const TELE_SESSION_COOKIE = 'tele_session';
const TWO_HOURS_SECONDS = 2 * 60 * 60;

/**
 * Attach the patient session cookie to a NextResponse. Call only from
 * routes that have already validated the token (i.e. successful POST
 * /verify). Secure flag follows NODE_ENV — local http dev works, prod
 * https is enforced.
 */
export function setPatientSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set({
    name: TELE_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TWO_HOURS_SECONDS,
  });
}

/** Read the patient session token from the inbound request cookies. */
export async function readPatientSessionToken(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(TELE_SESSION_COOKIE)?.value;
  return value && value.length > 0 ? value : null;
}

/** Clear the cookie on session end / explicit logout. */
export function clearPatientSessionCookie(res: NextResponse): void {
  res.cookies.set({
    name: TELE_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}
