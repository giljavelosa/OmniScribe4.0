'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { CopilotSurface } from '../copilot-shell';

export type FhirCardType =
  | 'active-conditions'
  | 'current-medications'
  | 'recent-observations'
  | 'allergies';

/**
 * Shared shell for the four Unit 25 FHIR-backed Watch cards. Owns:
 *
 *   - The one-time COPILOT_CARD_RENDERED audit fire on mount (mirrors
 *     the OpenFollowUpsCard / PlanForTodayCard pattern from Unit 07 —
 *     audited via the existing client-side ingress).
 *   - The Card / CardHeader / CardContent envelope so all four FHIR
 *     cards have a consistent visual weight on the page.
 *   - The optional "raised" visual (Unit 26 / Watch v2). When the
 *     card has ≥1 row raised by a live-transcript trigger, a left-
 *     border accent + "Mentioned just now" subhead surfaces. Outer
 *     Card gains `data-raised="true"` so future CSS hooks can target.
 *
 * Empty-state handling lives in each card (the message + tone differs
 * per category); the shell renders whichever child it's given.
 */
export function FhirCardShell({
  title,
  cardType,
  surface,
  noteId,
  itemCount,
  raisedCount = 0,
  children,
}: {
  title: string;
  cardType: FhirCardType;
  surface: CopilotSurface;
  noteId: string;
  itemCount: number;
  /** Unit 26 — count of rows currently raised by a live-transcript
   *  trigger. >0 surfaces the "Mentioned just now" subhead + left
   *  border accent. Default 0 keeps the static Unit 25 visual. */
  raisedCount?: number;
  children: ReactNode;
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
        cardType,
        itemCount,
      }),
    }).catch(() => {});
  }, [cardType, surface, noteId, itemCount]);

  const raised = raisedCount > 0;
  return (
    <Card
      data-raised={raised ? 'true' : undefined}
      className={cn(raised && 'border-l-2 border-l-[var(--status-info-fg)]')}
    >
      <CardHeader>
        <CardTitle className="text-md flex items-center justify-between gap-2">
          <span>{title}</span>
          {raised && (
            <span className="text-[10px] uppercase tracking-wide text-[var(--status-info-fg)]">
              Mentioned just now
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Count how many of the supplied fhirResourceIds appear in the raised
 *  set. Each card uses this to compute its `raisedCount` for the shell. */
export function countRaisedRows(ids: string[], raised: Set<string> | undefined): number {
  if (!raised || raised.size === 0) return 0;
  let n = 0;
  for (const id of ids) if (raised.has(id)) n += 1;
  return n;
}

/** Tailwind classes for a row whose fhirResourceId is in the raised set. */
export const RAISED_ROW_CLASSES = 'border-l-2 border-l-[var(--status-info-fg)] pl-2 -ml-2';
