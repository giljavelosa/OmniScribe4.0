import { describe, it, expect } from 'vitest';
import { newMfaSecret, generateTotpToken, verifyTotpToken, newRecoveryCodes, consumeRecoveryCode, buildOtpAuthUri } from '@/lib/mfa';

describe('mfa', () => {
  it('newMfaSecret returns a base32 string ≥ 16 bytes (32 chars)', async () => {
    const s = await newMfaSecret();
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThanOrEqual(32);
    expect(/^[A-Z2-7]+=*$/.test(s)).toBe(true);
  });

  it('verifyTotpToken accepts a freshly generated token', async () => {
    const secret = await newMfaSecret();
    const token = await generateTotpToken(secret);
    expect(token).toMatch(/^\d{6}$/);
    expect(await verifyTotpToken({ secret, token })).toBe(true);
  });

  it('verifyTotpToken rejects non-numeric or malformed tokens fast', async () => {
    const secret = await newMfaSecret();
    expect(await verifyTotpToken({ secret, token: 'abcdef' })).toBe(false);
    expect(await verifyTotpToken({ secret, token: '12345' })).toBe(false);
    expect(await verifyTotpToken({ secret, token: '1234567' })).toBe(false);
  });

  it('buildOtpAuthUri returns an otpauth URI carrying the secret + issuer', async () => {
    const uri = await buildOtpAuthUri({ email: 'demo@example.com', secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' });
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('issuer=OmniScribe');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
  });

  describe('recovery codes', () => {
    it('newRecoveryCodes returns count plain + count hashed', async () => {
      const r = await newRecoveryCodes(5);
      expect(r.plain).toHaveLength(5);
      expect(r.hashed).toHaveLength(5);
      // each plain code is `5hex-5hex` lowercase
      r.plain.forEach((c) => expect(/^[0-9a-f]{5}-[0-9a-f]{5}$/.test(c)).toBe(true));
      // hashes are bcrypt
      r.hashed.forEach((h) => expect(h.startsWith('$2')).toBe(true));
    });

    it('consumeRecoveryCode finds the matching index', async () => {
      const r = await newRecoveryCodes(3);
      const idx = await consumeRecoveryCode(r.plain[1]!, r.hashed);
      expect(idx).toBe(1);
    });

    it('consumeRecoveryCode returns -1 when no match', async () => {
      const r = await newRecoveryCodes(3);
      const idx = await consumeRecoveryCode('aaaaa-bbbbb', r.hashed);
      expect(idx).toBe(-1);
    });
  });
});
