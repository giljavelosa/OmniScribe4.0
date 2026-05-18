/**
 * Signup rate limiter — Unit 37.
 *
 * Per-IP cap of 5 attempts per 15-minute window. Redis-first via
 * `INCR + EXPIRE` for production; falls back to an in-memory `Map`
 * for dev environments without Redis up + integration tests.
 *
 * Fail-open on Redis errors (returns `{ ok: true }`) — a broken
 * Redis shouldn't lock out the entire signup funnel. The fallback
 * Map kicks in only when redis.incr() throws.
 */

import { redis } from '@/lib/redis';

export const SIGNUP_RATE_WINDOW_SECONDS = 15 * 60;
export const SIGNUP_RATE_MAX_ATTEMPTS = 5;

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

const inMemory = new Map<string, { count: number; expiresAt: number }>();

function inMemoryConsume(key: string, now: number): RateLimitResult {
  const existing = inMemory.get(key);
  if (existing && existing.expiresAt > now) {
    existing.count += 1;
    if (existing.count > SIGNUP_RATE_MAX_ATTEMPTS) {
      return {
        ok: false,
        retryAfterSeconds: Math.ceil((existing.expiresAt - now) / 1000),
      };
    }
    return { ok: true };
  }
  inMemory.set(key, {
    count: 1,
    expiresAt: now + SIGNUP_RATE_WINDOW_SECONDS * 1000,
  });
  return { ok: true };
}

/**
 * Consume one signup attempt for the given IP. Returns `{ ok: true }`
 * if within budget; `{ ok: false, retryAfterSeconds }` if exceeded.
 * Caller surfaces 429 + Retry-After header on `ok: false`.
 */
export async function consumeSignupAttempt(ip: string): Promise<RateLimitResult> {
  const key = `signup-rate:${ip}`;
  const now = Date.now();
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      // First hit — set the TTL. EXPIRE returns 1 on success.
      await redis.expire(key, SIGNUP_RATE_WINDOW_SECONDS);
    }
    if (count > SIGNUP_RATE_MAX_ATTEMPTS) {
      const ttl = await redis.ttl(key);
      return {
        ok: false,
        retryAfterSeconds: ttl > 0 ? ttl : SIGNUP_RATE_WINDOW_SECONDS,
      };
    }
    return { ok: true };
  } catch {
    // Redis unavailable — fall back to in-memory. Fail-open: if
    // BOTH Redis + in-memory fail (shouldn't happen), assume open.
    return inMemoryConsume(key, now);
  }
}

/** Test-only: clear the in-memory map between tests. */
export function _resetSignupRateLimitForTest(): void {
  inMemory.clear();
}
