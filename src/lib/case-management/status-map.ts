import { CaseManagementStatus, EpisodeStatus } from '@prisma/client';

/** Map legacy episode status to case-management status during migration/backfill. */
export function episodeStatusToCaseStatus(status: EpisodeStatus): CaseManagementStatus {
  switch (status) {
    case 'DISCHARGED':
      return CaseManagementStatus.CLOSED;
    case 'CANCELLED':
      return CaseManagementStatus.CANCELLED;
    default:
      return CaseManagementStatus.ACTIVE;
  }
}
