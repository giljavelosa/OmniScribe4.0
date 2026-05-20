import { describe, it, expect, afterEach, vi } from 'vitest';

import { isStripeConfigured, getPublicBaseUrl } from '@/lib/stripe/env';
import { getStripe, PRICE_IDS } from '@/lib/stripe/client';

const STRIPE_VARS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_SOLO_PRICE_ID',
  'STRIPE_TEAM_PRICE_ID',
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isStripeConfigured', () => {
  it('is false when no STRIPE_* vars are set', () => {
    for (const k of STRIPE_VARS) vi.stubEnv(k, '');
    expect(isStripeConfigured()).toBe(false);
  });

  it('is false when only some of the four vars are set', () => {
    for (const k of STRIPE_VARS) vi.stubEnv(k, '');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_x');
    expect(isStripeConfigured()).toBe(false);
  });

  it('is true only when all four vars are set', () => {
    for (const k of STRIPE_VARS) vi.stubEnv(k, `${k}_value`);
    expect(isStripeConfigured()).toBe(true);
  });
});

describe('getPublicBaseUrl', () => {
  it('strips trailing slashes from NEXTAUTH_URL', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://app.example.com/');
    expect(getPublicBaseUrl()).toBe('https://app.example.com');
  });

  it('falls back to localhost when NEXTAUTH_URL is empty', () => {
    vi.stubEnv('NEXTAUTH_URL', '');
    expect(getPublicBaseUrl()).toBe('http://localhost:3000');
  });
});

describe('PRICE_IDS', () => {
  it('throws when the tier price-id env var is unset', () => {
    vi.stubEnv('STRIPE_SOLO_PRICE_ID', '');
    expect(() => PRICE_IDS.SOLO).toThrow(/STRIPE_SOLO_PRICE_ID/);
  });

  it('returns the price id when set', () => {
    vi.stubEnv('STRIPE_TEAM_PRICE_ID', 'price_team_123');
    expect(PRICE_IDS.TEAM).toBe('price_team_123');
  });
});

describe('getStripe', () => {
  it('throws when STRIPE_SECRET_KEY is unset', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    expect(() => getStripe()).toThrow(/STRIPE_SECRET_KEY/);
  });
});
