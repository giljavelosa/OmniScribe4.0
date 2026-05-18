import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  SIGNUP_RATE_MAX_ATTEMPTS,
  _resetSignupRateLimitForTest,
  consumeSignupAttempt,
} from '@/lib/rate-limit';
import { redis } from '@/lib/redis';

/**
 * Rate-limiter integration tests — Unit 37.
 *
 * Hits the live Redis (which BullMQ workers + cost-rollup share).
 * Each test starts with a fresh key for an isolated IP so window
 * counting doesn't leak across cases.
 *
 * Skipped in CI (no Redis). Run locally via `npm test` with REDIS_URL set.
 */

const hasRedis = !!process.env.REDIS_URL;
const describeMaybe = hasRedis ? describe : describe.skip;

const IP_PREFIX = 'test-unit-37-rl-';

beforeEach(async () => {
  if (!hasRedis) return;
  // Clear any lingering keys + the in-memory fallback map.
  const keys = await redis.keys('signup-rate:test-unit-37-rl-*');
  if (keys.length > 0) await redis.del(...keys);
  _resetSignupRateLimitForTest();
});

afterAll(async () => {
  if (!hasRedis) return;
  const keys = await redis.keys('signup-rate:test-unit-37-rl-*');
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
});

describeMaybe('consumeSignupAttempt', () => {
  it('allows the first attempt', async () => {
    const result = await consumeSignupAttempt(`${IP_PREFIX}allow-first`);
    expect(result).toEqual({ ok: true });
  });

  it('allows up to SIGNUP_RATE_MAX_ATTEMPTS in the window', async () => {
    const ip = `${IP_PREFIX}allow-five`;
    for (let i = 0; i < SIGNUP_RATE_MAX_ATTEMPTS; i++) {
      const result = await consumeSignupAttempt(ip);
      expect(result.ok).toBe(true);
    }
  });

  it('blocks the attempt past the threshold + returns retryAfterSeconds', async () => {
    const ip = `${IP_PREFIX}block-sixth`;
    for (let i = 0; i < SIGNUP_RATE_MAX_ATTEMPTS; i++) {
      await consumeSignupAttempt(ip);
    }
    const result = await consumeSignupAttempt(ip);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    }
  });

  it('isolates by IP — one IP exceeding doesnt block another', async () => {
    const blocked = `${IP_PREFIX}blocked-ip`;
    const allowed = `${IP_PREFIX}allowed-ip`;
    for (let i = 0; i < SIGNUP_RATE_MAX_ATTEMPTS + 1; i++) {
      await consumeSignupAttempt(blocked);
    }
    // blocked IP is now over-limit; allowed IP should still pass.
    const result = await consumeSignupAttempt(allowed);
    expect(result.ok).toBe(true);
  });
});
