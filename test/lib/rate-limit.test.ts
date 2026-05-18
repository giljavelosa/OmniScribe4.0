import { afterAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Rate-limiter integration tests — Unit 37.
 *
 * Hits the live Redis (which BullMQ workers + cost-rollup share).
 * Each test starts with a fresh key for an isolated IP so window
 * counting doesn't leak across cases.
 *
 * Skipped in CI (no Redis). Run locally via `npm test` with REDIS_URL set.
 * Modules are imported lazily so the redis singleton's REDIS_URL guard
 * doesn't throw at file-load time when the env var is missing.
 */

const hasRedis = !!process.env.REDIS_URL;
const describeMaybe = hasRedis ? describe : describe.skip;

const IP_PREFIX = 'test-unit-37-rl-';

type RateLimitModule = typeof import('@/lib/rate-limit');
type RedisModule = typeof import('@/lib/redis');

let rl: RateLimitModule;
let redisMod: RedisModule;

beforeEach(async () => {
  if (!hasRedis) return;
  if (!rl) rl = await import('@/lib/rate-limit');
  if (!redisMod) redisMod = await import('@/lib/redis');
  const keys = await redisMod.redis.keys('signup-rate:test-unit-37-rl-*');
  if (keys.length > 0) await redisMod.redis.del(...keys);
  rl._resetSignupRateLimitForTest();
});

afterAll(async () => {
  if (!hasRedis || !redisMod) return;
  const keys = await redisMod.redis.keys('signup-rate:test-unit-37-rl-*');
  if (keys.length > 0) await redisMod.redis.del(...keys);
  await redisMod.redis.quit();
});

describeMaybe('consumeSignupAttempt', () => {
  it('allows the first attempt', async () => {
    const result = await rl.consumeSignupAttempt(`${IP_PREFIX}allow-first`);
    expect(result).toEqual({ ok: true });
  });

  it('allows up to rl.SIGNUP_RATE_MAX_ATTEMPTS in the window', async () => {
    const ip = `${IP_PREFIX}allow-five`;
    for (let i = 0; i < rl.SIGNUP_RATE_MAX_ATTEMPTS; i++) {
      const result = await rl.consumeSignupAttempt(ip);
      expect(result.ok).toBe(true);
    }
  });

  it('blocks the attempt past the threshold + returns retryAfterSeconds', async () => {
    const ip = `${IP_PREFIX}block-sixth`;
    for (let i = 0; i < rl.SIGNUP_RATE_MAX_ATTEMPTS; i++) {
      await rl.consumeSignupAttempt(ip);
    }
    const result = await rl.consumeSignupAttempt(ip);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    }
  });

  it('isolates by IP — one IP exceeding doesnt block another', async () => {
    const blocked = `${IP_PREFIX}blocked-ip`;
    const allowed = `${IP_PREFIX}allowed-ip`;
    for (let i = 0; i < rl.SIGNUP_RATE_MAX_ATTEMPTS + 1; i++) {
      await rl.consumeSignupAttempt(blocked);
    }
    // blocked IP is now over-limit; allowed IP should still pass.
    const result = await rl.consumeSignupAttempt(allowed);
    expect(result.ok).toBe(true);
  });
});
