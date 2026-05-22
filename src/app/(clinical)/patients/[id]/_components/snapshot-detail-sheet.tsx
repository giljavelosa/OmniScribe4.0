'use client';

import type { PatientSnapshotStrip as PatientSnapshotStripData } from '@/lib/snapshots/types';
import { PatientSnapshotStrip } from '@/components/patients/snapshot-strip';
import { ChartDetailSheet } from './chart-detail-sheet';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  snapshotStrip: PatientSnapshotStripData | null;
};

/**
 * SnapshotDetailSheet — drill-down for the "Snapshot" cockpit tile.
 * Renders the existing PatientSnapshotStrip inside the sheet so the
 * clinician can inspect measures, trend arrows, and source notes without
 * navigating away.
 *
 * Read-only, Phase 1 (Sprint 0.9). Edit overrides inside the strip are
 * available (per-measure pencil) since they were already gated + audited.
 */
export function SnapshotDetailSheet({ open, onOpenChange, patientId, snapshotStrip }: Props) {
  return (
    <ChartDetailSheet open={open} onOpenChange={onOpenChange} title="Snapshot measures">
      <PatientSnapshotStrip patientId={patientId} strip={snapshotStrip} />
    </ChartDetailSheet>
  );
}
