/**
 * Line-level diff via the classic LCS algorithm.
 *
 * Why hand-rolled: bringing in the `diff` package is ~30 KB minified for a
 * surface that needs ~50 lines of code. Keeps the bundle clean and the
 * output shape exactly what the SectionDiffDialog renders.
 *
 * Returns an array of segments in source order:
 *   - { kind: 'equal',  text }   — line present in both
 *   - { kind: 'remove', text }   — line in `before` only (struck-through left)
 *   - { kind: 'add',    text }   — line in `after` only (highlighted right)
 *
 * For empty inputs returns a single segment so the UI has something to show.
 */

export type DiffSegment =
  | { kind: 'equal'; text: string }
  | { kind: 'remove'; text: string }
  | { kind: 'add'; text: string };

export function diffLines(before: string, after: string): DiffSegment[] {
  const a = (before ?? '').split('\n');
  const b = (after ?? '').split('\n');
  if (a.length === 0 && b.length === 0) return [{ kind: 'equal', text: '' }];

  // LCS table.
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      lcs[i + 1]![j + 1] = a[i] === b[j] ? lcs[i]![j]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  // Walk back, emit segments newest-last.
  const result: DiffSegment[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ kind: 'equal', text: a[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i]![j - 1]! >= lcs[i - 1]![j]!)) {
      result.push({ kind: 'add', text: b[j - 1]! });
      j--;
    } else if (i > 0) {
      result.push({ kind: 'remove', text: a[i - 1]! });
      i--;
    }
  }
  result.reverse();
  return result;
}

/** Counts of changed lines, for surface-level "+N -M" summary chips. */
export function diffSummary(segments: DiffSegment[]): { added: number; removed: number; equal: number } {
  let added = 0;
  let removed = 0;
  let equal = 0;
  for (const s of segments) {
    if (s.kind === 'add') added++;
    else if (s.kind === 'remove') removed++;
    else equal++;
  }
  return { added, removed, equal };
}
