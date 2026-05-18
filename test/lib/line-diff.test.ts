import { describe, it, expect } from 'vitest';

import { diffLines, diffSummary } from '@/lib/diff/line-diff';

describe('diffLines', () => {
  it('returns all-equal segments when inputs match', () => {
    const out = diffLines('a\nb\nc', 'a\nb\nc');
    expect(out).toEqual([
      { kind: 'equal', text: 'a' },
      { kind: 'equal', text: 'b' },
      { kind: 'equal', text: 'c' },
    ]);
  });

  it('marks added lines on the right', () => {
    const out = diffLines('a\nc', 'a\nb\nc');
    expect(out).toEqual([
      { kind: 'equal', text: 'a' },
      { kind: 'add', text: 'b' },
      { kind: 'equal', text: 'c' },
    ]);
  });

  it('marks removed lines on the left', () => {
    const out = diffLines('a\nb\nc', 'a\nc');
    expect(out).toEqual([
      { kind: 'equal', text: 'a' },
      { kind: 'remove', text: 'b' },
      { kind: 'equal', text: 'c' },
    ]);
  });

  it('handles replacements — removes emitted before adds at change points', () => {
    const out = diffLines('a\nx\nc', 'a\ny\nc');
    expect(out).toEqual([
      { kind: 'equal', text: 'a' },
      { kind: 'remove', text: 'x' },
      { kind: 'add', text: 'y' },
      { kind: 'equal', text: 'c' },
    ]);
  });

  it('handles total replacement', () => {
    const out = diffLines('old1\nold2', 'new1\nnew2\nnew3');
    expect(out).toEqual([
      { kind: 'remove', text: 'old1' },
      { kind: 'remove', text: 'old2' },
      { kind: 'add', text: 'new1' },
      { kind: 'add', text: 'new2' },
      { kind: 'add', text: 'new3' },
    ]);
  });

  it('handles empty before — split("") returns [""] so single empty line precedes adds', () => {
    const out = diffLines('', 'one\ntwo');
    expect(out).toEqual([
      { kind: 'remove', text: '' },
      { kind: 'add', text: 'one' },
      { kind: 'add', text: 'two' },
    ]);
  });

  it('handles both-empty by returning a single equal segment', () => {
    expect(diffLines('', '')).toEqual([{ kind: 'equal', text: '' }]);
  });
});

describe('diffSummary', () => {
  it('counts segments by kind', () => {
    const out = diffLines('a\nx\nc', 'a\ny\nz\nc');
    expect(diffSummary(out)).toEqual({ added: 2, removed: 1, equal: 2 });
  });
});
