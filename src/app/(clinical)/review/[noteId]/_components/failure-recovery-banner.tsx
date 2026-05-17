'use client';

import { useState, useTransition } from 'react';
import { RotateCw, AlertCircle } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';

type FailedSection = {
  sectionId: string;
  label: string;
  errorMessage?: string;
};

/**
 * FailureRecoveryBanner — surfaces at the top of /review when ≥1 section
 * is in `failed` status. "Retry all failed" fires per-section regenerate
 * POSTs sequentially (safer for LLM rate limits than parallel) and
 * surfaces per-row error inline if any individual retry fails.
 *
 * Audited at the API layer: each individual POST writes its own
 * SECTION_REGENERATED audit row, AND we POST one SECTION_REGEN_RETRY_BATCH
 * audit-event up front so dashboards can count batch retries distinctly
 * from individual ones.
 */
export function FailureRecoveryBanner({
  noteId,
  failedSections,
}: {
  noteId: string;
  failedSections: FailedSection[];
}) {
  const [pending, startTransition] = useTransition();
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [retried, setRetried] = useState<Set<string>>(new Set());

  if (failedSections.length === 0) return null;

  function retryAll() {
    setRowErrors({});
    startTransition(async () => {
      // Audit the batch up front via the shape-locked client-side audit
      // ingress (extended in Unit 10 to allow SECTION_REGEN_RETRY_BATCH).
      // Fire-and-forget — the per-section regenerate POSTs that follow
      // each write their own SECTION_REGENERATED audit row.
      void fetch('/api/audit/copilot-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SECTION_REGEN_RETRY_BATCH',
          surface: 'review',
          noteId,
          itemCount: failedSections.length,
        }),
      }).catch(() => {});

      for (const fs of failedSections) {
        try {
          const res = await fetch(`/api/notes/${noteId}/regenerate-section`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sectionId: fs.sectionId, overwriteEdited: false }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            const code = (body?.error?.code as string | undefined) ?? `http_${res.status}`;
            setRowErrors((curr) => ({ ...curr, [fs.sectionId]: code }));
          } else {
            setRetried((curr) => new Set(curr).add(fs.sectionId));
          }
        } catch (err) {
          setRowErrors((curr) => ({
            ...curr,
            [fs.sectionId]: err instanceof Error ? err.message : 'unknown',
          }));
        }
      }
    });
  }

  return (
    <Card className="border-[var(--status-danger-border)]">
      <CardHeader>
        <CardTitle className="text-md flex items-center gap-2">
          <AlertCircle className="size-4 text-[var(--status-danger-fg)]" aria-hidden="true" />
          {failedSections.length} section{failedSections.length === 1 ? '' : 's'} failed to generate
        </CardTitle>
        <CardDescription>
          Retry all at once, or open each section below to retry individually.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1 text-sm">
          {failedSections.map((fs) => (
            <li key={fs.sectionId} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-[3px] text-[var(--status-danger-fg)]">⚠</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium">{fs.label}</p>
                {fs.errorMessage && (
                  <p className="text-xs text-muted-foreground break-all">{fs.errorMessage}</p>
                )}
                {rowErrors[fs.sectionId] && (
                  <p className="text-xs text-[var(--status-danger-fg)]">
                    retry failed: {rowErrors[fs.sectionId]}
                  </p>
                )}
                {retried.has(fs.sectionId) && !rowErrors[fs.sectionId] && (
                  <StatusBadge variant="info" noIcon className="mt-1">
                    retry queued
                  </StatusBadge>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={retryAll}
            disabled={pending || failedSections.every((fs) => retried.has(fs.sectionId))}
            className="gap-1"
          >
            <RotateCw className={`size-3 ${pending ? 'animate-spin' : ''}`} aria-hidden="true" />
            Retry all failed
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
