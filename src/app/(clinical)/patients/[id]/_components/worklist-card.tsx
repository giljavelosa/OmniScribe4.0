'use client';

import type { ReactNode } from 'react';
import { CheckCircle2, ChevronRight, ClipboardList, FileText, FolderOpen } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';

type RowTone = 'warning' | 'info';

const TONE_CHIP: Record<RowTone, string> = {
  warning: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
  info: 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)]',
};

function WorklistRow({
  icon,
  tone,
  title,
  preview,
  count,
  onClick,
}: {
  icon: ReactNode;
  tone: RowTone;
  title: string;
  preview?: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 rounded-lg px-2.5 py-2 min-h-[var(--touch-min)] transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden
        className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', TONE_CHIP[tone])}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-tight text-foreground/90">{title}</p>
        {preview && (
          <p className="text-xs text-muted-foreground leading-tight mt-0.5 truncate">{preview}</p>
        )}
      </div>
      <StatusBadge variant={tone} noIcon className="text-2xs shrink-0">
        {count}
      </StatusBadge>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
    </button>
  );
}

type Props = {
  followUpCount: number;
  documentReviewCount: number;
  documentPreview?: string;
  /** Footer affordance label — always opens the records sheet (preserves the
   *  upload/browse path even when nothing needs review). */
  recordsActionLabel: string;
  onOpenFollowUps: () => void;
  onOpenDocuments: () => void;
  onOpenRecords: () => void;
};

/**
 * WorklistCard — the rail's "Needs attention" surface. Merges open
 * follow-ups + documents-needing-review into one prioritized list.
 * Both-zero collapses to a single composed "All clear" state. The records
 * footer is always present so document upload/browse never loses its entry
 * point (the old Documents tile's job).
 */
export function WorklistCard({
  followUpCount,
  documentReviewCount,
  documentPreview,
  recordsActionLabel,
  onOpenFollowUps,
  onOpenDocuments,
  onOpenRecords,
}: Props) {
  const hasWork = followUpCount > 0 || documentReviewCount > 0;

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="px-4 pt-4 pb-2">
        <CardTitle className="text-sm font-semibold">Needs attention</CardTitle>
      </CardHeader>
      <CardContent className="px-2.5 pb-2.5">
        {hasWork ? (
          <div className="space-y-0.5">
            {followUpCount > 0 && (
              <WorklistRow
                icon={<ClipboardList className="size-4" />}
                tone="warning"
                title="Open follow-ups"
                count={followUpCount}
                onClick={onOpenFollowUps}
              />
            )}
            {documentReviewCount > 0 && (
              <WorklistRow
                icon={<FileText className="size-4" />}
                tone="info"
                title="Documents need review"
                preview={documentPreview}
                count={documentReviewCount}
                onClick={onOpenDocuments}
              />
            )}
          </div>
        ) : (
          <EmptyState
            size="sm"
            tone="success"
            icon={<CheckCircle2 className="size-4" />}
            title="All clear"
            description="Nothing needs your attention right now."
          />
        )}
      </CardContent>
      <button
        type="button"
        onClick={onOpenRecords}
        data-testid="open-prior-records"
        className="w-full text-left px-4 py-2.5 border-t flex items-center gap-2.5 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1 text-sm font-medium text-foreground/80">{recordsActionLabel}</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
      </button>
    </Card>
  );
}
