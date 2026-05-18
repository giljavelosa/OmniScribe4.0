'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  children,
}: {
  title: string;
  cardType: FhirCardType;
  surface: CopilotSurface;
  noteId: string;
  itemCount: number;
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
