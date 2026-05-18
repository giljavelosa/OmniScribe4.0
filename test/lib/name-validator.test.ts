import { describe, expect, it } from 'vitest';

import {
  isValidPersonName,
  validatePersonName,
} from '@/lib/patient/name-validator';

/**
 * Person-name validator tests — Polish (post-Wave 6).
 *
 * Locks the "reject obvious bad input, permit real names" contract.
 * Discovered during smoke testing 2026-05-18 when a typed `\` made it
 * through to the DB; this validator prevents it from happening again.
 */

describe('validatePersonName', () => {
  it.each([
    'Gil',
    'José',
    "O'Brien",
    'Jean-Pierre',
    'St. John',
    '田中',
    'María del Carmen',
    'Anne Marie',
    'Müller',
    'Ng',
  ])('accepts real name: %s', (name) => {
    expect(validatePersonName(name).ok).toBe(true);
  });

  it.each([
    ['G\\il', 'backslash'],
    ['<script>', 'angle brackets'],
    ['name]injection[', 'brackets'],
    ['name{}', 'curly braces'],
    ['name`backtick`', 'backticks'],
    ['name|pipe', 'pipe'],
    ['Joe\x00Null', 'null byte'],
    ['Joe\nNewline', 'newline'],
    ['Joe\tTab', 'tab'],
  ])('rejects %s (%s)', (name) => {
    const r = validatePersonName(name);
    expect(r.ok).toBe(false);
  });

  it('rejects empty + whitespace-only', () => {
    expect(validatePersonName('').ok).toBe(false);
    expect(validatePersonName('   ').ok).toBe(false);
  });

  it('rejects names over 100 chars', () => {
    expect(validatePersonName('x'.repeat(101)).ok).toBe(false);
    expect(validatePersonName('x'.repeat(100)).ok).toBe(true);
  });

  it('rejects non-string input', () => {
    // @ts-expect-error -- guarding runtime contract
    expect(validatePersonName(null).ok).toBe(false);
    // @ts-expect-error -- guarding runtime contract
    expect(validatePersonName(undefined).ok).toBe(false);
    // @ts-expect-error -- guarding runtime contract
    expect(validatePersonName(42).ok).toBe(false);
  });
});

describe('isValidPersonName (boolean convenience)', () => {
  it('matches validatePersonName.ok', () => {
    expect(isValidPersonName('Gil')).toBe(true);
    expect(isValidPersonName('G\\il')).toBe(false);
  });
});
