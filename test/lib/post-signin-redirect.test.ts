import { describe, it, expect } from 'vitest';
import { postSigninRedirect } from '@/lib/post-signin-redirect';

describe('postSigninRedirect', () => {
  it('routes to /mfa-setup when MFA is not enrolled', () => {
    expect(postSigninRedirect({ mfaEnabled: false, mfaVerified: false })).toBe('/mfa-setup');
  });

  it('routes to /mfa-challenge when enrolled but not yet verified this session', () => {
    expect(postSigninRedirect({ mfaEnabled: true, mfaVerified: false })).toBe('/mfa-challenge');
  });

  it('routes to /home when enrolled and verified', () => {
    expect(postSigninRedirect({ mfaEnabled: true, mfaVerified: true })).toBe('/home');
  });

  it('routes to /mfa-setup even when mfaVerified=true but mfaEnabled=false (defensive)', () => {
    // mfaVerified without mfaEnabled is an inconsistent state — setup
    // must run before verification can be considered valid.
    expect(postSigninRedirect({ mfaEnabled: false, mfaVerified: true })).toBe('/mfa-setup');
  });
});
