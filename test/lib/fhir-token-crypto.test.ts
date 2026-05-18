import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FhirTokenCryptoError,
  __resetTokenCryptoKeyCache,
  decryptToken,
  encryptToken,
} from '@/lib/fhir/token-crypto';

/**
 * AES-256-GCM envelope round-trip + failure modes. The envelope shape
 * is contract — F2/F3 readers parse `v1:…` and must reject tampering,
 * wrong keys, and bad envelopes uniformly.
 */
describe('fhir token crypto', () => {
  const originalEnv = process.env.FHIR_TOKEN_ENCRYPTION_KEY;

  function setKey(buf: Buffer): void {
    process.env.FHIR_TOKEN_ENCRYPTION_KEY = buf.toString('base64');
    __resetTokenCryptoKeyCache();
  }

  beforeEach(() => {
    setKey(randomBytes(32));
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FHIR_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.FHIR_TOKEN_ENCRYPTION_KEY = originalEnv;
    }
    __resetTokenCryptoKeyCache();
  });

  it('round-trips a SMART access token', () => {
    const tok = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.fake.payload';
    const enc = encryptToken(tok);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc.split(':').length).toBe(4);
    expect(decryptToken(enc)).toBe(tok);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const tok = 'access-token-value';
    const a = encryptToken(tok);
    const b = encryptToken(tok);
    expect(a).not.toEqual(b);
    expect(decryptToken(a)).toBe(tok);
    expect(decryptToken(b)).toBe(tok);
  });

  it('rejects empty input on encrypt', () => {
    expect(() => encryptToken('')).toThrow(FhirTokenCryptoError);
  });

  it('rejects a tampered ciphertext (auth tag mismatch)', () => {
    const enc = encryptToken('hello');
    const parts = enc.split(':');
    // Flip a byte in the middle of the ciphertext.
    const ctBuf = Buffer.from(parts[2]!, 'base64');
    ctBuf[0] = (ctBuf[0]! ^ 0x01) & 0xff;
    parts[2] = ctBuf.toString('base64');
    expect(() => decryptToken(parts.join(':'))).toThrow(FhirTokenCryptoError);
  });

  it('rejects an envelope encrypted under a different key', () => {
    const enc = encryptToken('hello');
    setKey(randomBytes(32));
    expect(() => decryptToken(enc)).toThrow(FhirTokenCryptoError);
  });

  it('rejects malformed envelopes', () => {
    expect(() => decryptToken('not-an-envelope')).toThrow(FhirTokenCryptoError);
    expect(() => decryptToken('v1:only:three')).toThrow(FhirTokenCryptoError);
    expect(() => decryptToken('v2:a:b:c')).toThrow(FhirTokenCryptoError);
  });

  it('rejects keys of the wrong length', () => {
    setKey(randomBytes(16));
    expect(() => encryptToken('hello')).toThrow(/32 bytes/);
  });

  it('rejects a missing env var', () => {
    delete process.env.FHIR_TOKEN_ENCRYPTION_KEY;
    __resetTokenCryptoKeyCache();
    expect(() => encryptToken('hello')).toThrow(/not set/);
  });
});
