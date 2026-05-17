import Link from 'next/link';
import type { PriorContextBriefContent } from '@/types/brief';

/**
 * BriefHeader — patient one-liner + last-visit chip + "open source note" link.
 * Always visible at the top of the BriefCard.
 */
export function BriefHeader({
  patientOneLine,
  episodeLabel,
  lastVisit,
}: {
  patientOneLine: string | null;
  episodeLabel: string | null;
  lastVisit: PriorContextBriefContent['lastVisit'];
}) {
  const summaryLine = [patientOneLine, episodeLabel].filter(Boolean).join(' · ');
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden="true" className="text-base">📋</span>
        <p className="text-sm font-medium">
          {summaryLine || 'Patient summary unavailable'}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Last seen {formatDaysAgo(lastVisit.daysAgo)} · {lastVisit.clinicianName}
        {lastVisit.noteType ? ` · ${lastVisit.noteType}` : ''}
        {' '}
        <Link
          href={`/review/${lastVisit.noteId}`}
          className="underline-offset-2 hover:underline"
          aria-label="Open the most recent source note"
        >
          [open note ↗]
        </Link>
      </p>
    </div>
  );
}

function formatDaysAgo(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.round(days / 7)} wk ago`;
  if (days < 365) return `${Math.round(days / 30)} mo ago`;
  return `${Math.round(days / 365)} yr ago`;
}
