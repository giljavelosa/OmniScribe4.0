'use client';

import type { ReactNode } from 'react';
import { RecordingStatus } from './RecordingStatus';
import { AudioLevelBars } from './AudioLevelBars';
import { TranscriptWorkspace } from './TranscriptWorkspace';
import { PriorContextPanel } from './PriorContextPanel';
import { LiveNotePanel } from './LiveNotePanel';
import { RecordingControls } from './RecordingControls';
import { PlanForTodayCard } from '@/components/copilot/cards/plan-for-today-card';
import { FhirWatchCardsLive } from '@/components/copilot/cards/fhir-watch-cards-live';
import type { PriorContextBriefContent } from '@/types/brief';
import type { ExternalEhrContext } from '@/lib/fhir/project-ehr-context';

type LiveFollowUp = {
  id: string;
  text: string;
  status: 'OPEN' | 'MET' | 'CARRIED' | 'DROPPED' | 'CLOSED_BY_DISCHARGE';
  source: { noteId: string; date: string };
};

type Props = {
  noteId: string;
  patientHeader: ReactNode;
  stubBanner: ReactNode;
  /** Late-entry charting (spec: context/specs/late-entry-charting.md) —
   *  rendered above the stub banner so the late-entry framing is the first
   *  thing the clinician sees. Null/undefined for normal visits. */
  lateEntryBanner?: ReactNode;
  brief: PriorContextBriefContent | null;
  initialOpenFollowUps: LiveFollowUp[];
  patientDisplayName: string;
  patientId: string;
  nowMs: number;
  hasPriorSignedNote: boolean;
  /** Unit 25 / Watch v1 — projected FHIR cache for the FhirWatchCardsLive
   *  bundle. Null when patient has no verified PatientFhirIdentity or
   *  the cache is empty / fully stale; bundle renders nothing then. */
  fhirContext: ExternalEhrContext | null;
  /** Forwarded to RecordingControls. True for a fresh LIVE PREPARING note;
   *  triggers a 1.5s countdown then auto-fires start(). */
  autostart?: boolean;
};

/**
 * Desktop (lg+) layout per spec §Design "Two layouts":
 *   Left pane (flex-1): VU meter + transcript
 *   Right pane (46vw, max 680px): prior context + live note
 *   Bottom controls bar (fixed-ish — inside the flex column)
 */
export function DesktopCaptureLayout({
  noteId,
  patientHeader,
  stubBanner,
  lateEntryBanner,
  brief,
  initialOpenFollowUps,
  patientDisplayName,
  patientId,
  nowMs,
  hasPriorSignedNote,
  fhirContext,
  autostart,
}: Props) {
  return (
    <div className="hidden lg:flex flex-col h-[calc(100vh-3.25rem)]">
      <header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          {patientHeader}
        </div>
        <RecordingStatus />
      </header>

      {lateEntryBanner ? <div className="px-6 pt-3">{lateEntryBanner}</div> : null}
      {stubBanner}

      <div className="flex-1 flex min-h-0">
        <section className="flex-1 flex flex-col p-4 gap-3 min-w-0">
          <div className="flex items-center gap-3">
            <AudioLevelBars />
            <span className="text-xs text-muted-foreground">Mic input</span>
          </div>
          <TranscriptWorkspace />
        </section>

        <aside className="w-[46vw] max-w-[680px] border-l border-border p-4 space-y-3 overflow-y-auto">
          <PriorContextPanel
            brief={brief}
            initialOpenFollowUps={initialOpenFollowUps}
            patientDisplayName={patientDisplayName}
            patientId={patientId}
            nowMs={nowMs}
            hasPriorSignedNote={hasPriorSignedNote}
          />
          {brief && (
            <PlanForTodayCard
              items={brief.carryForwardPlan.map((text) => ({
                text,
                source: { noteId: brief.lastVisit.noteId, date: brief.lastVisit.date },
              }))}
              surface="capture"
              noteId={noteId}
            />
          )}
          <FhirWatchCardsLive
            context={fhirContext}
            surface="capture"
            noteId={noteId}
            nowMs={nowMs}
          />
          <LiveNotePanel />
        </aside>
      </div>

      <footer className="border-t border-border bg-card px-6 py-3">
        <RecordingControls noteId={noteId} autostart={autostart} />
      </footer>
    </div>
  );
}
