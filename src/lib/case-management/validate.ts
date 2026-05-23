import { CaseManagementStatus, Division } from '@prisma/client';

/**
 * "Open" = bindable to a new encounter. Includes PENDING_ROUTER so the
 * Sprint 0.13 auto-create-case-and-bind path stays valid; the router worker
 * promotes the case to ACTIVE (or rebinds to a different case + deletes the
 * pending row) when the clinician confirms at review time.
 */
export function assertCaseIsOpen(status: CaseManagementStatus): void {
  if (
    status !== CaseManagementStatus.ACTIVE &&
    status !== CaseManagementStatus.PENDING_ROUTER
  ) {
    throw new Error('case_not_active');
  }
}

/** Episode linkage on encounters is allowed only for REHAB notes. */
export function mayLinkEpisodeOnEncounter(args: {
  noteDivision: Division;
  episodeOfCareId: string | null | undefined;
}): boolean {
  if (!args.episodeOfCareId) return true;
  return args.noteDivision === Division.REHAB;
}
