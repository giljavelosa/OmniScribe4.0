'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
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
import { ChartDetailSheet } from './chart-detail-sheet';
import {
  UPLOAD_KIND_LABEL,
  uploadAwaitingReview,
  uploadIsProcessing,
  uploadStatusBadgeVariant,
  uploadStatusLabel,
} from '@/lib/patient-uploads/display';
import {
  buildFindings,
  type FindingsResult,
} from '@/lib/patient-uploads/findings-format';
import type { PatientUploadKind, PatientUploadStatus } from '@prisma/client';

export type UploadDetail = {
  uploadId: string;
  kind: PatientUploadKind;
  status: PatientUploadStatus;
  mimeType: string;
  filename: string | null;
  extractionError: string | null;
  captureContext: string | null;
  extractedJson: unknown;
  attestedJson: unknown;
  presignedUrl: string | null;
  createdAt: string;
};

/**
 * Per-kind structured renderer. Replaces the previous flat-string
 * `formatFindings` (which fell through to `JSON.stringify` for half
 * the upload kinds, surfacing raw JSON to clinicians). The pure
 * helper is in `@/lib/patient-uploads/findings-format` so it's
 * unit-tested independently of React.
 */
function FindingsView({ findings }: { findings: FindingsResult }) {
  if (findings.isEmpty) {
    return (
      <p className="text-sm text-muted-foreground">
        No structured fields were captured.
      </p>
    );
  }
  return (
    <dl className="space-y-3">
      {findings.sections.map((section) => (
        <div key={section.label} className="space-y-1">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            {section.label}
          </dt>
          <dd className="text-sm text-foreground">
            {Array.isArray(section.value) ? (
              <ul className="list-disc pl-5 space-y-0.5">
                {section.value.map((line, i) => (
                  <li key={i} className="whitespace-pre-wrap">
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="whitespace-pre-wrap">{section.value}</p>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ScanReviewSheet({
  patientId,
  uploadId,
  open,
  onOpenChange,
  onResolved,
  onRescan,
}: {
  patientId: string;
  uploadId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved: () => void;
  onRescan: (priorUploadId: string, context: string) => void;
}) {
  const [detail, setDetail] = useState<UploadDetail | null>(null);
  const [context, setContext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [denyOpen, setDenyOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    if (!uploadId) return;
    const res = await fetch(`/api/patients/${patientId}/uploads/${uploadId}`, { cache: 'no-store' });
    if (!res.ok) {
      setError('Could not load this scan.');
      return;
    }
    const body = (await res.json()) as { data: UploadDetail & { extractionError?: string | null } };
    const d = body.data;
    setDetail({
      uploadId: d.uploadId,
      kind: d.kind,
      status: d.status,
      mimeType: d.mimeType,
      filename: d.filename,
      extractionError: d.extractionError ?? null,
      captureContext: d.captureContext,
      extractedJson: d.extractedJson,
      attestedJson: d.attestedJson,
      presignedUrl: d.presignedUrl,
      createdAt: d.createdAt,
    });
    setContext(d.captureContext ?? '');
    setError(null);
  }, [patientId, uploadId]);

  useEffect(() => {
    if (!open || !uploadId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-open data load; setState happens inside load() after the request resolves
    void load();
  }, [open, uploadId, load]);

  // Reset stale detail when the sheet closes or switches targets so the
  // next open paints "Loading…" instead of flashing the previous scan.
  useEffect(() => {
    if (open && uploadId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on close; alternative ('key' prop on parent) would re-mount the AlertDialog and break its open animation
    setDetail(null);
  }, [open, uploadId]);

  useEffect(() => {
    if (!open || !detail || !uploadIsProcessing(detail.status)) return;
    const id = setInterval(() => void load(), 2000);
    return () => clearInterval(id);
  }, [open, detail, load]);

  function accept() {
    if (!uploadId) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/patients/${patientId}/uploads/${uploadId}/attest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captureContext: context.trim() || undefined }),
      });
      if (!res.ok) {
        setError('Could not accept this scan.');
        return;
      }
      onOpenChange(false);
      onResolved();
    });
  }

  function deny() {
    if (!uploadId) return;
    startTransition(async () => {
      const res = await fetch(`/api/patients/${patientId}/uploads/${uploadId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captureContext: context.trim() || undefined }),
      });
      if (!res.ok) {
        setError('Could not deny this scan.');
        return;
      }
      setDenyOpen(false);
      onOpenChange(false);
      onResolved();
    });
  }

  // Phase C — soft-delete (rule 7). Removes the scan from chart views
  // (briefs, Cleo, list). The S3 object + audit trail are preserved.
  function remove() {
    if (!uploadId) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/patients/${patientId}/uploads/${uploadId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setError('Could not delete this scan.');
        return;
      }
      setDeleteOpen(false);
      onOpenChange(false);
      onResolved();
    });
  }

  const findings: FindingsResult = detail
    ? uploadAwaitingReview(detail.status)
      ? buildFindings(detail.kind, detail.extractedJson)
      : detail.status === 'ATTESTED'
        ? buildFindings(detail.kind, detail.attestedJson)
        : { sections: [], isEmpty: true }
    : { sections: [], isEmpty: true };

  const isAwaitingReview = detail ? uploadAwaitingReview(detail.status) : false;
  const isResolved =
    detail?.status === 'ATTESTED' || detail?.status === 'REJECTED';
  const sheetTitle = isAwaitingReview ? 'Review scan' : 'Scan detail';

  return (
    <>
      <ChartDetailSheet
        open={open}
        onOpenChange={onOpenChange}
        title={sheetTitle}
        description={
          detail
            ? `${UPLOAD_KIND_LABEL[detail.kind]} · ${uploadStatusLabel(detail.status)}`
            : 'Loading…'
        }
      >
        {!detail ? (
          <p className="text-sm text-muted-foreground">Loading scan…</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge variant={uploadStatusBadgeVariant(detail.status)} noIcon>
                {uploadStatusLabel(detail.status)}
              </StatusBadge>
              <span className="text-xs text-muted-foreground">
                {new Date(detail.createdAt).toLocaleString()}
              </span>
            </div>

            {detail.presignedUrl && detail.mimeType.startsWith('image/') && (
              <div className="relative w-full max-h-48 rounded-md border border-border overflow-hidden bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL */}
                <img
                  src={detail.presignedUrl}
                  alt="Scanned document"
                  className="w-full h-auto max-h-48 object-contain"
                />
              </div>
            )}

            {uploadIsProcessing(detail.status) && (
              <StatusBanner variant="info" title="Reading the photo">
                AI is extracting text. This usually takes a few seconds.
              </StatusBanner>
            )}

            {detail.extractionError && (
              <StatusBanner variant="warning" title="Automatic read limited">
                {detail.extractionError}
              </StatusBanner>
            )}

            {isAwaitingReview && (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">What we read</Label>
                  <div className="rounded-md border border-border bg-muted/40 p-3 max-h-60 overflow-y-auto">
                    {findings.isEmpty ? (
                      <p className="text-sm text-muted-foreground">
                        Nothing structured — you can still accept with your context note.
                      </p>
                    ) : (
                      <FindingsView findings={findings} />
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="scan-context">What is this scan about?</Label>
                  <Textarea
                    id="scan-context"
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="e.g. Outside lab from March · patient’s paper med list"
                    rows={3}
                    disabled={pending}
                  />
                  <p className="text-xs text-muted-foreground">
                    Accepted scans can be used for briefs and Miss Cleo. Denied scans stay on file
                    for audit only.
                  </p>
                </div>
              </>
            )}

            {/* Phase C — read-only view for resolved scans. ATTESTED rows
                show the attested JSON Cleo + briefs use; REJECTED rows
                show only the photo + context (audit-only, no findings). */}
            {isResolved && detail.status === 'ATTESTED' && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">What we read</Label>
                <div className="rounded-md border border-border bg-muted/40 p-3 max-h-60 overflow-y-auto">
                  <FindingsView findings={findings} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Used by pre-visit briefs and Miss Cleo when this patient is opened.
                </p>
              </div>
            )}

            {isResolved && detail.captureContext && (
              <div className="space-y-1">
                <Label className="text-sm font-medium">Context note</Label>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {detail.captureContext}
                </p>
              </div>
            )}

            {detail.status === 'REJECTED' && (
              <StatusBanner variant="neutral">
                This scan was denied — kept on file for audit, not used by briefs or Miss Cleo.
              </StatusBanner>
            )}

            {error && <StatusBanner variant="danger">{error}</StatusBanner>}

            {isAwaitingReview && (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button className="flex-1" onClick={accept} disabled={pending}>
                  {pending ? 'Saving…' : 'Accept'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={pending}
                  onClick={() => setDenyOpen(true)}
                >
                  Deny
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    if (!uploadId) return;
                    onOpenChange(false);
                    onRescan(uploadId, context);
                  }}
                >
                  Re-scan
                </Button>
              </div>
            )}

            {/* Delete is intentionally always available (rule 7 soft-delete:
                row + S3 lineage preserved, audit row written). Lives in its
                own row so it can never be the primary tap target. */}
            <div className="pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={pending}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-4" aria-hidden />
                Delete scan
              </Button>
            </div>
          </div>
        )}
      </ChartDetailSheet>

      <AlertDialog open={denyOpen} onOpenChange={setDenyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deny this scan?</AlertDialogTitle>
            <AlertDialogDescription>
              It will not be used for briefs or Miss Cleo. The photo stays in the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deny}>Deny</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this scan?</AlertDialogTitle>
            <AlertDialogDescription>
              The scan is removed from the chart, briefs, and Miss Cleo. The photo and audit
              trail are kept on file (HIPAA-required).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
