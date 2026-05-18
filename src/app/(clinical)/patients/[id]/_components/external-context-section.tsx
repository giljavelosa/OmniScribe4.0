'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { ExternalContextAddDialog } from './external-context-add-dialog';
import { ExternalContextDetailSheet } from './external-context-detail-sheet';

export type ExternalContextSummary = {
  id: string;
  dateOfRecord: string; // ISO
  source: ExternalContextSource;
  sourceLabel: string | null;
  status: ExternalContextStatus;
  addedAt: string; // ISO
  hasAudio: boolean;
  episodeOfCareId: string | null;
  addedBy: {
    orgUserId: string;
    email: string;
    name: string | null;
  };
};

export type ExternalContextSource =
  | 'PATIENT_SUPPLIED'
  | 'OUTSIDE_PROVIDER'
  | 'EARLIER_UNDOCUMENTED'
  | 'CLINICIAN_NOTES'
  | 'OTHER';

export type ExternalContextStatus = 'PENDING_TRANSCRIPTION' | 'READY' | 'FAILED';

export type EpisodeChoice = {
  id: string;
  label: string;
};

const SOURCE_LABEL: Record<ExternalContextSource, string> = {
  PATIENT_SUPPLIED: 'Patient-supplied',
  OUTSIDE_PROVIDER: 'Outside provider',
  EARLIER_UNDOCUMENTED: 'Earlier undocumented visit',
  CLINICIAN_NOTES: "Clinician's notes",
  OTHER: 'Other',
};

/**
 * Prior-context section on the patient chart. Server-component-friendly
 * shell: receives the initial list as a prop, then re-fetches client-side
 * after add / detail-view actions so the UI is always live.
 *
 * Spec: context/specs/external-context-upload.md §UI.
 */
export function ExternalContextSection({
  patientId,
  episodeChoices,
  initialItems,
}: {
  patientId: string;
  episodeChoices: EpisodeChoice[];
  initialItems: ExternalContextSummary[];
}) {
  const [items, setItems] = useState<ExternalContextSummary[]>(initialItems);
  const [addOpen, setAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/patients/${patientId}/external-context`, {
      cache: 'no-store',
    });
    if (!res.ok) return;
    const body = (await res.json()) as { data: ExternalContextSummary[] };
    setItems(body.data);
  }, [patientId]);

  // Re-poll every 15 s when any row is still transcribing — gives the user
  // live progress without WebSocket plumbing. Bails when nothing is pending.
  useEffect(() => {
    const hasPending = items.some((r) => r.status === 'PENDING_TRANSCRIPTION');
    if (!hasPending) return;
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [items, refresh]);

  return (
    <Card data-section-id="prior-context">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Prior context</CardTitle>
            <CardDescription>
              External records added by the care team. Reference only — not part of any visit note.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Add prior context
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No prior context on file. Add a transcript, a note from a referring provider, or an audio file the patient sent in.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <ExternalContextRow
                key={item.id}
                item={item}
                onOpen={() => setDetailId(item.id)}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <ExternalContextAddDialog
        patientId={patientId}
        episodeChoices={episodeChoices}
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={() => {
          setAddOpen(false);
          void refresh();
        }}
      />
      {detailId ? (
        <ExternalContextDetailSheet
          patientId={patientId}
          externalContextId={detailId}
          open={!!detailId}
          onOpenChange={(open) => {
            if (!open) setDetailId(null);
          }}
        />
      ) : null}
    </Card>
  );
}

function ExternalContextRow({
  item,
  onOpen,
}: {
  item: ExternalContextSummary;
  onOpen: () => void;
}) {
  const dateLabel = item.dateOfRecord.slice(0, 10);
  const addedAtLabel = item.addedAt.slice(0, 10);
  const addedByLabel = item.addedBy.name ?? item.addedBy.email;
  const isPending = item.status === 'PENDING_TRANSCRIPTION';
  const isFailed = item.status === 'FAILED';

  return (
    <li className="py-3">
      <button
        type="button"
        onClick={onOpen}
        disabled={isPending}
        className="w-full text-left rounded-md px-2 py-2 -mx-2 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:hover:bg-transparent"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {dateLabel}
              <span className="mx-2 text-muted-foreground">·</span>
              {SOURCE_LABEL[item.source]}
              {item.sourceLabel ? (
                <>
                  <span className="mx-2 text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{item.sourceLabel}</span>
                </>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {item.hasAudio ? 'Audio + transcript' : 'Transcript only'}
              <span className="mx-2">·</span>
              added by {addedByLabel} {addedAtLabel}
            </p>
          </div>
          <div className="shrink-0">
            {isPending ? (
              <StatusBadge variant="info" noIcon>
                Transcribing…
              </StatusBadge>
            ) : isFailed ? (
              <StatusBadge variant="danger">Transcription failed</StatusBadge>
            ) : (
              <StatusBadge variant="success" noIcon>
                Ready
              </StatusBadge>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}
