/**
 * Cloudflare Turnstile verification — Unit 37.
 *
 * Required for /api/auth/signup when both TURNSTILE_SITE_KEY and
 * TURNSTILE_SECRET_KEY are set in env. Skipped (verification returns
 * true unconditionally) when either is missing — avoids hard-requiring
 * a Cloudflare account for dev environments.
 *
 * The siteverify endpoint accepts the secret + token + optional
 * remoteip; returns `{ success: boolean, ... }`. Any non-2xx or
 * `success: false` result fails the verification.
 *
 * No retries on network failure — a slow / unreachable Cloudflare
 * means a slow signup; the rate-limit + browser timeout protect from
 * worse outcomes. Default 5-second client timeout via AbortSignal.
 */

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 5_000;

export function isTurnstileConfigured(): boolean {
  return !!(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
}

export async function verifyTurnstileToken(
  token: string,
  remoteIp: string | null,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Not configured — treat as pass. Caller's `isTurnstileConfigured`
    // check should have short-circuited the requirement; this branch
    // is the belt-and-suspenders no-op.
    return true;
  }
  if (!token || token.length === 0) return false;

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (remoteIp) body.set('remoteip', remoteIp);

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const json = (await res.json().catch(() => null)) as
      | { success: boolean }
      | null;
    return !!json?.success;
  } catch {
    // Network failure / timeout. Fail-closed — better to reject a
    // signup than to admit one without verification when Turnstile
    // is supposed to be active.
    return false;
  }
}

/** SHA-256 prefix + last-3 chars — used to record IPs in audit
 *  without storing raw IPs indefinitely. */
export async function hashIpForAudit(ip: string | null): Promise<string> {
  if (!ip) return 'no_ip';
  const enc = new TextEncoder().encode(ip);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  const bytes = new Uint8Array(buf);
  const hex = Array.from(bytes.subarray(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const last3 = ip.slice(-3);
  return `${hex}:${last3}`;
}
