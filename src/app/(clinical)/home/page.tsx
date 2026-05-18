import type { Metadata } from 'next';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SchedulingCard } from '@/components/clinical/scheduling-card';
import { HomeSearchForm } from './_components/home-search-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Home' };

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.orgId || !session.user.orgUserId) return null;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const schedules = await prisma.schedule.findMany({
    where: {
      orgId: session.user.orgId,
      clinicianOrgUserId: session.user.orgUserId,
      scheduledStart: { gte: dayStart, lt: dayEnd },
    },
    orderBy: { scheduledStart: 'asc' },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
      encounter: {
        select: {
          id: true,
          notes: { orderBy: { createdAt: 'asc' }, take: 1, select: { id: true } },
        },
      },
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2lg font-semibold">Today</h1>
        <p className="text-sm text-muted-foreground">
          {dayStart.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} ·{' '}
          {session.user.email}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No visits scheduled for today.</p>
          ) : (
            schedules.map((s) => (
              <SchedulingCard
                key={s.id}
                visit={{
                  scheduleId: s.id,
                  patientId: s.patient.id,
                  patientName: `${s.patient.lastName}, ${s.patient.firstName}`,
                  mrn: s.patient.mrn,
                  scheduledStart: s.scheduledStart.toISOString(),
                  scheduledEnd: s.scheduledEnd.toISOString(),
                  visitType: s.visitType,
                  status: s.status,
                  hasEncounter: !!s.encounter,
                  encounterNoteId: s.encounter?.notes[0]?.id ?? null,
                }}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Find a patient</CardTitle>
        </CardHeader>
        <CardContent>
          <HomeSearchForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Drafts</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Drafts queue arrives in Unit 05 (Note Generation &amp; Sign).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
