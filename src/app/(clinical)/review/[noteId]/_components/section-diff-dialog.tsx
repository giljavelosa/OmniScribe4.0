'use client';

import { useEffect, useState, useTransition } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { diffLines, diffSummary, type DiffSegment } from '@/lib/diff/line-diff';

type DiffResponse = {
  data: {
    sectionId: string;
    regeneratedAt: string;
    overwroteEdited: boolean;
    previous: string;
    current: string;
    regenCount: number;
  };
};

/**
 * SectionDiffDialog — "show what changed" surface for a regenerated section.
 *
 * Uses shadcn Dialog (not AlertDialog — this is a read-only viewer, not a
 * destructive confirmation). Fetches /sections/[id]/diff on open; renders
 * the diff via the hand-rolled diffLines helper. Token-colored: additions
 * in success-fg, removals in danger-fg with strike-through. Counts surface
 * as a "+N -M" badge in the header so the clinician can decide at a glance
 * if the change is worth scrutinizing.
 *
 * If the previous content was trimmed by the per-section cap, the dialog
 * surfaces a friendly empty state instead of failing — the audit trail
 * still has the regeneration metadata.
 */
export function SectionDiffDialog({
  open,
  onOpenChange,
  noteId,
  sectionId,
  sectionLabel,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  noteId: string;
  sectionId: string;
  sectionLabel: string;
}) {
  const [data, setData] = useState<DiffResponse['data'] | null>(null);
  const [error, setError] = useState<{ code: string; message?: string } | null>(null);
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    if (!open) return;
    // Reset state at the start of a fresh fetch — intentional setState in
    // effect; the alternative (reset on dialog close) flickers stale data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError(null);
    startLoading(async () => {
      const res = await fetch(`/api/notes/${noteId}/sections/${sectionId}/diff`);
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error ?? { code: `http_${res.status}` });
        return;
      }
      const json = (await res.json()) as DiffResponse;
      setData(json.data);
    });
  }, [open, noteId, sectionId]);

  const segments: DiffSegment[] = data ? diffLines(data.previous, data.current) : [];
  const summary = data ? diffSummary(segments) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            What changed in &ldquo;{sectionLabel}&rdquo;
            {summary && (
              <StatusBadge variant="neutral" noIcon className="ml-2 text-[10px] font-normal">
                +{summary.added} −{summary.removed}
              </StatusBadge>
            )}
            {data?.overwroteEdited && (
              <StatusBadge variant="warning" noIcon className="ml-2 text-[10px] font-normal">
                overwrote edits
              </StatusBadge>
            )}
          </DialogTitle>
          <DialogDescription>
            {data
              ? `Regenerated ${new Date(data.regeneratedAt).toLocaleString()}. ${data.regenCount} regeneration${data.regenCount === 1 ? '' : 's'} on this section so far.`
              : 'Comparing the previous content with the current content.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto rounded-md border border-border bg-muted/20 p-3 font-mono text-xs leading-relaxed">
          {loading && (
            <p className="text-muted-foreground italic">Loading diff…</p>
          )}
          {error && (
            <StatusBanner variant={error.code === 'previous_trimmed' ? 'info' : 'danger'}>
              {error.code === 'no_history'
                ? 'No regeneration history for this section yet.'
                : error.code === 'previous_trimmed'
                  ? 'Previous content was older than the 10-regeneration history cap and has been dropped. Audit metadata (who/when) is preserved.'
                  : (error.message ?? `Couldn't load diff (${error.code}).`)}
            </StatusBanner>
          )}
          {data && !loading && (
            <pre className="whitespace-pre-wrap break-words">
              {segments.map((s, i) => (
                <DiffLine key={i} segment={s} />
              ))}
            </pre>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DiffLine({ segment }: { segment: DiffSegment }) {
  if (segment.kind === 'equal') {
    return (
      <div className="text-muted-foreground">
        <span aria-hidden="true" className="opacity-50 mr-2">·</span>
        {segment.text || ' '}
      </div>
    );
  }
  if (segment.kind === 'add') {
    return (
      <div className="text-[var(--status-success-fg)] bg-[var(--status-success-bg)]/30">
        <span aria-hidden="true" className="mr-2">+</span>
        {segment.text || ' '}
      </div>
    );
  }
  return (
    <div className="text-[var(--status-danger-fg)] bg-[var(--status-danger-bg)]/30 line-through">
      <span aria-hidden="true" className="mr-2 no-underline">−</span>
      {segment.text || ' '}
    </div>
  );
}
