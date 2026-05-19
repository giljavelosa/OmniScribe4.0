import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { PriorContextBriefContent } from '@/types/brief';
import { TelehealthRoomShell } from './_components/room-shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Telehealth room',
  robots: { index: false, follow: false },
};

/**
 * /telehealth/room/[scheduleId] — clinician-side telehealth surface.
 *
 * Auth chain:
 *   (clinical)/layout.tsx already enforces NextAuth + MFA. This page adds:
 *     - schedule exists in the signed-in org
 *     - TelehealthSession exists for the schedule (1:1) and is ACTIVE
 *     - session.noteId is set (Unit 16 always sets it on start)
 *     - schedule.clinicianOrgUserId === current orgUserId, OR caller is
 *       ORG_ADMIN (defense in depth)
 *
 * Pre-active sessions get a friendly card pointing back to /home; they
 * shouldn't normally land here because Unit 16's start endpoint is the
 * only path that flips status to ACTIVE and that endpoint is admin-only.
 */
export default async function TelehealthRoomPage({
  params,
}: {
  params: Promise<{ scheduleId: string }>;
}) {
  const { scheduleId } = await params;
  const session = await auth();
  if (!session?.user?.orgId || !session.user.orgUserId) redirect('/login');
  const { orgId, orgUserId, role } = session.user;

  const schedule = await prisma.schedule.findFirst({
    where: { id: scheduleId, orgId },
    include: {
      patient: {
        select: { id: true, firstName: true, lastName: true, mrn: true, dob: true },
      },
    },
  });
  if (!schedule) notFound();

  const isOwningClinician = schedule.clinicianOrgUserId === orgUserId;
  const isPlatformAdmin = role === 'ORG_ADMIN';
  if (!isOwningClinician && !isPlatformAdmin) {
    return (
      <StatusBanner variant="danger" title="Not your visit">
        You can only join telehealth visits assigned to you.
      </StatusBanner>
    );
  }

  const tele = await prisma.telehealthSession.findUnique({
    where: { scheduleId },
    select: {
      id: true,
      status: true,
      roomUrl: true,
      noteId: true,
      magicExpiresAt: true,
    },
  });

  if (!tele) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No telehealth session</CardTitle>
          <CardDescription>
            This appointment doesn&apos;t have a telehealth session yet. Ask your admin to send the
            patient a magic link from the schedule.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (tele.status !== 'ACTIVE' || !tele.noteId || !tele.roomUrl) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Session not started</CardTitle>
          <CardDescription>
            The patient hasn&apos;t consented yet, or the session hasn&apos;t been started. Go back
            to your schedule and start the call when the patient is in the waiting room.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StatusBadge variant="neutral">{tele.status}</StatusBadge>
        </CardContent>
      </Card>
    );
  }

  // Prior-context brief — same lookup the in-person capture page does so the
  // clinician sees the same surface on either visit type.
  const brief = await prisma.noteBrief.findFirst({
    where: { patientId: schedule.patient.id, orgId },
    orderBy: { generatedAt: 'desc' },
  });
  const briefContent = (brief?.content ?? null) as PriorContextBriefContent | null;

  return (
    <TelehealthRoomShell
      noteId={tele.noteId}
      scheduleId={schedule.id}
      sessionId={tele.id}
      roomUrl={tele.roomUrl}
      patient={{
        id: schedule.patient.id,
        firstName: schedule.patient.firstName,
        lastName: schedule.patient.lastName,
        mrn: schedule.patient.mrn ?? null,
      }}
      brief={briefContent}
    />
  );
}
