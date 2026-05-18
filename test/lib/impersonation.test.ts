import { describe, expect, it } from 'vitest';

import {
  IMPERSONATION_MAX_DURATION_MS,
  IMPERSONATION_SAFE_METHODS,
  readActiveImpersonation,
  shortReasonForBanner,
  shouldBlockUnderImpersonation,
  type ImpersonationContext,
} from '@/lib/impersonation';

/**
 * Pure-function unit tests for the impersonation helpers — Unit 32.
 *
 * The DB-touching layers (assertNotImpersonating, writeImpersonatableAudit)
 * are exercised in the route integration tests; this suite locks the
 * pure logic that middleware + the helper both depend on.
 */

const VALID_CONTEXT: ImpersonationContext = {
  targetUserId: 'usr-target',
  targetOrgId: 'org-target',
  beganAt: Date.UTC(2026, 4, 17, 12, 0, 0), // arbitrary fixed
  reason: 'Customer support — investigating signed-note bug',
};

describe('readActiveImpersonation', () => {
  it('returns null when no token is provided', () => {
    expect(readActiveImpersonation(null)).toBeNull();
    expect(readActiveImpersonation(undefined)).toBeNull();
  });

  it('returns null when token has no impersonation field', () => {
    expect(readActiveImpersonation({})).toBeNull();
    expect(readActiveImpersonation({ impersonation: null })).toBeNull();
  });

  it('returns the context when within the 60-minute window', () => {
    const now = VALID_CONTEXT.beganAt + 30 * 60 * 1000; // 30 min in
    expect(
      readActiveImpersonation({ impersonation: VALID_CONTEXT }, now),
    ).toEqual(VALID_CONTEXT);
  });

  it('returns null past the 60-minute cap', () => {
    const now = VALID_CONTEXT.beganAt + IMPERSONATION_MAX_DURATION_MS + 1;
    expect(
      readActiveImpersonation({ impersonation: VALID_CONTEXT }, now),
    ).toBeNull();
  });

  it('returns null at exactly the cap + 1ms (boundary)', () => {
    const now = VALID_CONTEXT.beganAt + IMPERSONATION_MAX_DURATION_MS + 1;
    expect(readActiveImpersonation({ impersonation: VALID_CONTEXT }, now)).toBeNull();
  });

  it('returns the context exactly at the cap (boundary OK)', () => {
    const now = VALID_CONTEXT.beganAt + IMPERSONATION_MAX_DURATION_MS;
    expect(
      readActiveImpersonation({ impersonation: VALID_CONTEXT }, now),
    ).toEqual(VALID_CONTEXT);
  });

  it('returns null for a future-dated beganAt (clock skew)', () => {
    const now = VALID_CONTEXT.beganAt - 1000; // request "from the past"
    expect(
      readActiveImpersonation({ impersonation: VALID_CONTEXT }, now),
    ).toBeNull();
  });
});

describe('shouldBlockUnderImpersonation', () => {
  const POST_PATH = { method: 'POST', pathname: '/api/patients' };
  const GET_PATH = { method: 'GET', pathname: '/api/patients' };
  const END_IMP_PATH = {
    method: 'DELETE',
    pathname: '/api/owner/orgs/org-123/impersonate',
  };

  it('returns false when no impersonation is active', () => {
    expect(
      shouldBlockUnderImpersonation({ ...POST_PATH, impersonation: null }),
    ).toBe(false);
  });

  it('returns false for GET / HEAD / OPTIONS even during impersonation', () => {
    for (const method of IMPERSONATION_SAFE_METHODS) {
      expect(
        shouldBlockUnderImpersonation({
          method,
          pathname: '/api/patients',
          impersonation: VALID_CONTEXT,
        }),
      ).toBe(false);
    }
  });

  it('returns true for POST during impersonation', () => {
    expect(
      shouldBlockUnderImpersonation({
        ...POST_PATH,
        impersonation: VALID_CONTEXT,
      }),
    ).toBe(true);
  });

  it('returns true for PATCH during impersonation', () => {
    expect(
      shouldBlockUnderImpersonation({
        method: 'PATCH',
        pathname: '/api/admin/users/u-1',
        impersonation: VALID_CONTEXT,
      }),
    ).toBe(true);
  });

  it('returns true for arbitrary DELETE during impersonation', () => {
    expect(
      shouldBlockUnderImpersonation({
        method: 'DELETE',
        pathname: '/api/notes/n-1',
        impersonation: VALID_CONTEXT,
      }),
    ).toBe(true);
  });

  it('returns false for DELETE on the end-impersonation endpoint (bypass)', () => {
    expect(
      shouldBlockUnderImpersonation({
        ...END_IMP_PATH,
        impersonation: VALID_CONTEXT,
      }),
    ).toBe(false);
  });

  it('returns false for GET regardless of path/context', () => {
    expect(
      shouldBlockUnderImpersonation({
        ...GET_PATH,
        impersonation: VALID_CONTEXT,
      }),
    ).toBe(false);
  });

  it('case-insensitive on method (e.g. lowercase "post")', () => {
    expect(
      shouldBlockUnderImpersonation({
        method: 'post',
        pathname: '/api/patients',
        impersonation: VALID_CONTEXT,
      }),
    ).toBe(true);
    expect(
      shouldBlockUnderImpersonation({
        method: 'get',
        pathname: '/api/patients',
        impersonation: VALID_CONTEXT,
      }),
    ).toBe(false);
  });
});

describe('shortReasonForBanner', () => {
  it('passes through reasons ≤80 chars unchanged', () => {
    const short = 'Customer support — debugging note sign issue';
    expect(shortReasonForBanner(short)).toBe(short);
  });

  it('truncates reasons >80 chars to exactly 80', () => {
    const long = 'x'.repeat(200);
    expect(shortReasonForBanner(long).length).toBe(80);
  });

  it('trims whitespace before applying the cap', () => {
    expect(shortReasonForBanner('   investigating bug   ')).toBe('investigating bug');
  });

  it('handles empty string', () => {
    expect(shortReasonForBanner('')).toBe('');
  });
});
