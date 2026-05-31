'use client';

import { useCallback, useEffect, useState } from 'react';
import { Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { ExternalContextAddDialog } from './external-context-add-dialog';
import { ExternalContextDetailSheet } from './external-context-detail-sheet';
import type { VerifiedDocumentDomainSummary } from '@/lib/external-context/verified-chart-facts';

export type ExternalContextSummary = {
  id: string;
  dateOfRecord: string; // ISO
  source: ExternalContextSource;
  sourceLabel: string | null;
  status: ExternalContextStatus;
  mediaKind: ExternalContextMediaKind;
  verifiedAt: string | null;
  pageCount: number | null;
  indexedPageCount?: number;
  domainSummary?: VerifiedDocumentDomainSummary | null;
  extractionBatches: ExternalContextExtractionBatchSummary[];
  addedAt: string; // ISO
  hasAudio: boolean;
  episodeOfCareId: string | null;
  addedBy: {
    orgUserId: string;
    email: string;
    name: string | null;
  };
};

export type ExternalContextSource =
  | 'PATIENT_SUPPLIED'
  | 'OUTSIDE_PROVIDER'
  | 'EARLIER_UNDOCUMENTED'
  | 'CLINICIAN_NOTES'
  | 'OTHER';

export type ExternalContextStatus =
  | 'PENDING_TRANSCRIPTION'
  | 'READY'
  | 'FAILED'
  | 'PENDING_EXTRACTION'
  | 'EXTRACTED'
  | 'EXTRACTION_FAILED'
  | 'PARTIAL_EXTRACTION_REVIEW';

export type ExternalContextMediaKind = 'PASTE' | 'AUDIO' | 'DOCUMENT';

export type ExternalContextExtractionBatchStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'NEEDS_REVIEW'
  | 'REVIEWED'
  | 'FAILED';

export type ExternalContextExtractionBatchSummary = {
  id: string;
  batchIndex: number;
  pageStart: number;
  pageEnd: number;
  status: ExternalContextExtractionBatchStatus;
  extractedAt: string | null;
  reviewedAt: string | null;
};

export type EpisodeChoice = {
  id: string;
  label: string;
};

const SOURCE_LABEL: Record<ExternalContextSource, string> = {
  PATIENT_SUPPLIED: 'Patient-supplied',
  OUTSIDE_PROVIDER: 'Outside provider',
  EARLIER_UNDOCUMENTED: 'Earlier undocumented visit',
  CLINICIAN_NOTES: "Clinician's notes",
  OTHER: 'Other',
};

/**
 * Documents and outside records section on the patient chart.
 * Server-component-friendly
 * shell: receives the initial list as a prop, then re-fetches client-side
 * after add / detail-view actions so the UI is always live.
 *
 * Spec: context/specs/external-context-upload.md §UI.
 */
export function ExternalContextSection({
  patientId,
  episodeChoices,
  initialItems,
}: {
  patientId: string;
  episodeChoices: EpisodeChoice[];
  initialItems: ExternalContextSummary[];
}) {
  const [items, setItems] = useState<ExternalContextSummary[]>(initialItems);
  const [addOpen, setAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/patients/${patientId}/external-context`, {
      cache: 'no-store',
    });
    if (!res.ok) return;
    const body = (await res.json()) as { data: ExternalContextSummary[] };
    setItems(body.data);
  }, [patientId]);

  // Re-poll every 15 s when any row is still processing — gives the user
  // live progress without WebSocket plumbing. Bails when nothing is pending.
  useEffect(() => {
    const hasPending = items.some((r) =>
      r.status === 'PENDING_TRANSCRIPTION' || r.status === 'PENDING_EXTRACTION',
    );
    if (!hasPending) return;
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [items, refresh]);

  return (
    <Card data-section-id="prior-context">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Documents &amp; outside records</CardTitle>
            <CardDescription>
              Upload referral notes, labs, imaging reports, patient photos, PDFs, or audio for review.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Upload className="size-4" aria-hidden />
            Upload document
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents uploaded. Add outside records, referral packets, labs, photos, PDFs, or audio when they arrive.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <ExternalContextRow
                key={item.id}
                item={item}
                onOpen={() => setDetailId(item.id)}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <ExternalContextAddDialog
        patientId={patientId}
        episodeChoices={episodeChoices}
        open={addOpen}
        onOpenChange={setAddOpen}
        initialMode="document"
        onAdded={() => {
          setAddOpen(false);
          void refresh();
        }}
      />
      {detailId ? (
        <ExternalContextDetailSheet
          patientId={patientId}
          externalContextId={detailId}
          open={!!detailId}
          onChanged={refresh}
          onOpenChange={(open) => {
            if (!open) setDetailId(null);
          }}
        />
      ) : null}
    </Card>
  );
}

function ExternalContextRow({
  item,
  onOpen,
}: {
  item: ExternalContextSummary;
  onOpen: () => void;
}) {
  const dateLabel = item.dateOfRecord.slice(0, 10);
  const addedAtLabel = item.addedAt.slice(0, 10);
  const addedByLabel = item.addedBy.name ?? item.addedBy.email;
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
    <li className="py-3">
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
              {mediaLabel}
              <span className="mx-2">·</span>
              added by {addedByLabel} {addedAtLabel}
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
                {item.domainSummary.domains.slice(0, 5).map((domain) => (
                  <StatusBadge key={domain.key} variant="neutral" noIcon className="text-[10px] normal-case">
                    {domain.label}: {domain.count}
                  </StatusBadge>
                ))}
              </div>
            ) : null}
          </div>
          <div className="shrink-0">
            <ExternalContextStatusBadge item={item} />
          </div>
        </div>
      </button>
    </li>
  );
}

function ExternalContextStatusBadge({ item }: { item: ExternalContextSummary }) {
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

export function currentProcessingBatch(item: ExternalContextSummary) {
  return item.extractionBatches.find((batch) => batch.status === 'PROCESSING')
    ?? item.extractionBatches.find((batch) => batch.status === 'PENDING')
    ?? null;
}

export function documentBatchLine(item: ExternalContextSummary): string | null {
  if (item.extractionBatches.length === 0) {
    return item.pageCount ? `${item.pageCount} page${item.pageCount === 1 ? '' : 's'}` : null;
  }
  const reviewed = item.extractionBatches.filter((batch) => batch.status === 'REVIEWED').length;
  const total = item.extractionBatches.length;
  const reviewedPages = item.extractionBatches
    .filter((batch) => batch.status === 'REVIEWED')
    .reduce((sum, batch) => sum + Math.max(0, batch.pageEnd - batch.pageStart + 1), 0);
  const pageTotal = Math.min(
    item.pageCount ?? item.extractionBatches[item.extractionBatches.length - 1]?.pageEnd ?? reviewedPages,
    item.extractionBatches[item.extractionBatches.length - 1]?.pageEnd ?? reviewedPages,
  );
  return `${reviewed}/${total} batches reviewed - ${reviewedPages}/${pageTotal} pages checked`;
}

export function documentPageTextLine(item: ExternalContextSummary): string {
  const indexed = item.indexedPageCount ?? 0;
  const total = item.pageCount ?? null;
  if (total && indexed > 0) {
    return `${indexed}/${total} pages indexed`;
  }
  if (indexed > 0) {
    return `${indexed} page${indexed === 1 ? '' : 's'} indexed`;
  }
  return total ? `${total} page${total === 1 ? '' : 's'} uploaded` : 'Page text not indexed';
}
