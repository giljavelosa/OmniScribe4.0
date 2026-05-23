import { CaseManagementStatus, Division } from '@prisma/client';

export function assertCaseIsOpen(status: CaseManagementStatus): void {
  if (status !== CaseManagementStatus.ACTIVE) {
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
