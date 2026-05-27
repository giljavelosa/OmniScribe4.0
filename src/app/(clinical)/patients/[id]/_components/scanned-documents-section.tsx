'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { Camera, Trash2 } from 'lucide-react';
import type { PatientUploadKind, PatientUploadStatus } from '@prisma/client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { ScanReviewSheet } from './scan-review-sheet';
import {
  UPLOAD_KIND_LABEL,
  uploadStatusBadgeVariant,
  uploadStatusLabel,
} from '@/lib/patient-uploads/display';

type UploadSummary = {
  uploadId: string;
  kind: PatientUploadKind;
  status: PatientUploadStatus;
  filename: string | null;
  createdAt: string;
  captureContext: string | null;
};

const SCAN_KINDS: PatientUploadKind[] = [
  'MED_LIST',
  'LAB_REPORT',
  'IMAGING_REPORT',
  'INSURANCE_CARD',
  'ID_CARD',
  'OUTSIDE_RECORDS',
  'OTHER',
];

/**
 * Scanned documents — patient chart Overview (option A).
 * Phone capture → existing upload API → review sheet (accept / deny / re-scan).
 */
export function ScannedDocumentsSection({ patientId }: { patientId: string }) {
  const searchParams = useSearchParams();
  const [uploads, setUploads] = useState<UploadSummary[]>([]);
  const [needsReviewCount, setNeedsReviewCount] = useState(0);
  const [scanOpen, setScanOpen] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [kind, setKind] = useState<PatientUploadKind>('OUTSIDE_RECORDS');
  const [context, setContext] = useState('');
  const [supersedesId, setSupersedesId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<UploadSummary | null>(null);
  const [rowPending, setRowPending] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/patients/${patientId}/uploads`, { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as {
      data: { uploads: UploadSummary[]; needsReviewCount: number };
    };
    setUploads(body.data.uploads);
    setNeedsReviewCount(body.data.needsReviewCount);
  }, [patientId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch-on-mount; setState lives inside refresh() after the response resolves
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const hasProcessing = uploads.some(
      (u) => u.status === 'PENDING_EXTRACTION' || u.status === 'EXTRACTING',
    );
    if (!hasProcessing) return;
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [uploads, refresh]);

  function openScan(priorId: string | null, priorContext: string) {
    setSupersedesId(priorId);
    setContext(priorContext);
    setError(null);
    setScanOpen(true);
  }

  // Phase C — soft-delete a row directly from the list. Same endpoint
  // the review sheet uses; rule 7 — S3 object + audit row preserved.
  // Optimistically removes the row + decrements needsReview locally so
  // the badge updates instantly; we still re-poll on the next tick.
  async function deleteRow(target: UploadSummary) {
    setRowPending(target.uploadId);
    try {
      const res = await fetch(`/api/patients/${patientId}/uploads/${target.uploadId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setError('Could not delete this scan.');
        return;
      }
      setUploads((prev) => prev.filter((u) => u.uploadId !== target.uploadId));
      const wasReviewable =
        target.status === 'EXTRACTED' ||
        target.status === 'MANUAL_ONLY' ||
        target.status === 'EXTRACTION_FAILED';
      if (wasReviewable) setNeedsReviewCount((n) => Math.max(0, n - 1));
      void refresh();
    } finally {
      setRowPending(null);
      setDeleteTarget(null);
    }
  }

  useEffect(() => {
    if (searchParams.get('openScan') === '1') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot deep-link consumption from /prepare; the URL hint is cleared below so this never re-fires
      openScan(null, '');
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('openScan');
        window.history.replaceState(null, '', url.pathname + url.search);
      }
    }
  }, [searchParams]);

  // Phase C — Overview "Scan" quick-action also fires this event after
  // switching to the Scans tab so the dialog opens without a URL push.
  useEffect(() => {
    function onOpenRequest() {
      openScan(null, '');
    }
    window.addEventListener('scans:open-dialog', onOpenRequest);
    return () => window.removeEventListener('scans:open-dialog', onOpenRequest);
  }, []);

  function onFilePicked(file: File | undefined) {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('file', file, file.name);
      fd.set('kind', kind);
      if (context.trim()) fd.set('captureContext', context.trim());
      if (supersedesId) fd.set('supersedesUploadId', supersedesId);
      const res = await fetch(`/api/patients/${patientId}/uploads`, { method: 'POST', body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        };
        setError(body?.error?.message ?? 'Upload failed. Try again.');
        return;
      }
      const body = (await res.json()) as { data: { uploadId: string } };
      setScanOpen(false);
      setSupersedesId(null);
      await refresh();
      setReviewId(body.data.uploadId);
    });
  }

  return (
    <>
      <Card data-section-id="scanned-documents">
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>Scanned documents</CardTitle>
              <CardDescription>
                Photos of paperwork the patient brought in. Accept what&apos;s accurate — then
                briefs and Miss Cleo can use it.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => openScan(null, '')}>
              <Camera className="size-4" aria-hidden />
              Scan
            </Button>
          </div>
          {needsReviewCount > 0 && (
            <StatusBadge variant="warning" className="mt-2 w-fit">
              {needsReviewCount} need review
            </StatusBadge>
          )}
        </CardHeader>
        <CardContent>
          {uploads.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No scans yet. Tap Scan to photograph a med list, lab report, or other paper.
            </p>
          ) : (
            <ul className="divide-y divide-border -mx-1">
              {uploads.map((u) => (
                <li key={u.uploadId} className="flex items-stretch gap-1">
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left px-1 py-3 flex items-center justify-between gap-3 hover:bg-muted/50 rounded-md"
                    onClick={() => setReviewId(u.uploadId)}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {UPLOAD_KIND_LABEL[u.kind]}
                        {u.filename ? ` · ${u.filename}` : ''}
                      </p>
                      {u.captureContext && (
                        <p className="text-xs text-muted-foreground truncate">{u.captureContext}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <StatusBadge variant={uploadStatusBadgeVariant(u.status)} noIcon>
                      {uploadStatusLabel(u.status)}
                    </StatusBadge>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${UPLOAD_KIND_LABEL[u.kind]} scan`}
                    title="Delete scan"
                    disabled={rowPending === u.uploadId}
                    onClick={() => setDeleteTarget(u)}
                    className="shrink-0 self-center p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={scanOpen} onOpenChange={setScanOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{supersedesId ? 'Re-scan document' : 'Scan document'}</DialogTitle>
            <DialogDescription>
              Use your phone camera. Pick what type of paper this is — AI will read it next.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Document type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as PatientUploadKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCAN_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {UPLOAD_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="scan-setup-context">What is this scan about? (optional)</Label>
              <Textarea
                id="scan-setup-context"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                rows={2}
                disabled={pending}
              />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => onFilePicked(e.target.files?.[0])}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setScanOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
            >
              {pending ? 'Uploading…' : 'Take photo / choose image'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ScanReviewSheet
        patientId={patientId}
        uploadId={reviewId}
        open={!!reviewId}
        onOpenChange={(o) => {
          if (!o) setReviewId(null);
        }}
        onResolved={() => void refresh()}
        onRescan={(priorId, ctx) => openScan(priorId, ctx)}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this scan?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Removes the ${UPLOAD_KIND_LABEL[deleteTarget.kind]} from the chart, briefs, and Miss Cleo. The photo and audit trail are kept on file (HIPAA-required).`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) void deleteRow(deleteTarget);
              }}
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
