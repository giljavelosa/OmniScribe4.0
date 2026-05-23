/**
 * Sprint 0.14 — shared per-case viewer-recency projection.
 *
 * Extracted from `src/app/(clinical)/patients/[id]/page.tsx` so the
 * cleo-state builder + the chart page compute the same three-tier
 * recency signals. The shape feeds `sortCasesByViewerRecency` (from
 * `./sort.ts`) so the chart's "Your active case" hero pick and Miss
 * Cleo's case-awareness rollup agree on what "yours" means.
 */

type SignedNoteForCaseRecency = {
  signedAt: Date | null;
  division: string | null;
  clinicianOrgUserId: string | null;
  encounter: { caseManagementId: string | null } | null;
};

export type ViewerRecencyResult = {
  /** ISO — most recent signed note on this case by this viewing clinician. */
  viewerLastActivityAt: string | null;
  /** ISO — most recent signed note on this case by anyone in the viewer's division. */
  viewerDivisionLastActivityAt: string | null;
  /** ISO — most recent signed note on this case overall. */
  lastActivityAt: string | null;
};

/**
 * Compute the three recency signals for a single case from a pre-filtered
 * list of signed notes. Pass the FULL signed-note list — this helper does
 * its own per-case filter via `caseId`.
 */
export function viewerRecencyForCase(args: {
  caseId: string;
  signedNotes: SignedNoteForCaseRecency[];
  viewerOrgUserId: string | null;
  viewerDivision: string | null;
}): ViewerRecencyResult {
  const { caseId, signedNotes, viewerOrgUserId, viewerDivision } = args;
  const onCase = signedNotes.filter(
    (n) => n.encounter?.caseManagementId === caseId,
  );
  const reduceLatest = (rows: SignedNoteForCaseRecency[]): Date | null =>
    rows.reduce<Date | null>((best, n) => {
      if (!n.signedAt) return best;
      return !best || n.signedAt > best ? n.signedAt : best;
    }, null);

  const viewerRows = viewerOrgUserId
    ? onCase.filter((n) => n.clinicianOrgUserId === viewerOrgUserId)
    : [];
  const viewerDivRows = viewerDivision
    ? onCase.filter((n) => n.division === viewerDivision)
    : [];

  return {
    viewerLastActivityAt: reduceLatest(viewerRows)?.toISOString() ?? null,
    viewerDivisionLastActivityAt: reduceLatest(viewerDivRows)?.toISOString() ?? null,
    lastActivityAt: reduceLatest(onCase)?.toISOString() ?? null,
  };
}
