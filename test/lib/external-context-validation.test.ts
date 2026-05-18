import { describe, it, expect } from 'vitest';

import {
  validateDateOfRecord,
  extensionFromMime,
  SANITY_BACKDATE_YEARS,
} from '@/lib/external-context/validation';

describe('validateDateOfRecord', () => {
  const patientCreatedAt = new Date('2025-01-15T10:00:00Z');
  const today = new Date('2026-05-18T15:00:00Z');

  it('accepts a past ISO date inside the sanity window', () => {
    const result = validateDateOfRecord('2025-06-15', patientCreatedAt, today);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.toISOString().slice(0, 10)).toBe('2025-06-15');
    }
  });

  it('accepts today (same calendar day)', () => {
    const result = validateDateOfRecord('2026-05-18', patientCreatedAt, today);
    expect(result.ok).toBe(true);
  });

  it('rejects a future date', () => {
    const result = validateDateOfRecord('2026-05-19', patientCreatedAt, today);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/on or before today/i);
    }
  });

  it('rejects a date more than the sanity window before patient was added', () => {
    // patient created 2025-01-15; sanity floor = 2020-01-15. 2019-12-31 is before.
    const result = validateDateOfRecord('2019-12-31', patientCreatedAt, today);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(new RegExp(`${SANITY_BACKDATE_YEARS} years`));
    }
  });

  it('rejects garbage strings', () => {
    const result = validateDateOfRecord('not-a-date', patientCreatedAt, today);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/valid date/i);
    }
  });

  it('accepts an ISO datetime (not just date)', () => {
    const result = validateDateOfRecord('2025-06-15T14:30:00Z', patientCreatedAt, today);
    expect(result.ok).toBe(true);
  });

  it('accepts a date at the exact sanity floor', () => {
    // patient created 2025-01-15; floor = 2020-01-15. exact match should pass.
    const result = validateDateOfRecord('2020-01-15', patientCreatedAt, today);
    expect(result.ok).toBe(true);
  });
});

describe('extensionFromMime', () => {
  it('maps audio/mpeg to mp3', () => {
    expect(extensionFromMime('audio/mpeg')).toBe('mp3');
    expect(extensionFromMime('audio/mp3')).toBe('mp3');
  });

  it('maps audio/mp4 and audio/x-m4a to m4a', () => {
    expect(extensionFromMime('audio/mp4')).toBe('m4a');
    expect(extensionFromMime('audio/x-m4a')).toBe('m4a');
    expect(extensionFromMime('audio/m4a')).toBe('m4a');
    expect(extensionFromMime('audio/aac')).toBe('m4a');
  });

  it('defaults to wav for wav-ish mimes and unknowns', () => {
    expect(extensionFromMime('audio/wav')).toBe('wav');
    expect(extensionFromMime('audio/x-wav')).toBe('wav');
    expect(extensionFromMime('application/octet-stream')).toBe('wav');
    expect(extensionFromMime('')).toBe('wav');
  });
});
