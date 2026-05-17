'use client';

import type { ReactNode } from 'react';
import { RecordingStatus } from './RecordingStatus';
import { AudioLevelBars } from './AudioLevelBars';
import { TranscriptWorkspace } from './TranscriptWorkspace';
import { PriorContextPanel } from './PriorContextPanel';
import { LiveNotePanel } from './LiveNotePanel';
import { RecordingControls } from './RecordingControls';

type Props = {
  noteId: string;
  patientHeader: ReactNode;
  stubBanner: ReactNode;
};

/**
 * Desktop (lg+) layout per spec §Design "Two layouts":
 *   Left pane (flex-1): VU meter + transcript
 *   Right pane (46vw, max 680px): prior context + live note
 *   Bottom controls bar (fixed-ish — inside the flex column)
 */
export function DesktopCaptureLayout({ noteId, patientHeader, stubBanner }: Props) {
  return (
    <div className="hidden lg:flex flex-col h-[calc(100vh-3.25rem)]">
      <header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          {patientHeader}
        </div>
        <RecordingStatus />
      </header>

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
          <PriorContextPanel />
          <LiveNotePanel />
        </aside>
      </div>

      <footer className="border-t border-border bg-card px-6 py-3">
        <RecordingControls noteId={noteId} />
      </footer>
    </div>
  );
}
