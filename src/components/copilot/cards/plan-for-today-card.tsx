'use client';

import { useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SourcePill } from '@/components/brief/source-pill';
import type { CopilotSurface } from '../copilot-shell';

export type PlanItem = {
  text: string;
  source: { noteId: string; date: string };
};

/**
 * PlanForTodayCard — Watch v0 card surfacing verbatim plan items that the
 * prior clinician flagged for today's visit.
 *
 * Rule 20 surface: items derive from NoteBrief.content.carryForwardPlan,
 * which is built from SIGNED notes only. The caller pairs each item with
 * a SourcePill (no pill = no render — the spec's trust contract).
 *
 * Rule 23 surface: items are NOT actionable — they're reminders, not
 * commitments. No Met / Drop / Carry actions; commitments live in the
 * OpenFollowUps card (and are the only items that mutate state).
 *
 * Audit: fires COPILOT_CARD_RENDERED once on mount with cardType +
 * itemCount + surface + noteId. Best-effort.
 */
export function PlanForTodayCard({
  items,
  surface,
  noteId,
}: {
  items: PlanItem[];
  surface: CopilotSurface;
  noteId: string;
}) {
  const auditedRef = useRef(false);
  useEffect(() => {
    if (auditedRef.current) return;
    auditedRef.current = true;
    void fetch('/api/audit/copilot-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'COPILOT_CARD_RENDERED',
        surface,
        noteId,
        cardType: 'plan-for-today',
        itemCount: items.length,
      }),
    }).catch(() => {});
  }, [surface, noteId, items.length]);

  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-md">Plan said for today</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No carry-forward plan from the last visit.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">Plan said for today</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={`${item.source.noteId}-${i}`} className="space-y-1">
              <div className="flex items-start gap-2 text-sm">
                <span aria-hidden="true" className="mt-[2px] text-muted-foreground">•</span>
                <span className="flex-1">{item.text}</span>
              </div>
              <div className="ml-5">
                <SourcePill noteId={item.source.noteId} date={item.source.date} />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
