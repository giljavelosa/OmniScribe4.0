'use client';

import { useCallback, useEffect, useState } from 'react';
import { Upload, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { ChartDetailSheet } from './chart-detail-sheet';
import { ExternalContextAddDialog } from './external-context-add-dialog';
import { ExternalContextDetailSheet } from './external-context-detail-sheet';
import {
  currentProcessingBatch,
  documentBatchLine,
  documentPageTextLine,
  type ExternalContextSummary,
  type ExternalContextSource,
} from './external-context-section';

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
  canUploadRecords?: boolean;
  initialDetailId?: string | null;
  onInitialDetailConsumed?: () => void;
};

/**
 * PriorRecordsSheet — drill-down for the Documents & outside records cockpit
 * tile.
 * External-context records view. Tapping a reviewable record opens the
 * existing ExternalContextDetailSheet as a level-2 sheet (within the allowed
 * nesting cap of 2), and the sheet owns the add/prior-document workflow now
 * that external records have moved out of the Overview tab.
 *
 * Phase 1, Sprint 0.9.
 */
export function PriorRecordsSheet({
  open,
  onOpenChange,
  patientId,
  items,
  canUploadRecords = true,
  initialDetailId = null,
  onInitialDetailConsumed,
}: Props) {
  const [refreshedRecords, setRefreshedRecords] = useState<{
    patientId: string;
    data: ExternalContextSummary[];
  } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ExternalContextSummary | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const records = refreshedRecords?.patientId === patientId ? refreshedRecords.data : items;

  useEffect(() => {
    if (!initialDetailId) return;
    // Deep-linked document source chips intentionally open the matching
    // document review sheet when the records drawer mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetailId(initialDetailId);
    onInitialDetailConsumed?.();
  }, [initialDetailId, onInitialDetailConsumed]);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/patients/${patientId}/external-context`, {
      cache: 'no-store',
    });
    if (!res.ok) return;
    const body = (await res.json()) as { data: ExternalContextSummary[] };
    setRefreshedRecords({ patientId, data: body.data });
  }, [patientId]);

  useEffect(() => {
    const hasPending = records.some((r) =>
      r.status === 'PENDING_TRANSCRIPTION' || r.status === 'PENDING_EXTRACTION',
    );
    if (!hasPending) return;
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [records, refresh]);

  const cancelExtraction = useCallback(async () => {
    if (!cancelTarget || cancelPending) return;
    setCancelPending(true);
    setCancelError(null);
    try {
      const res = await fetch(
        `/api/patients/${patientId}/external-context/${cancelTarget.id}/discard`,
        { method: 'POST' },
      );
      if (!res.ok) {
        throw new Error('cancel_failed');
      }
      if (detailId === cancelTarget.id) setDetailId(null);
      setCancelTarget(null);
      await refresh();
    } catch {
      setCancelError('The extraction could not be canceled. Try again or refresh the page.');
    } finally {
      setCancelPending(false);
    }
  }, [cancelPending, cancelTarget, detailId, patientId, refresh]);

  return (
    <>
      <ChartDetailSheet open={open} onOpenChange={onOpenChange} title="Documents & outside records">
        {canUploadRecords ? (
          <div className="mb-3 flex justify-end">
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Upload className="size-4" aria-hidden />
              Upload document
            </Button>
          </div>
        ) : null}
        {records.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/25 p-4">
            <div className="flex items-start gap-3">
              <Upload className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div className="space-y-2">
                <div>
                  <p className="text-sm font-medium text-foreground">No documents uploaded</p>
                  <p className="text-sm text-muted-foreground">
                    Upload outside records, referral packets, labs, imaging reports, photos, or PDFs for review.
                  </p>
                </div>
                {canUploadRecords ? (
                  <Button size="sm" onClick={() => setAddOpen(true)}>
                    <Upload className="size-4" aria-hidden />
                    Upload document
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border -mx-1">
            {records.map((item) => (
              <PriorRecordRow
                key={item.id}
                item={item}
                onOpen={() => setDetailId(item.id)}
                onCancel={canCancelDocumentExtraction(item) ? () => {
                  setCancelError(null);
                  setCancelTarget(item);
                } : undefined}
              />
            ))}
          </ul>
        )}
      </ChartDetailSheet>

      {canUploadRecords ? (
        <ExternalContextAddDialog
          patientId={patientId}
          episodeChoices={[]}
          open={addOpen}
          onOpenChange={setAddOpen}
          initialMode="document"
          onAdded={() => {
            setAddOpen(false);
            void refresh();
          }}
        />
      ) : null}

      {/* Level-2 sheet — allowed by nesting cap (max 2 deep) */}
      {detailId && (
        <ExternalContextDetailSheet
          patientId={patientId}
          externalContextId={detailId}
          open={!!detailId}
          onChanged={refresh}
          onOpenChange={(o) => { if (!o) setDetailId(null); }}
        />
      )}

      <AlertDialog
        open={!!cancelTarget}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !cancelPending) {
            setCancelTarget(null);
            setCancelError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this extraction?</AlertDialogTitle>
            <AlertDialogDescription>
              This hides the document from the review list and stops queued extraction work. Original files remain
              retained in private storage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {cancelError ? (
            <StatusBanner variant="danger">{cancelError}</StatusBanner>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelPending}>Keep processing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancelPending}
              onClick={(event) => {
                event.preventDefault();
                void cancelExtraction();
              }}
            >
              {cancelPending ? 'Canceling...' : 'Cancel extraction'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PriorRecordRow({
  item,
  onOpen,
  onCancel,
}: {
  item: ExternalContextSummary;
  onOpen: () => void;
  onCancel?: () => void;
}) {
  const dateLabel = item.dateOfRecord.slice(0, 10);
  const isPending =
    item.status === 'PENDING_TRANSCRIPTION' ||
    (item.status === 'PENDING_EXTRACTION' && item.mediaKind !== 'DOCUMENT');
  const mediaLabel = item.mediaKind === 'DOCUMENT'
    ? 'Document'
    : item.hasAudio
      ? 'Audio + transcript'
      : 'Transcript only';
  const batchLine = item.mediaKind === 'DOCUMENT' ? documentBatchLine(item) : null;

  return (
    <li className="py-3 px-1">
      <div className="flex items-start gap-2 rounded-md px-2 py-2 -mx-2 hover:bg-muted/60">
        <button
          type="button"
          onClick={onOpen}
          disabled={isPending}
          className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
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
                {mediaLabel}
                <span className="mx-2">·</span>
                added {item.addedAt.slice(0, 10)}
                {item.mediaKind === 'DOCUMENT' && typeof item.indexedPageCount === 'number' ? (
                  <>
                    <span className="mx-2">·</span>
                    {documentPageTextLine(item)}
                  </>
                ) : null}
                {batchLine ? (
                  <>
                    <span className="mx-2">·</span>
                    {batchLine}
                  </>
                ) : null}
              </p>
              {item.domainSummary?.domains.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {item.domainSummary.domains.slice(0, 6).map((domain) => (
                    <StatusBadge key={domain.key} variant="neutral" noIcon className="text-[10px] normal-case">
                      {domain.label}: {domain.count}
                    </StatusBadge>
                  ))}
                </div>
              ) : item.mediaKind === 'DOCUMENT' && item.verifiedAt ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Verified uploaded record. Page text is searchable by Miss Cleo when indexed.
                </p>
              ) : null}
            </div>
            <div className="shrink-0">
              <PriorRecordStatusBadge item={item} />
            </div>
          </div>
        </button>
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="shrink-0"
            aria-label="Cancel document extraction"
          >
            <XCircle className="size-4" aria-hidden />
            Cancel extraction
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function canCancelDocumentExtraction(item: ExternalContextSummary) {
  return item.mediaKind === 'DOCUMENT'
    && !item.verifiedAt
    && (item.status === 'PENDING_EXTRACTION' || item.status === 'PARTIAL_EXTRACTION_REVIEW');
}

function PriorRecordStatusBadge({ item }: { item: ExternalContextSummary }) {
  if (item.status === 'PENDING_TRANSCRIPTION') {
    return <StatusBadge variant="info" noIcon>Transcribing...</StatusBadge>;
  }
  if (item.status === 'PENDING_EXTRACTION') {
    const current = currentProcessingBatch(item);
    return (
      <StatusBadge variant="info" noIcon>
        {current
          ? `Extracting batch ${current.batchIndex + 1} of ${item.extractionBatches.length}`
          : 'Extracting...'}
      </StatusBadge>
    );
  }
  if (item.status === 'PARTIAL_EXTRACTION_REVIEW') {
    const current = item.extractionBatches.find((batch) => batch.status === 'NEEDS_REVIEW');
    return (
      <StatusBadge variant="warning" noIcon>
        {current ? `Review pages ${current.pageStart}-${current.pageEnd}` : 'Needs batch review'}
      </StatusBadge>
    );
  }
  if (item.status === 'EXTRACTED') {
    return <StatusBadge variant="warning" noIcon>Final review</StatusBadge>;
  }
  if (item.status === 'FAILED') {
    return <StatusBadge variant="danger">Transcription failed</StatusBadge>;
  }
  if (item.status === 'EXTRACTION_FAILED') {
    return <StatusBadge variant="danger">Extraction failed</StatusBadge>;
  }
  if (item.mediaKind === 'DOCUMENT' && item.verifiedAt) {
    return <StatusBadge variant="success" noIcon>Verified</StatusBadge>;
  }
  return <StatusBadge variant="success" noIcon>Ready</StatusBadge>;
}
