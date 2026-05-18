import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hashIpForAudit,
  isTurnstileConfigured,
  verifyTurnstileToken,
} from '@/lib/captcha/turnstile';

/**
 * Turnstile module unit tests — Unit 37.
 *
 * Mocks global fetch + env so we can exercise:
 *   - isTurnstileConfigured branch (both env vars set vs missing)
 *   - verifyTurnstileToken happy path (success: true)
 *   - verifyTurnstileToken failure paths (non-2xx, success:false,
 *     network error)
 *   - hashIpForAudit (format + IP-less fallback)
 */

const origFetch = globalThis.fetch;
const origSiteKey = process.env.TURNSTILE_SITE_KEY;
const origSecretKey = process.env.TURNSTILE_SECRET_KEY;

afterEach(() => {
  globalThis.fetch = origFetch;
  process.env.TURNSTILE_SITE_KEY = origSiteKey;
  process.env.TURNSTILE_SECRET_KEY = origSecretKey;
});

describe('isTurnstileConfigured', () => {
  it('returns true when both env vars are set', () => {
    process.env.TURNSTILE_SITE_KEY = 'site-x';
    process.env.TURNSTILE_SECRET_KEY = 'secret-x';
    expect(isTurnstileConfigured()).toBe(true);
  });

  it('returns false when either env var is missing', () => {
    process.env.TURNSTILE_SITE_KEY = 'site-x';
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(isTurnstileConfigured()).toBe(false);

    delete process.env.TURNSTILE_SITE_KEY;
    process.env.TURNSTILE_SECRET_KEY = 'secret-x';
    expect(isTurnstileConfigured()).toBe(false);
  });
});

describe('verifyTurnstileToken', () => {
  it('returns true unconditionally when no secret configured (dev)', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(await verifyTurnstileToken('any', null)).toBe(true);
  });

  it('returns false for an empty token even when configured', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret-x';
    expect(await verifyTurnstileToken('', null)).toBe(false);
  });

  it('returns true when siteverify returns success:true', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret-x';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    }) as typeof fetch;
    expect(await verifyTurnstileToken('valid-token', '1.2.3.4')).toBe(true);
  });

  it('returns false when siteverify returns success:false', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret-x';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false }),
    }) as typeof fetch;
    expect(await verifyTurnstileToken('bad-token', null)).toBe(false);
  });

  it('returns false on non-2xx response', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret-x';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as typeof fetch;
    expect(await verifyTurnstileToken('any', null)).toBe(false);
  });

  it('returns false on network error (fail-closed)', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret-x';
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as typeof fetch;
    expect(await verifyTurnstileToken('any', null)).toBe(false);
  });
});

describe('hashIpForAudit', () => {
  it('returns no_ip for null', async () => {
    expect(await hashIpForAudit(null)).toBe('no_ip');
  });

  it('returns prefix:last3 format for an IP', async () => {
    const hash = await hashIpForAudit('192.168.1.42');
    // Format: 8 hex chars + : + last 3 chars of IP
    expect(hash).toMatch(/^[0-9a-f]{8}:.{3}$/);
    expect(hash.endsWith(':.42') || hash.endsWith(':142')).toBe(true);
  });

  it('produces deterministic hash for the same IP', async () => {
    const a = await hashIpForAudit('203.0.113.7');
    const b = await hashIpForAudit('203.0.113.7');
    expect(a).toBe(b);
  });

  it('produces different hashes for different IPs', async () => {
    const a = await hashIpForAudit('203.0.113.7');
    const b = await hashIpForAudit('198.51.100.42');
    expect(a).not.toBe(b);
  });
});
