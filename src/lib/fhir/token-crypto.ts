import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope for SMART on FHIR tokens at rest (Unit 19).
 *
 * Envelope format: 'v1:<base64(iv)>:<base64(ciphertext)>:<base64(authTag)>'.
 * - Prefix is version-tagged so future key rotation can recognize stale
 *   ciphertexts and re-encrypt without ambiguity.
 * - IV is 12 random bytes per encryption (NIST SP 800-38D recommendation
 *   for GCM).
 * - Auth tag is 16 bytes (the GCM default); separated from the ciphertext
 *   so the envelope shape is constant per-byte.
 *
 * Key handling: `FHIR_TOKEN_ENCRYPTION_KEY` is a 32-byte raw key,
 * base64-encoded for env transport. Required even in stub mode so
 * encrypted-at-rest behavior is exercised end-to-end. The default dev
 * key in `.env.example` is clearly labeled "LOCAL DEV ONLY".
 */

export class FhirTokenCryptoError extends Error {
  constructor(reason: string, cause?: unknown) {
    super(`fhir token crypto: ${reason}`);
    this.name = 'FhirTokenCryptoError';
    if (cause) (this as { cause?: unknown }).cause = cause;
  }
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ENVELOPE_PREFIX = 'v1';

/** Load + validate the encryption key from env. Cached per-process; the
 *  key is constant for the lifetime of the server. Throws an explicit
 *  error if the env var is missing or wrong length so misconfigured
 *  deployments fail loudly at startup rather than silently misencrypting. */
let cachedKey: Buffer | null = null;
function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.FHIR_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new FhirTokenCryptoError('FHIR_TOKEN_ENCRYPTION_KEY is not set');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new FhirTokenCryptoError(
      `FHIR_TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`,
    );
  }
  cachedKey = key;
  return key;
}

/** Test hook — clears the cached key so tests can swap the env var between cases. */
export function __resetTokenCryptoKeyCache(): void {
  cachedKey = null;
}

/** Encrypt a SMART token (access or refresh). Returns the v1 envelope string. */
export function encryptToken(plain: string): string {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new FhirTokenCryptoError('cannot encrypt empty token');
  }
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    ENVELOPE_PREFIX,
    iv.toString('base64'),
    ciphertext.toString('base64'),
    authTag.toString('base64'),
  ].join(':');
}

/** Decrypt a v1 envelope back to plaintext. Throws on bad envelope, wrong
 *  key, or tampered ciphertext (GCM auth tag mismatch). */
export function decryptToken(envelope: string): string {
  if (typeof envelope !== 'string') {
    throw new FhirTokenCryptoError('envelope must be a string');
  }
  const parts = envelope.split(':');
  if (parts.length !== 4 || parts[0] !== ENVELOPE_PREFIX) {
    throw new FhirTokenCryptoError('invalid envelope shape');
  }
  const [, ivB64, ctB64, tagB64] = parts as [string, string, string, string];
  const key = loadKey();
  const iv = Buffer.from(ivB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  if (iv.length !== IV_BYTES) {
    throw new FhirTokenCryptoError(`iv must be ${IV_BYTES} bytes (got ${iv.length})`);
  }
  if (authTag.length !== 16) {
    throw new FhirTokenCryptoError(`auth tag must be 16 bytes (got ${authTag.length})`);
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  try {
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8');
  } catch (e) {
    throw new FhirTokenCryptoError('decryption failed (tampered or wrong key)', e);
  }
}
