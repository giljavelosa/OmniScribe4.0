'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import type { ScheduleStatus, VisitType } from '@prisma/client';

export type SchedulingCardData = {
  scheduleId: string;
  patientId: string;
  patientName: string;
  mrn: string;
  scheduledStart: string;     // ISO
  scheduledEnd: string;       // ISO
  visitType: VisitType;
  status: ScheduleStatus;
  hasEncounter: boolean;
  encounterNoteId: string | null;
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

  function start() {
    if (visit.encounterNoteId) {
      router.push(`/prepare/${visit.encounterNoteId}`);
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/schedules/${visit.scheduleId}/start`, { method: 'POST' });
      if (!res.ok) return;
      const body = await res.json();
      if (body?.data?.noteId) router.push(`/prepare/${body.data.noteId}`);
    });
  }

  const start24 = new Date(visit.scheduledStart);
  const end24 = new Date(visit.scheduledEnd);
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <p className="text-sm font-mono text-muted-foreground">
            {fmt(start24)} – {fmt(end24)}
          </p>
          <p className="font-medium truncate">
            <Link href={`/patients/${visit.patientId}`} className="hover:underline">
              {visit.patientName}
            </Link>
            <span className="ml-2 text-xs text-muted-foreground font-mono">{visit.mrn}</span>
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
        <Button onClick={start} disabled={pending || visit.status === 'CANCELLED' || visit.status === 'COMPLETED'}>
          {visit.hasEncounter ? 'Resume' : pending ? 'Starting…' : 'Start'}
        </Button>
      </CardContent>
    </Card>
  );
}
