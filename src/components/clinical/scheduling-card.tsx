'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { UserAvatar } from '@/components/ui/user-avatar';
import {
  StartVisitDialog,
  type StartVisitDialogEpisode,
  type StartVisitSubmitArgs,
} from '@/app/(clinical)/patients/[id]/_components/start-visit-dialog';
import type { ScheduleStatus, VisitType } from '@prisma/client';

export type SchedulingCardData = {
  scheduleId: string;
  patientId: string;
  patientName: string;
  mrn: string | null;
  scheduledStart: string;     // ISO
  scheduledEnd: string;       // ISO
  visitType: VisitType;
  status: ScheduleStatus;
  hasEncounter: boolean;
  encounterNoteId: string | null;
  /** Pre-link set at scheduling time. When present, the schedule-start route
   * inherits it and the picker never opens. */
  scheduleEpisodeOfCareId?: string | null;
  /** Active episodes (status ∈ {ACTIVE, RECERT_DUE}) for the patient. Used to
   * decide whether the picker fires when scheduleEpisodeOfCareId is null. */
  activeEpisodes?: StartVisitDialogEpisode[];
};

const STATUS_VARIANT = {
  SCHEDULED: 'info',
  CONFIRMED: 'info',
  CHECKED_IN: 'success',
  IN_PROGRESS: 'success',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
  NO_SHOW: 'warning',
} as const;

export function SchedulingCard({ visit }: { visit: SchedulingCardData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeEpisodes = visit.activeEpisodes ?? [];
  // The picker only opens when (a) the schedule has no episode pre-link AND
  // (b) the patient has 2+ active episodes AND (c) the encounter doesn't
  // already exist (resume case skips the picker).
  const needsPicker =
    !visit.scheduleEpisodeOfCareId &&
    !visit.hasEncounter &&
    activeEpisodes.length >= 2;

  function startDirect() {
    setError(null);
    if (visit.encounterNoteId) {
      router.push(`/prepare/${visit.encounterNoteId}`);
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/schedules/${visit.scheduleId}/start`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Could not start the visit (${res.status}).`);
        return;
      }
      const body = await res.json();
      if (body?.data?.noteId) router.push(`/prepare/${body.data.noteId}`);
    });
  }

  // Picker submitter — POST /api/schedules/[id]/start so the schedule flips to
  // IN_PROGRESS atomically with the encounter+note creation.
  async function scheduleStartSubmit(
    args: StartVisitSubmitArgs,
  ): Promise<{ encounterId: string; noteId: string }> {
    const res = await fetch(`/api/schedules/${visit.scheduleId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        episodeOfCareId: args.episodeOfCareId,
        pickerSource: args.source,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(
        body?.error?.message ?? `Could not start the visit (${res.status}).`,
      );
    }
    const body = await res.json();
    if (!body?.data?.noteId || !body?.data?.encounterId) {
      throw new Error('Server response missing encounter or note id.');
    }
    return { encounterId: body.data.encounterId, noteId: body.data.noteId };
  }

  function onPickerStarted({ noteId }: { encounterId: string; noteId: string }) {
    router.push(`/prepare/${noteId}`);
  }

  function start() {
    if (needsPicker) {
      setPickerOpen(true);
      return;
    }
    startDirect();
  }

  const start24 = new Date(visit.scheduledStart);
  const end24 = new Date(visit.scheduledEnd);
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // patientName is "Last, First" — split to derive initials for the avatar.
  const [avatarLast = '', avatarFirst = ''] = visit.patientName.split(', ');

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <UserAvatar firstName={avatarFirst} lastName={avatarLast} size="md" className="shrink-0" />
            <div className="space-y-1 min-w-0">
              <p className="text-sm font-mono text-muted-foreground">
                {fmt(start24)} – {fmt(end24)}
              </p>
              <p className="font-medium truncate">
                <Link href={`/patients/${visit.patientId}`} className="hover:underline">
                  {visit.patientName}
                </Link>
                {visit.mrn && (
                  <span className="ml-2 text-xs text-muted-foreground font-mono">{visit.mrn}</span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusBadge variant={visit.visitType === 'TELEHEALTH' ? 'violet' : 'neutral'} noIcon>
                  {visit.visitType}
                </StatusBadge>
                <StatusBadge variant={STATUS_VARIANT[visit.status]} noIcon>
                  {visit.status}
                </StatusBadge>
              </div>
            </div>
          </div>
          <Button
            onClick={start}
            disabled={pending || visit.status === 'CANCELLED' || visit.status === 'COMPLETED'}
          >
            {visit.hasEncounter ? 'Resume' : pending ? 'Starting…' : 'Start'}
          </Button>
        </div>

        {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      </CardContent>

      <StartVisitDialog
        patientId={visit.patientId}
        activeEpisodes={activeEpisodes}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onStarted={onPickerStarted}
        submit={scheduleStartSubmit}
      />
    </Card>
  );
}
