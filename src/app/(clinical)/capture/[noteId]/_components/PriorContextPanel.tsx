'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BriefCard } from '@/components/brief/brief-card';
import { EmptyBrief } from '@/components/brief/empty-brief';
import type { PriorContextBriefContent } from '@/types/brief';
import { FollowUpQuickAction } from './FollowUpQuickAction';

type LiveFollowUp = {
  id: string;
  text: string;
  status: 'OPEN' | 'MET' | 'CARRIED' | 'DROPPED' | 'CLOSED_BY_DISCHARGE';
  source: { noteId: string; date: string };
};

/**
 * PriorContextPanel — capture-screen surface for the brief.
 *
 * Receives precomputed brief + live open-follow-ups from the server (page.tsx
 * fetches both before render). Wraps BriefCard with the interactive
 * FollowUpQuickAction chip group injected into the followUpsSlot — same
 * BriefCard component, two different follow-up presentations across surfaces.
 *
 * The live follow-up list is the SOURCE OF TRUTH at capture time, not the
 * snapshot baked into the brief — a snapshot can lag by a visit. Each chip
 * action hits PATCH /api/follow-ups/[id] and optimistically transitions the
 * local row state on success.
 */
export function PriorContextPanel({
  brief,
  initialOpenFollowUps,
  patientDisplayName,
  patientId,
  nowMs,
  hasPriorSignedNote,
}: {
  brief: PriorContextBriefContent | null;
  initialOpenFollowUps: LiveFollowUp[];
  patientDisplayName: string;
  patientId: string;
  nowMs: number;
  hasPriorSignedNote: boolean;
}) {
  const [followUps, setFollowUps] = useState<LiveFollowUp[]>(initialOpenFollowUps);

  function handleUpdated(id: string, newStatus: 'MET' | 'DROPPED' | 'CARRIED') {
    // Optimistic: status pill replaces the chips inline (handled by the
    // QuickAction's local state). Remove from the open-list for header counts.
    setFollowUps((current) => current.filter((fu) => fu.id !== id || newStatus === 'CARRIED'));
    // CARRIED stays in the list so the badge still shows the commitment is
    // alive (just deferred); MET/DROPPED close it out.
  }

  if (!brief) {
    return (
      <EmptyBrief
        variant={hasPriorSignedNote ? 'unavailable' : 'first-visit'}
        patientName={patientDisplayName}
        patientId={patientId}
      />
    );
  }

  const followUpsSlot =
    followUps.length === 0 ? (
      <p className="text-xs text-muted-foreground italic">
        No open follow-ups from prior visits.
      </p>
    ) : (
      <ul className="space-y-3">
        {followUps.map((fu) => (
          <li key={fu.id}>
            <FollowUpQuickAction
              followUp={fu}
              onUpdated={(s) => handleUpdated(fu.id, s)}
            />
          </li>
        ))}
      </ul>
    );

  return <BriefCard content={brief} nowMs={nowMs} followUpsSlot={followUpsSlot} />;
}

/**
 * Collapsed-state preview (used as the resting strip in some layouts).
 * Preserves the spec's "panel rests collapsed during a visit" intent. Today
 * the panel renders expanded by default; the collapsed strip is exported in
 * case future layouts opt back into it.
 */
export function PriorContextPanelStrip({
  patientDisplayName,
  openFollowUpCount,
}: {
  patientDisplayName: string;
  openFollowUpCount: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">Prior context · {patientDisplayName}</CardTitle>
        <CardDescription>
          {openFollowUpCount > 0
            ? `${openFollowUpCount} open follow-up${openFollowUpCount === 1 ? '' : 's'}`
            : 'No open follow-ups'}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground italic">
        Expand to view the prior-context brief.
      </CardContent>
    </Card>
  );
}
