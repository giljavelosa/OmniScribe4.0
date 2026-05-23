'use client';

import { useState, useTransition } from 'react';
import { BadgeCheck } from 'lucide-react';

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
import { StatusBanner } from '@/components/ui/status-banner';

/**
 * Sprint 0.17 — write-back confirmation dialog.
 *
 * Rendered from the review-panel inline section after the clinician
 * confirms a write-back-eligible action. The `<AlertDialog>` summary
 * shows the FHIR Condition payload + ICD + computed clinicalStatus +
 * the recording clinician's display name. Pressing Confirm POSTs to
 * `/api/cases/{caseId}/writeback/approve`; the chart's cases-panel
 * chip updates on the next poll.
 *
 * Anti-regression rule 22: this is an `<AlertDialog>`, NOT a native
 * `confirm()` — clinical surfaces only.
 */
export type WriteBackConfirmDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  caseId: string;
  proposalId: string;
  /** "CREATE" or "PATCH" — drives the dialog title verb. */
  operation: 'CREATE' | 'PATCH';
  /** Pre-formatted summary line from the accept-endpoint response
   *  (e.g. "Will create a new Condition in your EHR with F33.1 …"). */
  summary: string;
  /** Optional structured-detail rows for the body. PHI-free —
   *  caller-controlled. Each row is "{label}: {value}". */
  detailRows?: Array<{ label: string; value: string }>;
  onConfirmed: () => void;
};

export function WriteBackConfirmDialog({
  open,
  onOpenChange,
  caseId,
  proposalId,
  operation,
  summary,
  detailRows,
  onConfirmed,
}: WriteBackConfirmDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/cases/${caseId}/writeback/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not approve the EHR write.');
        return;
      }
      onOpenChange(false);
      onConfirmed();
    });
  }

  const title =
    operation === 'CREATE'
      ? 'Write Condition to your EHR?'
      : 'Update existing EHR Condition?';

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <BadgeCheck className="size-4 text-primary shrink-0" aria-hidden />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3 pt-2">
            <span className="block text-sm">{summary}</span>
            {detailRows && detailRows.length > 0 && (
              <span className="block">
                <span className="block rounded-md border border-border bg-muted/30 p-3 text-sm">
                  {detailRows.map((row) => (
                    <span
                      key={row.label}
                      className="grid grid-cols-[7rem_1fr] items-baseline gap-2"
                    >
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {row.label}
                      </span>
                      <span className="font-medium">{row.value}</span>
                    </span>
                  ))}
                </span>
              </span>
            )}
            <span className="block text-xs text-muted-foreground">
              You can review the result in the EHR after the write completes
              (usually within a few seconds). If the write fails, the
              OmniScribe case is unaffected and you can retry from the
              patient&apos;s chart.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={pending}>
            {pending ? 'Saving…' : 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
