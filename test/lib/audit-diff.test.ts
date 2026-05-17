import { describe, it, expect } from 'vitest';

import { diffForAudit, changedFieldsForAudit } from '@/lib/audit/diff';

describe('diffForAudit', () => {
  it('returns only the keys whose value actually changed', () => {
    const before = { name: 'Old', address: '1 Main', phone: '555' };
    const after = { name: 'New', address: '1 Main', phone: '555' };
    const diff = diffForAudit(before, after, ['name', 'address', 'phone']);
    expect(diff).toEqual({ name: { before: 'Old', after: 'New' } });
  });

  it('treats null and undefined consistently (both normalize to null)', () => {
    const before = { phone: null as string | null, address: undefined as string | undefined };
    const after = { phone: undefined as string | undefined, address: null as string | null };
    const diff = diffForAudit(before, after, ['phone', 'address'] as const);
    // null vs undefined are coalesced to null on both sides → no change.
    expect(diff).toEqual({});
  });

  it('compares Date instances by getTime()', () => {
    const a = new Date('2026-01-01T00:00:00Z');
    const b = new Date('2026-01-01T00:00:00Z');
    const c = new Date('2026-01-02T00:00:00Z');
    expect(diffForAudit({ d: a }, { d: b }, ['d'])).toEqual({});
    const diff = diffForAudit({ d: a }, { d: c }, ['d']);
    expect(diff).toEqual({
      d: { before: '2026-01-01T00:00:00.000Z', after: '2026-01-02T00:00:00.000Z' },
    });
  });

  it('handles nested objects via JSON-equality', () => {
    const before = { config: { x: 1, y: 2 } };
    const after = { config: { x: 1, y: 3 } };
    const diff = diffForAudit(before, after, ['config']);
    expect(diff).toEqual({
      config: { before: { x: 1, y: 2 }, after: { x: 1, y: 3 } },
    });
  });

  it('only iterates the fields the caller asks for (caller controls PHI exposure)', () => {
    const before = { name: 'A', secret: 'before' };
    const after = { name: 'B', secret: 'after' };
    const diff = diffForAudit(before, after, ['name']);
    expect(diff).toEqual({ name: { before: 'A', after: 'B' } });
    expect(diff.secret).toBeUndefined();
  });
});

describe('changedFieldsForAudit', () => {
  it('returns the list of changed field names only', () => {
    const before = { name: 'A', kind: 'X' };
    const after = { name: 'B', kind: 'X' };
    expect(changedFieldsForAudit(before, after, ['name', 'kind'])).toEqual(['name']);
  });
});
