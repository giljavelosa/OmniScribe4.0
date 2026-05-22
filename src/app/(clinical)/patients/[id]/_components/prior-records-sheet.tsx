'use client';

import { useState } from 'react';

import { StatusBadge } from '@/components/ui/status-badge';
import { ChartDetailSheet } from './chart-detail-sheet';
import { ExternalContextDetailSheet } from './external-context-detail-sheet';
import type { ExternalContextSummary, ExternalContextSource } from './external-context-section';

const SOURCE_LABEL: Record<ExternalContextSource, string> = {
  PATIENT_SUPPLIED: 'Patient-supplied',
  OUTSIDE_PROVIDER: 'Outside provider',
  EARLIER_UNDOCUMENTED: 'Earlier undocumented visit',
  CLINICIAN_NOTES: "Clinician's notes",
  OTHER: 'Other',
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  items: ExternalContextSummary[];
};

/**
 * PriorRecordsSheet — drill-down for the "Prior records" cockpit tile.
 * Read-only view of external-context records. Tapping a ready record
 * opens the existing ExternalContextDetailSheet as a level-2 sheet
 * (within the allowed nesting cap of 2).
 *
 * No "Add prior context" button — edit actions are out of scope for
 * Phase-1 cockpit sheets (decision 2). Add remains on the Overview tab's
 * ExternalContextSection (removed from Overview, now only here as
 * reference view; the full add workflow lives on the chart itself via
 * the tile → sheet drill-down with no add action).
 *
 * Phase 1, Sprint 0.9.
 */
export function PriorRecordsSheet({ open, onOpenChange, patientId, items }: Props) {
  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <>
      <ChartDetailSheet open={open} onOpenChange={onOpenChange} title="Prior records">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No prior context records on file.</p>
        ) : (
          <ul className="divide-y divide-border -mx-1">
            {items.map((item) => (
              <PriorRecordRow
                key={item.id}
                item={item}
                onOpen={() => setDetailId(item.id)}
              />
            ))}
          </ul>
        )}
      </ChartDetailSheet>

      {/* Level-2 sheet — allowed by nesting cap (max 2 deep) */}
      {detailId && (
        <ExternalContextDetailSheet
          patientId={patientId}
          externalContextId={detailId}
          open={!!detailId}
          onOpenChange={(o) => { if (!o) setDetailId(null); }}
        />
      )}
    </>
  );
}

function PriorRecordRow({
  item,
  onOpen,
}: {
  item: ExternalContextSummary;
  onOpen: () => void;
}) {
  const dateLabel = item.dateOfRecord.slice(0, 10);
  const isPending = item.status === 'PENDING_TRANSCRIPTION';
  const isFailed = item.status === 'FAILED';

  return (
    <li className="py-3 px-1">
      <button
        type="button"
        onClick={onOpen}
        disabled={isPending}
        className="w-full text-left rounded-md px-2 py-2 -mx-2 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:hover:bg-transparent"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {dateLabel}
              <span className="mx-2 text-muted-foreground">·</span>
              {SOURCE_LABEL[item.source]}
              {item.sourceLabel ? (
                <>
                  <span className="mx-2 text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{item.sourceLabel}</span>
                </>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {item.hasAudio ? 'Audio + transcript' : 'Transcript only'}
              <span className="mx-2">·</span>
              added {item.addedAt.slice(0, 10)}
            </p>
          </div>
          <div className="shrink-0">
            {isPending ? (
              <StatusBadge variant="info" noIcon>
                Transcribing…
              </StatusBadge>
            ) : isFailed ? (
              <StatusBadge variant="danger">Transcription failed</StatusBadge>
            ) : (
              <StatusBadge variant="success" noIcon>
                Ready
              </StatusBadge>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}
