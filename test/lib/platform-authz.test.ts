import { describe, expect, it, vi } from 'vitest';

import { requirePlatformOwner, requirePlatformStaff } from '@/lib/authz/platform';

/**
 * Platform authz helper tests — Unit 33.
 *
 * Mocks @/lib/auth's `auth()` function so we can drive the helpers
 * against constructed session shapes. Owner remains strictly stricter
 * than Staff; Staff accepts OWNER or OPS.
 *
 * Sprint 0.20 — MFA + login-verified gates removed; the previous
 * "rejects without login verification" cases are obsolete and
 * intentionally not re-added. Authentication is password-only.
 */

const mockAuth = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

function userWithRole(role: string) {
  return {
    user: {
      id: 'u1',
      email: 'u@x.com',
      orgId: null,
      orgUserId: null,
      role: null,
      division: null,
      profession: null,
      platformRole: role,
    },
  };
}

describe('requirePlatformOwner', () => {
  it('rejects when unauthenticated', async () => {
    mockAuth.mockResolvedValueOnce(null);
    const r = await requirePlatformOwner();
    expect('error' in r).toBe(true);
  });

  it('rejects PLATFORM_OPS (owner is owner-only)', async () => {
    mockAuth.mockResolvedValueOnce(userWithRole('PLATFORM_OPS'));
    const r = await requirePlatformOwner();
    expect('error' in r).toBe(true);
  });

  it('accepts PLATFORM_OWNER', async () => {
    mockAuth.mockResolvedValueOnce(userWithRole('PLATFORM_OWNER'));
    const r = await requirePlatformOwner();
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.user.platformRole).toBe('PLATFORM_OWNER');
    }
  });
});

describe('requirePlatformStaff', () => {
  it('rejects when unauthenticated', async () => {
    mockAuth.mockResolvedValueOnce(null);
    const r = await requirePlatformStaff();
    expect('error' in r).toBe(true);
  });

  it('rejects NONE role', async () => {
    mockAuth.mockResolvedValueOnce(userWithRole('NONE'));
    const r = await requirePlatformStaff();
    expect('error' in r).toBe(true);
  });

  it('accepts PLATFORM_OPS + returns role on result', async () => {
    mockAuth.mockResolvedValueOnce(userWithRole('PLATFORM_OPS'));
    const r = await requirePlatformStaff();
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.role).toBe('PLATFORM_OPS');
    }
  });

  it('accepts PLATFORM_OWNER + returns role on result', async () => {
    mockAuth.mockResolvedValueOnce(userWithRole('PLATFORM_OWNER'));
    const r = await requirePlatformStaff();
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.role).toBe('PLATFORM_OWNER');
    }
  });
});
