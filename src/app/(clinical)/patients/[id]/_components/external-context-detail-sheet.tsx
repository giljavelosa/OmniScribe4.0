'use client';

import { useEffect, useState } from 'react';
import { Copy, FileText, Plus, Trash2 } from 'lucide-react';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { Textarea } from '@/components/ui/textarea';
import {
  ExtractionJsonSchema,
  type ExtractedAllergy,
  type ExtractedDiagnosis,
  type ExtractedLab,
  type ExtractedMedication,
  type ExtractedProcedure,
  type ExtractedVital,
  type ExtractionJson,
} from '@/types/external-context-extraction';
import type {
  ExternalContextMediaKind,
  ExternalContextSource,
  ExternalContextStatus,
} from './external-context-section';

const SOURCE_LABEL: Record<ExternalContextSource, string> = {
  PATIENT_SUPPLIED: 'Patient-supplied',
  OUTSIDE_PROVIDER: 'Outside provider',
  EARLIER_UNDOCUMENTED: 'Earlier undocumented visit',
  CLINICIAN_NOTES: "Clinician's notes",
  OTHER: 'Other',
};

type ExternalContextDetail = {
  id: string;
  dateOfRecord: string;
  source: ExternalContextSource;
  sourceLabel: string | null;
  status: ExternalContextStatus;
  mediaKind: ExternalContextMediaKind;
  verifiedAt: string | null;
  addedAt: string;
  episodeOfCareId: string | null;
  transcriptClean: string;
  ocrText: string | null;
  extractionJson: unknown;
  vettedExtractionJson: unknown;
  extractionModel: string | null;
  extractedAt: string | null;
  pageCount: number | null;
  hasAudio: boolean;
  audioUrl: string | null;
  documentUrls: Array<{ key: string; mimeType: string | null; url: string | null; previewUrl?: string }>;
  extractionBatches: ExternalContextExtractionBatchDetail[];
  addedBy: {
    orgUserId: string;
    email: string;
    name: string | null;
  };
};

type ExternalContextExtractionBatchDetail = {
  id: string;
  batchIndex: number;
  pageStart: number;
  pageEnd: number;
  status: 'PENDING' | 'PROCESSING' | 'NEEDS_REVIEW' | 'REVIEWED' | 'FAILED';
  ocrText: string | null;
  extractionJson: unknown;
  vettedExtractionJson: unknown;
  extractionModel: string | null;
  extractedAt: string | null;
  reviewedAt: string | null;
  errorClass: string | null;
  errorMessage: string | null;
};

/**
 * Side-sheet detail view for a single ExternalContext row. Lazy-fetches the
 * full transcript (the list view skips it for payload size). Audio player
 * appears when hasAudio && status === READY.
 *
 * Spec: context/specs/external-context-upload.md §UI.
 */
export function ExternalContextDetailSheet({
  patientId,
  externalContextId,
  open,
  onOpenChange,
  onChanged,
}: {
  patientId: string;
  externalContextId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<ExternalContextDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [draftExtraction, setDraftExtraction] = useState<ExtractionJson | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approveMode, setApproveMode] = useState<'batch' | 'document' | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      // setState calls live inside the async IIFE so React's
      // set-state-in-effect rule doesn't trip (avoids cascading renders
      // on mount).
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/patients/${patientId}/external-context/${externalContextId}`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          throw new Error(body.error?.message ?? "Couldn't load.");
        }
        const body = (await res.json()) as { data: ExternalContextDetail };
        if (!cancelled) {
          setDetail(body.data);
          setDraftExtraction(coerceExtraction(reviewExtractionForDetail(body.data)));
          setActionError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, patientId, externalContextId]);

  useEffect(() => {
    if (!open || detail?.status !== 'PENDING_EXTRACTION') return;
    const id = setInterval(() => {
      void (async () => {
        const res = await fetch(
          `/api/patients/${patientId}/external-context/${externalContextId}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { data: ExternalContextDetail };
        setDetail(body.data);
        setDraftExtraction(coerceExtraction(reviewExtractionForDetail(body.data)));
        onChanged?.();
      })();
    }, 10_000);
    return () => clearInterval(id);
  }, [open, detail?.status, patientId, externalContextId, onChanged]);

  async function copyTranscript() {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(detail.transcriptClean);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard refused (rare; permissions). Silent: the user can still
      // select-all the textarea below.
    }
  }

  function updateDraftExtraction(patch: Partial<ExtractionJson>) {
    setDraftExtraction((current) => current ? { ...current, ...patch } : current);
  }

  function approveDocument() {
    if (!draftExtraction || actionPending) return;
    const validated = ExtractionJsonSchema.safeParse(draftExtraction);
    if (!validated.success) {
      setActionError('Fix incomplete extracted fields before approving this document.');
      return;
    }
    setActionError(null);
    setActionPending(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/patients/${patientId}/external-context/${externalContextId}/verify`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ extraction: validated.data }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          setActionError(body.error?.message ?? 'Could not verify this document.');
          setActionPending(false);
          return;
        }
        const body = (await res.json()) as {
          data: {
            status: ExternalContextStatus;
            verifiedAt: string | null;
            transcriptClean: string;
            vettedExtractionJson: unknown;
          };
        };
        setDetail((current) => current
          ? {
              ...current,
              status: body.data.status,
              verifiedAt: body.data.verifiedAt,
              transcriptClean: body.data.transcriptClean,
              vettedExtractionJson: body.data.vettedExtractionJson,
            }
          : current);
        setDraftExtraction(coerceExtraction(body.data.vettedExtractionJson));
        setApproveMode(null);
        onChanged?.();
        setActionPending(false);
      } catch {
        setActionError('Could not verify this document.');
        setActionPending(false);
      }
    })();
  }

  function approveBatch() {
    if (!detail || !draftExtraction || actionPending) return;
    const batch = activeReviewBatch(detail);
    if (!batch) {
      setActionError('No extracted batch is ready for review.');
      return;
    }
    const validated = ExtractionJsonSchema.safeParse(draftExtraction);
    if (!validated.success) {
      setActionError('Fix incomplete extracted fields before approving this batch.');
      return;
    }
    setActionError(null);
    setActionPending(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/patients/${patientId}/external-context/${externalContextId}/batches/${batch.id}/review`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ extraction: validated.data }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          setActionError(body.error?.message ?? 'Could not approve this batch.');
          setActionPending(false);
          return;
        }
        const body = (await res.json()) as {
          data: {
            status: ExternalContextStatus;
            documentComplete: boolean;
            extractionJson: unknown;
            ocrText: string | null;
          };
        };
        setDetail((current) => current
          ? {
              ...current,
              status: body.data.status,
              ocrText: body.data.ocrText ?? current.ocrText,
              extractionJson: body.data.extractionJson ?? current.extractionJson,
              extractionBatches: current.extractionBatches.map((candidate) =>
                candidate.id === batch.id
                  ? {
                      ...candidate,
                      status: 'REVIEWED',
                      vettedExtractionJson: validated.data,
                      reviewedAt: new Date().toISOString(),
                    }
                  : candidate,
              ),
            }
          : current);
        setDraftExtraction(coerceExtraction(body.data.extractionJson));
        setApproveMode(null);
        onChanged?.();
        setActionPending(false);
      } catch {
        setActionError('Could not approve this batch.');
        setActionPending(false);
      }
    })();
  }

  function discardDocument() {
    if (actionPending) return;
    setActionError(null);
    setActionPending(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/patients/${patientId}/external-context/${externalContextId}/discard`,
          { method: 'POST' },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          setActionError(body.error?.message ?? 'Could not discard this document.');
          setActionPending(false);
          return;
        }
        setDiscardOpen(false);
        onChanged?.();
        onOpenChange(false);
        setActionPending(false);
      } catch {
        setActionError('Could not discard this document.');
        setActionPending(false);
      }
    })();
  }

  const activeBatchForDialog = detail ? activeReviewBatch(detail) : null;
  const approveTitle = approveMode === 'batch' && activeBatchForDialog
    ? `Approve pages ${activeBatchForDialog.pageStart}-${activeBatchForDialog.pageEnd}?`
    : 'Verify this document?';
  const approveDescription = approveMode === 'batch'
    ? 'OmniScribe will save your corrections for this page batch, then start the next batch if more pages remain.'
    : 'Verified document content becomes available to briefs and Miss Cleo as patient context.';
  const approveAction = approveMode === 'batch' ? approveBatch : approveDocument;
  const approveActionLabel = actionPending
    ? (approveMode === 'batch' ? 'Approving...' : 'Verifying...')
    : (approveMode === 'batch' ? 'Approve pages' : 'Confirm verification');
  const isCancellingExtraction = detail?.status === 'PENDING_EXTRACTION' || detail?.status === 'PARTIAL_EXTRACTION_REVIEW';
  const discardTitle = isCancellingExtraction ? 'Cancel this extraction?' : 'Discard this document?';
  const discardDescription = isCancellingExtraction
    ? 'Processing stops for this document and the row is hidden from the chart. Original files remain retained in private storage.'
    : 'The row is hidden from the chart. Original files remain retained in private storage.';
  const discardActionLabel = isCancellingExtraction ? 'Cancel extraction' : 'Discard document';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{detail?.mediaKind === 'DOCUMENT' ? 'Document record' : 'Outside record'}</SheetTitle>
          <SheetDescription>
            {detail ? (
              <>
                {detail.dateOfRecord.slice(0, 10)} · {SOURCE_LABEL[detail.source]}
                {detail.sourceLabel ? ` · ${detail.sourceLabel}` : ''}
              </>
            ) : (
              <>Loading…</>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading transcript…</p>
          ) : error ? (
            <p className="text-sm text-[var(--status-danger-fg)]">{error}</p>
          ) : detail ? (
            <>
              <div className="flex flex-wrap gap-2 items-center">
                <ExternalContextDetailStatusBadge detail={detail} />
                <span className="text-xs text-muted-foreground">
                  added by {detail.addedBy.name ?? detail.addedBy.email} on{' '}
                  {detail.addedAt.slice(0, 10)}
                </span>
              </div>

              {detail.hasAudio && detail.audioUrl && detail.status === 'READY' ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Source audio</p>
                  <audio controls src={detail.audioUrl} className="w-full" />
                </div>
              ) : null}

              {detail.mediaKind === 'DOCUMENT' ? (
                <DocumentVettingPanel
                  detail={detail}
                  draftExtraction={draftExtraction}
                  onDraftChange={updateDraftExtraction}
                  onApprove={(mode) => setApproveMode(mode)}
                  onDiscard={() => setDiscardOpen(true)}
                  pending={actionPending}
                />
              ) : null}

              {actionError ? <StatusBanner variant="danger">{actionError}</StatusBanner> : null}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Transcript</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={copyTranscript}
                    disabled={!detail.transcriptClean}
                  >
                    <Copy className="size-3.5" aria-hidden />
                    {copied ? 'Copied' : 'Copy transcript'}
                  </Button>
                </div>
                {detail.transcriptClean ? (
                  <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 text-sm font-mono">
                    {detail.transcriptClean}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Transcript is empty.
                    {detail.status === 'PENDING_TRANSCRIPTION'
                      ? ' Soniox is still processing the audio.'
                      : detail.status === 'PENDING_EXTRACTION'
                        ? ' Document extraction is processing the next batch.'
                        : detail.status === 'PARTIAL_EXTRACTION_REVIEW'
                          ? ' Review the extracted batch before the next batch can process.'
                          : detail.status === 'EXTRACTED'
                            ? ' Document extraction needs clinician review before it can feed context.'
                            : detail.status === 'EXTRACTION_FAILED'
                              ? ' Document extraction failed. The original file remains retained.'
                              : ''}
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>
      </SheetContent>

      <AlertDialog
        open={approveMode !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setApproveMode(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{approveTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {approveDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                approveAction();
              }}
              disabled={actionPending || !draftExtraction}
            >
              {approveActionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {discardDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                discardDocument();
              }}
              disabled={actionPending}
            >
              {actionPending ? 'Working...' : discardActionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

function ExternalContextDetailStatusBadge({ detail }: { detail: ExternalContextDetail }) {
  if (detail.status === 'PENDING_TRANSCRIPTION') {
    return <StatusBadge variant="info" noIcon>Transcribing...</StatusBadge>;
  }
  if (detail.status === 'PENDING_EXTRACTION') {
    const current = currentProcessingBatch(detail);
    return (
      <StatusBadge variant="info" noIcon>
        {current
          ? `Extracting batch ${current.batchIndex + 1} of ${detail.extractionBatches.length}`
          : 'Extracting...'}
      </StatusBadge>
    );
  }
  if (detail.status === 'PARTIAL_EXTRACTION_REVIEW') {
    const current = activeReviewBatch(detail);
    return (
      <StatusBadge variant="warning" noIcon>
        {current ? `Review pages ${current.pageStart}-${current.pageEnd}` : 'Needs batch review'}
      </StatusBadge>
    );
  }
  if (detail.status === 'EXTRACTED') {
    return <StatusBadge variant="warning" noIcon>Final review</StatusBadge>;
  }
  if (detail.status === 'FAILED') {
    return <StatusBadge variant="danger">Transcription failed</StatusBadge>;
  }
  if (detail.status === 'EXTRACTION_FAILED') {
    return <StatusBadge variant="danger">Extraction failed</StatusBadge>;
  }
  if (detail.mediaKind === 'DOCUMENT' && detail.verifiedAt) {
    return <StatusBadge variant="success" noIcon>Verified</StatusBadge>;
  }
  return <StatusBadge variant="success" noIcon>Ready</StatusBadge>;
}

function DocumentVettingPanel({
  detail,
  draftExtraction,
  onDraftChange,
  onApprove,
  onDiscard,
  pending,
}: {
  detail: ExternalContextDetail;
  draftExtraction: ExtractionJson | null;
  onDraftChange: (patch: Partial<ExtractionJson>) => void;
  onApprove: (mode: 'batch' | 'document') => void;
  onDiscard: () => void;
  pending: boolean;
}) {
  const isVerifiedDocument = detail.mediaKind === 'DOCUMENT' && !!detail.verifiedAt;
  const activeBatch = activeReviewBatch(detail);
  const canApproveBatch =
    detail.status === 'PARTIAL_EXTRACTION_REVIEW' && !!activeBatch && !detail.verifiedAt && !!draftExtraction;
  const canApproveDocument = detail.status === 'EXTRACTED' && !detail.verifiedAt && !!draftExtraction;
  const canDiscardDocument = !detail.verifiedAt && (
    detail.status === 'PENDING_EXTRACTION' ||
    detail.status === 'PARTIAL_EXTRACTION_REVIEW' ||
    detail.status === 'EXTRACTED' ||
    detail.status === 'EXTRACTION_FAILED'
  );
  const discardLabel = detail.status === 'PENDING_EXTRACTION' || detail.status === 'PARTIAL_EXTRACTION_REVIEW'
    ? 'Cancel extraction'
    : 'Discard';
  const canEdit = canApproveBatch || canApproveDocument;
  const progressLine = documentProgressLine(detail);
  const panelTitle = canApproveBatch && activeBatch
    ? `Batch review: pages ${activeBatch.pageStart}-${activeBatch.pageEnd}`
    : isVerifiedDocument
      ? 'Verified document'
      : canApproveDocument
        ? 'Final document review'
        : 'Document review';
  const reviewHelperText = isVerifiedDocument
    ? 'This document has been finalized by clinician verification and is available to Miss Cleo and briefs.'
    : 'Compare the source, OCR, and extracted fields before approving.';
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{panelTitle}</p>
          <p className="text-xs text-muted-foreground">
            {reviewHelperText}
          </p>
          {progressLine ? (
            <p className="mt-1 text-xs text-muted-foreground">{progressLine}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          {canDiscardDocument ? (
            <Button variant="outline" size="sm" onClick={onDiscard} disabled={pending}>
              {discardLabel}
            </Button>
          ) : null}
          {canApproveBatch && activeBatch ? (
            <Button size="sm" onClick={() => onApprove('batch')} disabled={pending}>
              {pending ? 'Approving...' : 'Approve batch'}
            </Button>
          ) : null}
          {canApproveDocument ? (
            <Button size="sm" onClick={() => onApprove('document')} disabled={pending}>
              {pending ? 'Verifying...' : 'Verify document'}
            </Button>
          ) : null}
        </div>
      </div>

      {isVerifiedDocument ? (
        <StatusBanner variant="success">
          Document verified. The extracted fields and page text are now final for downstream chart context.
        </StatusBanner>
      ) : null}

      {detail.status === 'PENDING_EXTRACTION' ? (
        <StatusBanner variant="info">
          OmniScribe is processing the next page batch. The document pauses for review after each batch before continuing.
        </StatusBanner>
      ) : null}

      {detail.documentUrls.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Source document</p>
          <div className="space-y-2">
            {detail.documentUrls.map((doc, index) => (
              <SourceDocumentPreview
                key={doc.key}
                doc={doc}
                index={index}
                preferredPage={activeReviewBatch(detail)?.pageStart ?? firstSourcePage(draftExtraction) ?? 1}
              />
            ))}
          </div>
        </div>
      ) : null}

      {detail.ocrText ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">OCR text</p>
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 text-sm font-mono">
            {detail.ocrText}
          </pre>
        </div>
      ) : null}

      {draftExtraction ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="ec-vet-summary">Extracted summary</Label>
            <Textarea
              id="ec-vet-summary"
              value={draftExtraction.summary}
              onChange={(e) => onDraftChange({ summary: e.target.value })}
              rows={3}
              disabled={!canEdit}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ec-vet-date">Document date guess</Label>
              <Input
                id="ec-vet-date"
                value={draftExtraction.documentDateGuess ?? ''}
                onChange={(e) => onDraftChange({ documentDateGuess: e.target.value.trim() || null })}
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ec-vet-notes">Review notes</Label>
              <Input
                id="ec-vet-notes"
                value={draftExtraction.extractionNotes ?? ''}
                onChange={(e) => onDraftChange({ extractionNotes: e.target.value.trim() || null })}
                disabled={!canEdit}
              />
            </div>
          </div>
          <ExtractionArrayEditors
            extraction={draftExtraction}
            disabled={!canEdit}
            defaultSourcePage={activeBatch?.pageStart ?? 1}
            pageCount={detail.pageCount}
            onChange={onDraftChange}
          />
          <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
            <span>Diagnoses: {draftExtraction.diagnoses.length}</span>
            <span>Medications: {draftExtraction.medications.length}</span>
            <span>Labs: {draftExtraction.labs.length}</span>
            <span>Allergies: {draftExtraction.allergies.length}</span>
            <span>Vitals: {draftExtraction.vitals.length}</span>
            <span>Procedures: {draftExtraction.procedures.length}</span>
          </div>
        </div>
      ) : (
        <StatusBanner variant="warning">
          Extraction payload is not available for review.
        </StatusBanner>
      )}
    </div>
  );
}

function SourceDocumentPreview({
  doc,
  index,
  preferredPage,
}: {
  doc: { key: string; mimeType: string | null; url: string | null; previewUrl?: string };
  index: number;
  preferredPage: number;
}) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const previewUrl = doc.previewUrl ?? doc.url;
  const openUrl = previewUrl ?? doc.url;
  const isImage = doc.mimeType?.startsWith('image/') ?? false;
  const isPdf = doc.mimeType === 'application/pdf';
  const pdfUrl = previewUrl && isPdf ? `${previewUrl}#page=${Math.max(1, preferredPage)}` : previewUrl;
  const showMissingPreview = !previewUrl || (isImage && previewFailed);

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <FileText className="size-3.5" aria-hidden />
        <span>File {index + 1}</span>
        {openUrl ? (
          <a href={openUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
            Open source
          </a>
        ) : null}
      </div>
      {previewUrl && isImage && !previewFailed ? (
        <div className="rounded-md border border-border bg-slate-100 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt={`Source document ${index + 1}`}
            className="mx-auto max-h-[32rem] max-w-full rounded-sm border border-border bg-white object-contain shadow-sm"
            onError={() => setPreviewFailed(true)}
          />
        </div>
      ) : null}
      {pdfUrl && isPdf && !previewFailed ? (
        <iframe
          title={`Source PDF ${index + 1}`}
          src={pdfUrl}
          className="h-[32rem] w-full rounded-md border border-border bg-background"
        />
      ) : null}
      {showMissingPreview ? (
        <div className="rounded-md border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
          Source preview is unavailable for this local record. The extracted OCR text is still shown below, but the original uploaded file is not available in local storage.
        </div>
      ) : null}
      {previewUrl && !isImage && !isPdf ? (
        <div className="rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">
          This file type cannot be previewed inline. Use Open source to view the original document.
        </div>
      ) : null}
    </div>
  );
}

function firstSourcePage(extraction: ExtractionJson | null) {
  if (!extraction) return null;
  const item = [
    ...extraction.diagnoses,
    ...extraction.medications,
    ...extraction.allergies,
    ...extraction.labs,
    ...extraction.vitals,
    ...extraction.procedures,
  ].find((candidate) => Number.isInteger(candidate.sourcePage) && candidate.sourcePage > 0);
  return item?.sourcePage ?? null;
}

function ExtractionArrayEditors({
  extraction,
  disabled,
  defaultSourcePage,
  pageCount,
  onChange,
}: {
  extraction: ExtractionJson;
  disabled: boolean;
  defaultSourcePage: number;
  pageCount: number | null;
  onChange: (patch: Partial<ExtractionJson>) => void;
}) {
  return (
    <div className="space-y-4">
      <EditableGroup
        title="Diagnoses"
        onAdd={() => onChange({ diagnoses: [...extraction.diagnoses, blankDiagnosis(defaultSourcePage)] })}
        disabled={disabled}
      >
        {extraction.diagnoses.map((item, index) => (
          <div key={index} className="rounded-md border border-border bg-muted/20 p-2 space-y-2">
            <div className="grid gap-2 md:grid-cols-[1fr_8rem_7rem_auto]">
              <Input
                aria-label={`Diagnosis ${index + 1}`}
                value={item.text}
                onChange={(e) => updateArrayItem(extraction.diagnoses, index, { text: e.target.value }, (next) => onChange({ diagnoses: next }))}
                disabled={disabled}
              />
              <Input
                aria-label={`Diagnosis ${index + 1} ICD hint`}
                value={item.icdHint ?? ''}
                onChange={(e) => updateArrayItem(extraction.diagnoses, index, { icdHint: e.target.value.trim() || null }, (next) => onChange({ diagnoses: next }))}
                placeholder="ICD hint"
                disabled={disabled}
              />
              <SelectLike
                ariaLabel={`Diagnosis ${index + 1} status`}
                value={item.status}
                values={['active', 'historical', 'resolved', 'suspected', 'ruled_out', 'unknown']}
                onChange={(value) => updateArrayItem(extraction.diagnoses, index, { status: value as ExtractedDiagnosis['status'] }, (next) => onChange({ diagnoses: next }))}
                disabled={disabled}
              />
              <RemoveButton
                label={`Remove diagnosis ${index + 1}`}
                disabled={disabled}
                onClick={() => onChange({ diagnoses: removeArrayItem(extraction.diagnoses, index) })}
              />
            </div>
            <ProvenanceEditor
              item={item}
              disabled={disabled}
              pageCount={pageCount}
              onChange={(patch) => updateArrayItem(extraction.diagnoses, index, patch, (next) => onChange({ diagnoses: next }))}
            />
          </div>
        ))}
      </EditableGroup>

      <EditableGroup
        title="Medications"
        onAdd={() => onChange({ medications: [...extraction.medications, blankMedication(defaultSourcePage)] })}
        disabled={disabled}
      >
        {extraction.medications.map((item, index) => (
          <div key={index} className="rounded-md border border-border bg-muted/20 p-2 space-y-2">
            <div className="grid gap-2 md:grid-cols-[1fr_7rem_7rem_8rem_auto]">
              <Input
                aria-label={`Medication ${index + 1}`}
                value={item.name}
                onChange={(e) => updateArrayItem(extraction.medications, index, { name: e.target.value }, (next) => onChange({ medications: next }))}
                disabled={disabled}
              />
              <Input
                aria-label={`Medication ${index + 1} dose`}
                value={item.dose ?? ''}
                onChange={(e) => updateArrayItem(extraction.medications, index, { dose: e.target.value.trim() || null }, (next) => onChange({ medications: next }))}
                placeholder="Dose"
                disabled={disabled}
              />
              <Input
                aria-label={`Medication ${index + 1} route`}
                value={item.route ?? ''}
                onChange={(e) => updateArrayItem(extraction.medications, index, { route: e.target.value.trim() || null }, (next) => onChange({ medications: next }))}
                placeholder="Route"
                disabled={disabled}
              />
              <Input
                aria-label={`Medication ${index + 1} frequency`}
                value={item.frequency ?? ''}
                onChange={(e) => updateArrayItem(extraction.medications, index, { frequency: e.target.value.trim() || null }, (next) => onChange({ medications: next }))}
                placeholder="Frequency"
                disabled={disabled}
              />
              <RemoveButton
                label={`Remove medication ${index + 1}`}
                disabled={disabled}
                onClick={() => onChange({ medications: removeArrayItem(extraction.medications, index) })}
              />
            </div>
            <div className="max-w-48">
              <SelectLike
                ariaLabel={`Medication ${index + 1} status`}
                value={item.status}
                values={['current', 'discontinued', 'historical', 'planned', 'unknown']}
                onChange={(value) => updateArrayItem(extraction.medications, index, { status: value as ExtractedMedication['status'] }, (next) => onChange({ medications: next }))}
                disabled={disabled}
              />
            </div>
            <ProvenanceEditor
              item={item}
              disabled={disabled}
              pageCount={pageCount}
              onChange={(patch) => updateArrayItem(extraction.medications, index, patch, (next) => onChange({ medications: next }))}
            />
          </div>
        ))}
      </EditableGroup>

      <EditableGroup
        title="Allergies"
        onAdd={() => onChange({ allergies: [...extraction.allergies, blankAllergy(defaultSourcePage)] })}
        disabled={disabled}
      >
        {extraction.allergies.map((item, index) => (
          <div key={index} className="rounded-md border border-border bg-muted/20 p-2 space-y-2">
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_8rem_auto]">
              <Input
                aria-label={`Allergy ${index + 1}`}
                value={item.substance}
                onChange={(e) => updateArrayItem(extraction.allergies, index, { substance: e.target.value }, (next) => onChange({ allergies: next }))}
                disabled={disabled}
              />
              <Input
                aria-label={`Allergy ${index + 1} reaction`}
                value={item.reaction ?? ''}
                onChange={(e) => updateArrayItem(extraction.allergies, index, { reaction: e.target.value.trim() || null }, (next) => onChange({ allergies: next }))}
                placeholder="Reaction"
                disabled={disabled}
              />
              <SelectLike
                ariaLabel={`Allergy ${index + 1} severity`}
                value={item.severity ?? 'unknown'}
                values={['mild', 'moderate', 'severe', 'unknown']}
                onChange={(value) => updateArrayItem(extraction.allergies, index, { severity: value as ExtractedAllergy['severity'] }, (next) => onChange({ allergies: next }))}
                disabled={disabled}
              />
              <RemoveButton
                label={`Remove allergy ${index + 1}`}
                disabled={disabled}
                onClick={() => onChange({ allergies: removeArrayItem(extraction.allergies, index) })}
              />
            </div>
            <ProvenanceEditor
              item={item}
              disabled={disabled}
              pageCount={pageCount}
              onChange={(patch) => updateArrayItem(extraction.allergies, index, patch, (next) => onChange({ allergies: next }))}
            />
          </div>
        ))}
      </EditableGroup>

      <EditableGroup
        title="Labs"
        onAdd={() => onChange({ labs: [...extraction.labs, blankLab(defaultSourcePage)] })}
        disabled={disabled}
      >
        {extraction.labs.map((item, index) => (
          <div key={index} className="rounded-md border border-border bg-muted/20 p-2 space-y-2">
            <div className="grid gap-2 md:grid-cols-[1fr_8rem_6rem_8rem_auto]">
              <Input
                aria-label={`Lab ${index + 1}`}
                value={item.name}
                onChange={(e) => updateArrayItem(extraction.labs, index, { name: e.target.value }, (next) => onChange({ labs: next }))}
                disabled={disabled}
              />
              <Input
                aria-label={`Lab ${index + 1} value`}
                value={item.value}
                onChange={(e) => updateArrayItem(extraction.labs, index, { value: e.target.value }, (next) => onChange({ labs: next }))}
                disabled={disabled}
              />
              <Input
                aria-label={`Lab ${index + 1} unit`}
                value={item.unit ?? ''}
                onChange={(e) => updateArrayItem(extraction.labs, index, { unit: e.target.value.trim() || null }, (next) => onChange({ labs: next }))}
                placeholder="Unit"
                disabled={disabled}
              />
              <Input
                aria-label={`Lab ${index + 1} date`}
                value={item.collectedDate ?? ''}
                onChange={(e) => updateArrayItem(extraction.labs, index, { collectedDate: e.target.value.trim() || null }, (next) => onChange({ labs: next }))}
                placeholder="Date"
                disabled={disabled}
              />
              <RemoveButton
                label={`Remove lab ${index + 1}`}
                disabled={disabled}
                onClick={() => onChange({ labs: removeArrayItem(extraction.labs, index) })}
              />
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                aria-label={`Lab ${index + 1} reference range`}
                value={item.referenceRange ?? ''}
                onChange={(e) => updateArrayItem(extraction.labs, index, { referenceRange: e.target.value.trim() || null }, (next) => onChange({ labs: next }))}
                placeholder="Reference range"
                disabled={disabled}
              />
              <SelectLike
                ariaLabel={`Lab ${index + 1} abnormal flag`}
                value={item.abnormalFlag ?? 'unknown'}
                values={['normal', 'high', 'low', 'abnormal', 'critical', 'unknown']}
                onChange={(value) => updateArrayItem(extraction.labs, index, { abnormalFlag: value as ExtractedLab['abnormalFlag'] }, (next) => onChange({ labs: next }))}
                disabled={disabled}
              />
            </div>
            <ProvenanceEditor
              item={item}
              disabled={disabled}
              pageCount={pageCount}
              onChange={(patch) => updateArrayItem(extraction.labs, index, patch, (next) => onChange({ labs: next }))}
            />
          </div>
        ))}
      </EditableGroup>

      <EditableGroup
        title="Vitals"
        onAdd={() => onChange({ vitals: [...extraction.vitals, blankVital(defaultSourcePage)] })}
        disabled={disabled}
      >
        {extraction.vitals.map((item, index) => (
          <div key={index} className="rounded-md border border-border bg-muted/20 p-2 space-y-2">
            <div className="grid gap-2 md:grid-cols-[1fr_8rem_6rem_8rem_auto]">
              <Input
                aria-label={`Vital ${index + 1}`}
                value={item.type}
                onChange={(e) => updateArrayItem(extraction.vitals, index, { type: e.target.value }, (next) => onChange({ vitals: next }))}
                disabled={disabled}
              />
              <Input
                aria-label={`Vital ${index + 1} value`}
                value={item.value}
                onChange={(e) => updateArrayItem(extraction.vitals, index, { value: e.target.value }, (next) => onChange({ vitals: next }))}
                disabled={disabled}
              />
              <Input
                aria-label={`Vital ${index + 1} unit`}
                value={item.unit ?? ''}
                onChange={(e) => updateArrayItem(extraction.vitals, index, { unit: e.target.value.trim() || null }, (next) => onChange({ vitals: next }))}
                placeholder="Unit"
                disabled={disabled}
              />
              <Input
                aria-label={`Vital ${index + 1} date`}
                value={item.measuredDate ?? ''}
                onChange={(e) => updateArrayItem(extraction.vitals, index, { measuredDate: e.target.value.trim() || null }, (next) => onChange({ vitals: next }))}
                placeholder="Date"
                disabled={disabled}
              />
              <RemoveButton
                label={`Remove vital ${index + 1}`}
                disabled={disabled}
                onClick={() => onChange({ vitals: removeArrayItem(extraction.vitals, index) })}
              />
            </div>
            <ProvenanceEditor
              item={item}
              disabled={disabled}
              pageCount={pageCount}
              onChange={(patch) => updateArrayItem(extraction.vitals, index, patch, (next) => onChange({ vitals: next }))}
            />
          </div>
        ))}
      </EditableGroup>

      <EditableGroup
        title="Procedures"
        onAdd={() => onChange({ procedures: [...extraction.procedures, blankProcedure(defaultSourcePage)] })}
        disabled={disabled}
      >
        {extraction.procedures.map((item, index) => (
          <div key={index} className="rounded-md border border-border bg-muted/20 p-2 space-y-2">
            <div className="grid gap-2 md:grid-cols-[1fr_8rem_auto]">
              <Input
                aria-label={`Procedure ${index + 1}`}
                value={item.text}
                onChange={(e) => updateArrayItem(extraction.procedures, index, { text: e.target.value }, (next) => onChange({ procedures: next }))}
                disabled={disabled}
              />
              <Input
                aria-label={`Procedure ${index + 1} date`}
                value={item.date ?? ''}
                onChange={(e) => updateArrayItem(extraction.procedures, index, { date: e.target.value.trim() || null }, (next) => onChange({ procedures: next }))}
                placeholder="Date"
                disabled={disabled}
              />
              <RemoveButton
                label={`Remove procedure ${index + 1}`}
                disabled={disabled}
                onClick={() => onChange({ procedures: removeArrayItem(extraction.procedures, index) })}
              />
            </div>
            <ProvenanceEditor
              item={item}
              disabled={disabled}
              pageCount={pageCount}
              onChange={(patch) => updateArrayItem(extraction.procedures, index, patch, (next) => onChange({ procedures: next }))}
            />
          </div>
        ))}
      </EditableGroup>
    </div>
  );
}

function EditableGroup({
  title,
  disabled,
  onAdd,
  children,
}: {
  title: string;
  disabled: boolean;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <Button size="sm" variant="outline" onClick={onAdd} disabled={disabled}>
          <Plus className="size-3.5" aria-hidden />
          Add
        </Button>
      </div>
      {children}
    </section>
  );
}

function ProvenanceEditor<T extends { sourcePage: number; confidence: 'high' | 'medium' | 'low'; verbatim: string }>({
  item,
  disabled,
  pageCount,
  onChange,
}: {
  item: T;
  disabled: boolean;
  pageCount: number | null;
  onChange: (patch: Partial<T>) => void;
}) {
  const maxPage = Math.max(1, pageCount ?? item.sourcePage ?? 1);
  return (
    <div className="space-y-1 border-t border-border/70 pt-2">
      <p className="text-xs font-medium text-muted-foreground">Evidence from uploaded document</p>
      <div className="grid gap-2 md:grid-cols-[6rem_12rem_1fr]">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Source page</span>
          <Input
            aria-label="Source page"
            type="number"
            min={1}
            max={maxPage}
            value={item.sourcePage}
            onChange={(e) => {
              const next = Math.max(1, Math.min(maxPage, Number(e.target.value) || 1));
              onChange({ sourcePage: next } as Partial<T>);
            }}
            disabled={disabled}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Source match</span>
          <ConfidenceSelect
            value={item.confidence}
            onChange={(value) => onChange({ confidence: value as T['confidence'] } as Partial<T>)}
            disabled={disabled}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Supporting text</span>
          <Input
            aria-label="Supporting text"
            value={item.verbatim}
            onChange={(e) => onChange({ verbatim: e.target.value } as Partial<T>)}
            placeholder="Supporting text from source document"
            disabled={disabled}
          />
        </label>
      </div>
    </div>
  );
}

const sourceMatchLabels: Record<'high' | 'medium' | 'low', string> = {
  high: 'Clear source match',
  medium: 'Needs clinician check',
  low: 'Weak or unclear source',
};

function ConfidenceSelect({
  value,
  onChange,
  disabled,
}: {
  value: 'high' | 'medium' | 'low';
  onChange: (value: 'high' | 'medium' | 'low') => void;
  disabled: boolean;
}) {
  return (
    <select
      aria-label="Source match"
      value={value}
      onChange={(e) => onChange(e.target.value as 'high' | 'medium' | 'low')}
      disabled={disabled}
      className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      {(['high', 'medium', 'low'] as const).map((candidate) => (
        <option key={candidate} value={candidate}>
          {sourceMatchLabels[candidate]}
        </option>
      ))}
    </select>
  );
}

function SelectLike({
  ariaLabel,
  value,
  values,
  onChange,
  disabled,
}: {
  ariaLabel: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      {values.map((candidate) => (
        <option key={candidate} value={candidate}>
          {candidate.replaceAll('_', ' ')}
        </option>
      ))}
    </select>
  );
}

function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={onClick} disabled={disabled}>
      <Trash2 className="size-4" aria-hidden />
    </Button>
  );
}

function coerceExtraction(value: unknown): ExtractionJson | null {
  const parsed = ExtractionJsonSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function reviewExtractionForDetail(detail: ExternalContextDetail): unknown {
  if (detail.status === 'PARTIAL_EXTRACTION_REVIEW') {
    const batch = activeReviewBatch(detail);
    return batch?.vettedExtractionJson ?? batch?.extractionJson ?? null;
  }
  return detail.vettedExtractionJson ?? detail.extractionJson;
}

function activeReviewBatch(detail: ExternalContextDetail): ExternalContextExtractionBatchDetail | null {
  return detail.extractionBatches.find((batch) => batch.status === 'NEEDS_REVIEW') ?? null;
}

function currentProcessingBatch(detail: ExternalContextDetail): ExternalContextExtractionBatchDetail | null {
  return detail.extractionBatches.find((batch) => batch.status === 'PROCESSING')
    ?? detail.extractionBatches.find((batch) => batch.status === 'PENDING')
    ?? null;
}

function documentProgressLine(detail: ExternalContextDetail): string | null {
  if (detail.extractionBatches.length === 0) {
    return detail.pageCount ? `${detail.pageCount} page${detail.pageCount === 1 ? '' : 's'}` : null;
  }
  const reviewed = detail.extractionBatches.filter((batch) => batch.status === 'REVIEWED').length;
  const total = detail.extractionBatches.length;
  const reviewedPages = detail.extractionBatches
    .filter((batch) => batch.status === 'REVIEWED')
    .reduce((sum, batch) => sum + Math.max(0, batch.pageEnd - batch.pageStart + 1), 0);
  const pageTotal = detail.extractionBatches[detail.extractionBatches.length - 1]?.pageEnd ?? reviewedPages;
  return `${reviewed}/${total} batches reviewed - ${reviewedPages}/${pageTotal} pages checked`;
}

function updateArrayItem<T>(
  items: T[],
  index: number,
  patch: Partial<T>,
  commit: (items: T[]) => void,
): void {
  commit(items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
}

function removeArrayItem<T>(items: T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

function baseProvenance(sourcePage: number) {
  return {
    sourcePage,
    confidence: 'medium' as const,
    verbatim: 'Clinician-added during review',
  };
}

function blankDiagnosis(sourcePage: number): ExtractedDiagnosis {
  return {
    ...baseProvenance(sourcePage),
    text: '',
    icdHint: null,
    status: 'unknown',
  };
}

function blankMedication(sourcePage: number): ExtractedMedication {
  return {
    ...baseProvenance(sourcePage),
    name: '',
    dose: null,
    route: null,
    frequency: null,
    status: 'unknown',
  };
}

function blankAllergy(sourcePage: number): ExtractedAllergy {
  return {
    ...baseProvenance(sourcePage),
    substance: '',
    reaction: null,
    severity: 'unknown',
  };
}

function blankLab(sourcePage: number): ExtractedLab {
  return {
    ...baseProvenance(sourcePage),
    name: '',
    value: '',
    unit: null,
    referenceRange: null,
    abnormalFlag: 'unknown',
    collectedDate: null,
  };
}

function blankVital(sourcePage: number): ExtractedVital {
  return {
    ...baseProvenance(sourcePage),
    type: '',
    value: '',
    unit: null,
    measuredDate: null,
  };
}

function blankProcedure(sourcePage: number): ExtractedProcedure {
  return {
    ...baseProvenance(sourcePage),
    text: '',
    date: null,
  };
}
