'use client';

import { useEffect, useState } from 'react';
import type { EncounterIntent, Division } from '@prisma/client';

/**
 * Unit 48 PR2 — client hook for Miss Cleo's deterministic visit-type
 * intent proposal. Calls `GET /api/patients/[id]/proposed-intent` on
 * mount; result is fed into `<StartVisitDialog proposedIntent={…} />`.
 *
 * Design:
 *   - **Fetch eagerly on mount** so the proposal is ready before the
 *     clinician taps "Start visit." The endpoint is sub-100ms (60s
 *     server-side cache + deterministic calculator); fetch cost is
 *     negligible.
 *   - **Returns undefined while loading** — `<StartVisitDialog>`
 *     gracefully skips the chip when proposedIntent is undefined, so
 *     the UI behaves identically to today's flow during the brief
 *     fetch window.
 *   - **Returns undefined on error** — Decision 7 (Cleo's latency
 *     never blocks visit start). Error is logged but not surfaced;
 *     clinician picks intent manually from the dropdown when chip is
 *     absent (or the dialog auto-posts without intent for legacy
 *     unsupported divisions).
 *   - **Pass-through opts.episodeId / scheduleId** sharpen the
 *     proposal (e.g., schedule-driven ACUTE/family/group cues).
 *
 * Not exposed publicly: refetch / mutate / status. v1 is fire-and-
 * forget. If a caller needs to re-propose after episode change, just
 * unmount and remount the consuming component.
 */
export type UseProposedIntentResult =
  | undefined
  | {
      intent: EncounterIntent;
      division: Division;
      reason: string;
      confidence: 'high' | 'medium' | 'low';
    };

export function useProposedIntent(
  patientId: string,
  opts: { episodeId?: string | null; scheduleId?: string | null } = {},
): UseProposedIntentResult {
  const [result, setResult] = useState<UseProposedIntentResult>(undefined);

  const episodeId = opts.episodeId ?? null;
  const scheduleId = opts.scheduleId ?? null;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (episodeId) params.set('episodeId', episodeId);
    if (scheduleId) params.set('scheduleId', scheduleId);
    const qs = params.toString();
    const url = `/api/patients/${encodeURIComponent(patientId)}/proposed-intent${qs ? `?${qs}` : ''}`;

    fetch(url, { credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) return undefined;
        const body = (await res.json().catch(() => null)) as
          | { data?: UseProposedIntentResult }
          | null;
        return body?.data;
      })
      .then((data) => {
        if (cancelled) return;
        setResult(data ?? undefined);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[use-proposed-intent] fetch failed:', err);
        // Stay undefined; the dialog gracefully omits the chip.
      });

    return () => {
      cancelled = true;
    };
  }, [patientId, episodeId, scheduleId]);

  return result;
}
