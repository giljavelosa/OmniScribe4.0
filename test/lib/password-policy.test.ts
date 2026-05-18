import { describe, it, expect } from 'vitest';
import { validatePassword } from '@/lib/auth/password-policy';

describe('password policy (D7)', () => {
  it('rejects under 12 chars', () => {
    expect(validatePassword('Aa1!aaa')).toEqual({ ok: false, reason: expect.stringContaining('12') });
  });

  it('rejects ≤ 2 character classes even when long', () => {
    expect(validatePassword('alllowercase____')).toEqual({
      ok: false,
      reason: expect.stringContaining('3 of'),
    });
    expect(validatePassword('ALLUPPERWITH123')).toEqual({
      ok: false,
      reason: expect.stringContaining('3 of'),
    });
  });

  it('accepts 12+ chars with 3 of 4 classes', () => {
    expect(validatePassword('MyPassword12')).toEqual({ ok: true });
    expect(validatePassword('mypassword1!')).toEqual({ ok: true });
    expect(validatePassword('My!Pass12345')).toEqual({ ok: true });
  });

  it('accepts 4 of 4 classes', () => {
    expect(validatePassword('My!Password1')).toEqual({ ok: true });
  });
});
