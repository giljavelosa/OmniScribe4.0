import { describe, it, expect } from 'vitest';

import { diffForAudit, changedFieldsForAudit, singleFieldChange } from '@/lib/audit/diff';

describe('diffForAudit', () => {
  it('returns only the keys whose value actually changed', () => {
    const before = { name: 'Old', address: '1 Main', phone: '555' };
    const after = { name: 'New', address: '1 Main', phone: '555' };
    const diff = diffForAudit(before, after, ['name', 'address', 'phone']);
    expect(diff).toEqual({ name: { before: 'Old', after: 'New' } });
  });

  it('treats null and undefined consistently (both normalize to null)', () => {
    type Shape = { phone: string | null | undefined; address: string | null | undefined };
    const before: Shape = { phone: null, address: undefined };
    const after: Shape = { phone: undefined, address: null };
    const diff = diffForAudit<Shape>(before, after, ['phone', 'address'] as const);
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

describe('singleFieldChange', () => {
  it('returns the field envelope when before !== after', () => {
    expect(singleFieldChange('status', 'OPEN', 'CLOSED')).toEqual({
      status: { before: 'OPEN', after: 'CLOSED' },
    });
  });

  it('returns empty object when before === after (caller can spread safely)', () => {
    expect(singleFieldChange('status', 'OPEN', 'OPEN')).toEqual({});
  });

  it('normalizes Date instances to ISO strings on both sides', () => {
    const t1 = new Date('2026-05-17T00:00:00Z');
    const t2 = new Date('2026-06-17T00:00:00Z');
    expect(singleFieldChange('dueAt', t1, t2)).toEqual({
      dueAt: { before: t1.toISOString(), after: t2.toISOString() },
    });
  });

  it('coalesces null + undefined as equal (no spurious changes)', () => {
    expect(singleFieldChange('x', null, undefined)).toEqual({});
  });

  it('composes cleanly under a `changes` parent via spread', () => {
    // Mirrors the call-site pattern in Unit 34 episode routes:
    //   metadata: { changes: {
    //     ...singleFieldChange('status', before.status, after.status),
    //     ...singleFieldChange('dueAt',  before.due,    after.due),
    //   }}
    const changes = {
      ...singleFieldChange('status', 'A', 'B'),
      ...singleFieldChange('count', 1, 2),
      ...singleFieldChange('unchanged', 'x', 'x'),
    };
    expect(changes).toEqual({
      status: { before: 'A', after: 'B' },
      count: { before: 1, after: 2 },
    });
  });
});
