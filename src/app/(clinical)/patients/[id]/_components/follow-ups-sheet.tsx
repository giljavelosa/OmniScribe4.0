'use client';

import { StatusBadge } from '@/components/ui/status-badge';
import { ChartDetailSheet } from './chart-detail-sheet';

export type FollowUpSummary = {
  id: string;
  text: string;
  status: string;
  createdAt: string; // ISO
  originNoteId: string;
  originNoteSignedAt: string | null; // ISO
  episodeId: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followUps: FollowUpSummary[];
};

/**
 * FollowUpsSheet — drill-down for the "Open follow-ups" cockpit tile.
 * Read-only, Phase 1 (Sprint 0.9).
 */
export function FollowUpsSheet({ open, onOpenChange, followUps }: Props) {
  const open_ = followUps.filter((f) => f.status === 'OPEN');

  return (
    <ChartDetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Open follow-ups"
    >
      {open_.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open follow-ups for this patient.</p>
      ) : (
        <ul className="divide-y divide-border">
          {open_.map((fu) => (
            <FollowUpRow key={fu.id} followUp={fu} />
          ))}
        </ul>
      )}
    </ChartDetailSheet>
  );
}

function FollowUpRow({ followUp }: { followUp: FollowUpSummary }) {
  const createdDate = followUp.createdAt.slice(0, 10);
  const sourceDate = followUp.originNoteSignedAt?.slice(0, 10) ?? null;

  return (
    <li className="py-3 space-y-1">
      <p className="text-sm text-foreground leading-snug">{followUp.text}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge variant="info" noIcon className="text-xs">
          Open
        </StatusBadge>
        <span className="text-xs text-muted-foreground">
          Created {createdDate}
          {sourceDate ? ` · from visit ${sourceDate}` : ''}
        </span>
      </div>
    </li>
  );
}
