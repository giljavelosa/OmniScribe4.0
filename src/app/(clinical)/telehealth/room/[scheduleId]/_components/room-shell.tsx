'use client';

import { Video } from 'lucide-react';

import { StatusBadge } from '@/components/ui/status-badge';
import type { PriorContextBriefContent } from '@/types/brief';

/**
 * Telehealth room shell — clinician-side layout.
 *
 * Commit 3 ships render-only: the Daily iframe + patient header so the
 * route resolves end-to-end and the gate behavior is reviewable in
 * isolation. Commit 4 wires the audio pipeline + transcript + controls;
 * Commit 5 wires the end-call handoff.
 */
export function TelehealthRoomShell({
  noteId,
  scheduleId,
  sessionId,
  roomUrl,
  patient,
  brief,
}: {
  noteId: string;
  scheduleId: string;
  sessionId: string;
  roomUrl: string;
  patient: { id: string; firstName: string; lastName: string; mrn: string | null };
  brief: PriorContextBriefContent | null;
}) {
  // Silence unused-arg warnings for IDs the next commits will consume.
  void noteId;
  void scheduleId;
  void sessionId;
  void brief;

  return (
    <div className="h-[calc(100vh-3.25rem)] flex flex-col">
      <header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-md font-semibold truncate">
            {patient.lastName}, {patient.firstName}
          </h1>
          {patient.mrn && <p className="text-xs text-muted-foreground font-mono">{patient.mrn}</p>}
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge variant="info" noIcon>
              <Video className="h-3 w-3 mr-1" aria-hidden />
              Telehealth
            </StatusBadge>
          </div>
        </div>
      </header>

      <div className="flex-1 grid lg:grid-cols-2 min-h-0">
        <section className="bg-black/90 flex items-center justify-center p-2">
          <iframe
            title="Telehealth video call"
            src={roomUrl}
            allow="camera; microphone; autoplay; display-capture"
            className="w-full h-full rounded-md border-0"
          />
        </section>
        <aside className="border-l border-border p-4 overflow-y-auto">
          <p className="text-sm text-muted-foreground">
            Live transcript + capture controls land in the next commit.
          </p>
        </aside>
      </div>
    </div>
  );
}
