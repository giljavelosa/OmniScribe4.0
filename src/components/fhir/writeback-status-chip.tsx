import type { FhirWriteBackStatus, FhirWriteBackFailureKind } from '@prisma/client';

import { StatusBadge } from '@/components/ui/status-badge';

/**
 * Sprint 0.17 — write-back status chip.
 *
 * `<StatusBadge>` wrapper rendered on each case row (cases-panel) when
 * the row carries a non-terminal write-back proposal. Maps the
 * `FhirWriteBackStatus` × `FhirWriteBackFailureKind` to the right
 * variant + label per the spec UI section.
 *
 * Returns null for terminal-silent states (`SUCCEEDED`, `CANCELLED`)
 * so the chart-side row stays uncluttered after the write completes.
 *
 * Anti-regression rule 23: no hardcoded status colors — every variant
 * threads through `<StatusBadge>`.
 */
export type WritebackStatusChipProps = {
  status: FhirWriteBackStatus;
  failureKind?: FhirWriteBackFailureKind | null;
  /** Optional click handler. When provided on FAILED + TRANSIENT, the
   *  chip renders as a button so the cases-panel can open the retry
   *  confirm dialog. */
  onAction?: () => void;
};

export function WritebackStatusChip({
  status,
  failureKind,
  onAction,
}: WritebackStatusChipProps) {
  // Terminal-silent states — once the write completes (or is cancelled)
  // the chip falls off the row. The next read sync (Sprint 0.16) is
  // the canonical verification point for the SUCCEEDED state.
  if (status === 'SUCCEEDED' || status === 'CANCELLED') return null;

  if (status === 'PROPOSED') {
    return (
      <StatusBadge variant="neutral" noIcon>
        EHR sync pending
      </StatusBadge>
    );
  }
  if (status === 'APPROVED' || status === 'EXECUTING') {
    return (
      <StatusBadge variant="info" noIcon>
        EHR write queued
      </StatusBadge>
    );
  }
  // status === 'FAILED'
  if (failureKind === 'TRANSIENT') {
    return (
      <button
        type="button"
        onClick={onAction}
        className="inline-flex"
        aria-label="Retry EHR write"
      >
        <StatusBadge variant="warning" noIcon>
          EHR write failed — retry
        </StatusBadge>
      </button>
    );
  }
  // PERMANENT + CONFLICT both surface as "blocked — review" with the
  // danger variant. The detail-drawer distinguishes the two.
  return (
    <button
      type="button"
      onClick={onAction}
      className="inline-flex"
      aria-label="Review blocked EHR write"
    >
      <StatusBadge variant="danger" noIcon>
        EHR write blocked — review
      </StatusBadge>
    </button>
  );
}
