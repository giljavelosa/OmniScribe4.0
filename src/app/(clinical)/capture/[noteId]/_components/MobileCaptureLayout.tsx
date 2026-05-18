'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';
import { RecordingStatus } from './RecordingStatus';
import { AudioLevelBars } from './AudioLevelBars';
import { TranscriptWorkspace } from './TranscriptWorkspace';
import { PriorContextPanel } from './PriorContextPanel';
import { LiveNotePanel } from './LiveNotePanel';
import { RecordingControls } from './RecordingControls';
import { useTranscript } from '../_hooks/capture-state';
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
};

/**
 * Mobile (< lg) layout per spec §Design: Tabs for Transcript / Live Note /
 * History / Setup. Pulsing dot on unviewed tabs when content updates while
 * a different tab is active.
 */
export function MobileCaptureLayout({
  noteId,
  patientHeader,
  stubBanner,
  brief,
  initialOpenFollowUps,
  patientDisplayName,
  patientId,
  nowMs,
  hasPriorSignedNote,
  fhirContext,
}: Props) {
  const [active, setActive] = useState<'transcript' | 'note' | 'history' | 'setup'>('transcript');
  const transcriptCountRef = useRef(0);
  const [transcriptDirty, setTranscriptDirty] = useState(false);
  const { segments, partial } = useTranscript();

  useEffect(() => {
    const totalLen = segments.length + (partial ? 1 : 0);
    if (totalLen > transcriptCountRef.current && active !== 'transcript') {
      setTranscriptDirty(true);
    }
    transcriptCountRef.current = totalLen;
  }, [active, partial, segments.length]);

  function onTabChange(next: string) {
    setActive(next as typeof active);
    if (next === 'transcript') setTranscriptDirty(false);
  }

  return (
    <div className="lg:hidden flex flex-col h-[calc(100vh-3.25rem)]">
      <header className="border-b border-border bg-card px-4 py-2 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 min-w-0">
          <div className="min-w-0">{patientHeader}</div>
          <RecordingStatus />
        </div>
        <div className="flex items-center gap-2">
          <AudioLevelBars />
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Mic</span>
        </div>
      </header>

      {stubBanner}

      <Tabs value={active} onValueChange={onTabChange} className="flex-1 flex flex-col min-h-0">
        <TabsList className="grid grid-cols-4 mx-2 mt-2">
          <TabsTrigger value="transcript" className="relative">
            Transcript
            {transcriptDirty && (
              <span
                aria-hidden
                className={cn(
                  'absolute top-1 right-2 h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse',
                )}
              />
            )}
          </TabsTrigger>
          <TabsTrigger value="note">Live note</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
        </TabsList>

        <TabsContent value="transcript" className="flex-1 p-2 min-h-0">
          <TranscriptWorkspace />
        </TabsContent>
        <TabsContent value="note" className="flex-1 p-2 min-h-0">
          <LiveNotePanel />
        </TabsContent>
        <TabsContent value="history" className="flex-1 p-2 min-h-0 overflow-y-auto space-y-3">
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
        </TabsContent>
        <TabsContent value="setup" className="flex-1 p-2 min-h-0">
          <p className="text-sm text-muted-foreground p-2">
            Visit setup (template + style) is configured on /prepare. This tab
            will surface mid-visit adjustments in a later unit.
          </p>
        </TabsContent>
      </Tabs>

      <footer className="border-t border-border bg-card px-4 py-3">
        <RecordingControls noteId={noteId} />
      </footer>
    </div>
  );
}
