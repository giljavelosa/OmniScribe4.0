import { describe, it, expect, afterEach, vi } from 'vitest';
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

  describe('clock-skew tolerance', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('accepts a code from the previous 30s step (read-then-type race)', async () => {
      const secret = await newMfaSecret();
      const base = 1_700_000_000_000; // fixed epoch, mid-step
      vi.useFakeTimers();
      vi.setSystemTime(base);
      const token = await generateTotpToken(secret);
      // Clock advances 35s — server is now in the NEXT 30s step. Without
      // epochTolerance this code would be rejected; with ±30s it survives.
      vi.setSystemTime(base + 35_000);
      expect(await verifyTotpToken({ secret, token })).toBe(true);
    });

    it('still rejects a code well outside the tolerance window', async () => {
      const secret = await newMfaSecret();
      const base = 1_700_000_000_000;
      vi.useFakeTimers();
      vi.setSystemTime(base);
      const token = await generateTotpToken(secret);
      // 5 minutes later — far beyond the ±30s window.
      vi.setSystemTime(base + 5 * 60_000);
      expect(await verifyTotpToken({ secret, token })).toBe(false);
    });
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
