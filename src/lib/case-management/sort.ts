/**
 * Clinician-aware case-management sort.
 *
 * Used by both:
 *   - the chart's CasesPanel (renders the first sorted case as a "hero")
 *   - the StartVisitDialog's case picker (pre-selects the first sorted case)
 *
 * So a clinician sees the same "this is yours" answer in both places.
 *
 * Three-tier ranking, highest priority first. Null is treated as the
 * epoch (0) so any non-null timestamp always sorts ahead of null.
 *
 *   1. `viewerLastActivityAt`           — when this viewer last signed a note on this case.
 *   2. `viewerDivisionLastActivityAt`   — when anyone in the viewer's division last did.
 *   3. `lastActivityAt`                 — when anyone last did, regardless of division.
 *
 * Tie at every level falls through to the next; if all three tie, sort is stable.
 */

export type ViewerRecencySignals = {
  viewerLastActivityAt: string | null;
  viewerDivisionLastActivityAt: string | null;
  lastActivityAt: string | null;
};

function ms(iso: string | null): number {
  return iso ? new Date(iso).getTime() : 0;
}

export function sortCasesByViewerRecency<T extends ViewerRecencySignals>(
  cases: readonly T[],
): T[] {
  return [...cases].sort((a, b) => {
    const aViewer = ms(a.viewerLastActivityAt);
    const bViewer = ms(b.viewerLastActivityAt);
    if (aViewer !== bViewer) return bViewer - aViewer;

    const aDiv = ms(a.viewerDivisionLastActivityAt);
    const bDiv = ms(b.viewerDivisionLastActivityAt);
    if (aDiv !== bDiv) return bDiv - aDiv;

    const aAll = ms(a.lastActivityAt);
    const bAll = ms(b.lastActivityAt);
    return bAll - aAll;
  });
}

/**
 * Whether the case's "primary" recency signal is the viewer's own activity.
 * Drives the "Your active case" pill (true) vs. "Most recent case" pill
 * (false) on the chart's hero card and in the dialog's picker.
 */
export function isViewerActiveCase(c: ViewerRecencySignals): boolean {
  return c.viewerLastActivityAt !== null;
}
