import Link from 'next/link';
import { Sparkles } from 'lucide-react';

import type { PriorContextBriefContent } from '@/types/brief';
import { COPILOT_DISPLAY_NAME } from '@/services/copilot/persona';

/**
 * BriefHeader — Miss Cleo attribution + patient summary + last-visit chip.
 *
 * Sprint 0.12 persona pass: the brief is the first AI-authored artifact a
 * clinician sees on /prepare, so the header attributes it to Miss Cleo via
 * `COPILOT_DISPLAY_NAME` (never hardcode the literal string) with the same
 * `Sparkles` icon used by `CopilotShell`. Same trust signal across surfaces.
 */
export function BriefHeader({
  patientName,
  patientOneLine,
  episodeLabel,
  lastVisit,
}: {
  patientName: string;
  patientOneLine: string | null;
  episodeLabel: string | null;
  lastVisit: PriorContextBriefContent['lastVisit'];
}) {
  const summaryLine = [patientOneLine, episodeLabel].filter(Boolean).join(' · ');
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary shrink-0" aria-hidden />
        <p className="text-sm font-semibold">
          {COPILOT_DISPLAY_NAME}&rsquo;s read on {patientName}
        </p>
      </div>
      {summaryLine && (
        <p className="text-sm text-muted-foreground">{summaryLine}</p>
      )}
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
