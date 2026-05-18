'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useTranscript } from '@/app/(clinical)/capture/[noteId]/_hooks/capture-state';
import type { ExternalEhrContext } from '@/lib/fhir/project-ehr-context';
import { buildIndex, matchTranscript, type CardIndex } from '@/lib/copilot/topic-match';
import { FhirWatchCards, type RaisedFhirIdMap } from './fhir-watch-cards';
import type { CopilotSurface } from '../copilot-shell';

/**
 * Watch v2 live-trigger coordinator — Unit 26.
 *
 * Wraps the Unit 25 FhirWatchCards bundle. Subscribes to the capture
 * page's live transcript via useTranscript() (CaptureStateProvider
 * Context); on every transcript update, runs the pure matcher and
 * MERGES newly-matched fhirResourceIds into the accumulated raised
 * sets. Raised is sticky for the session per spec — once raised, the
 * row stays raised until unmount.
 *
 * Each cardType's first raise fires COPILOT_CARD_RAISED via the
 * existing client-side audit ingress. One audit row per cardType per
 * session (auditedRef guard); itemCount carries the number of rows
 * currently raised in that card at first-fire moment.
 *
 * ONLY mount on surfaces that have a CaptureStateProvider above them
 * (/capture). On /prepare keep mounting the static FhirWatchCards.
 */
export function FhirWatchCardsLive({
  context,
  surface,
  noteId,
  nowMs,
}: {
  context: ExternalEhrContext | null;
  surface: CopilotSurface;
  noteId: string;
  nowMs: number;
}) {
  const { segments, partial } = useTranscript();

  // Build the matcher index once per context. Cheap (tokenization +
  // small Map), but rebuilding on every transcript update would waste
  // work since the cache is request-scoped.
  const index = useMemo<CardIndex>(() => buildIndex(context), [context]);

  // Accumulated raised IDs per category. Sticky per session.
  const [raised, setRaised] = useState<RaisedFhirIdMap>({});

  // Per-cardType audit-fired guard. Once true, never fire again this session.
  const auditedRef = useRef<Record<keyof RaisedFhirIdMap, boolean>>({
    activeConditions: false,
    currentMedications: false,
    recentObservations: false,
    allergies: false,
  });

  // Subscribe to transcript changes. Compute matches against the
  // concatenated finalized transcript + the in-flight partial so a
  // mention is caught the moment Soniox returns the word, not when
  // it's finalized.
  useEffect(() => {
    if (!context) return;
    const transcriptText = [...segments.map((s) => s.text), partial].join(' ');
    if (transcriptText.trim().length === 0) return;

    const matches = matchTranscript(transcriptText, index);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRaised((prev) => mergeRaised(prev, matches));

    // Fire COPILOT_CARD_RAISED once per cardType.
    (['activeConditions', 'currentMedications', 'recentObservations', 'allergies'] as const).forEach(
      (cat) => {
        if (auditedRef.current[cat]) return;
        if (matches[cat].size === 0) return;
        auditedRef.current[cat] = true;
        const cardType =
          cat === 'activeConditions'
            ? 'active-conditions'
            : cat === 'currentMedications'
              ? 'current-medications'
              : cat === 'recentObservations'
                ? 'recent-observations'
                : 'allergies';
        void fetch('/api/audit/copilot-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'COPILOT_CARD_RAISED',
            surface,
            noteId,
            cardType,
            itemCount: matches[cat].size,
          }),
        }).catch(() => {});
      },
    );
  }, [segments, partial, context, index, surface, noteId]);

  return (
    <FhirWatchCards
      context={context}
      surface={surface}
      noteId={noteId}
      nowMs={nowMs}
      raised={raised}
    />
  );
}

function mergeRaised(prev: RaisedFhirIdMap, next: ReturnType<typeof matchTranscript>): RaisedFhirIdMap {
  // Identity-preserving merge: if no NEW ids in a category, keep the
  // previous Set reference so React's shallow compare doesn't force a
  // pointless re-render of the child cards.
  const out: RaisedFhirIdMap = {};
  let changed = false;
  for (const cat of ['activeConditions', 'currentMedications', 'recentObservations', 'allergies'] as const) {
    const prevSet = prev[cat];
    const nextSet = next[cat];
    if (nextSet.size === 0) {
      out[cat] = prevSet;
      continue;
    }
    if (!prevSet) {
      out[cat] = new Set(nextSet);
      changed = true;
      continue;
    }
    let added = 0;
    const merged = new Set(prevSet);
    for (const id of nextSet) {
      if (!merged.has(id)) {
        merged.add(id);
        added += 1;
      }
    }
    if (added === 0) {
      out[cat] = prevSet;
    } else {
      out[cat] = merged;
      changed = true;
    }
  }
  return changed ? out : prev;
}
