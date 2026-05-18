import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBanner } from '@/components/ui/status-banner';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PreflightShell } from './_components/preflight-shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Preflight checks',
  robots: { index: false, follow: false },
};

/**
 * /telehealth/preflight/[scheduleId] — clinician's pre-call diagnostic.
 *
 * Server gate is intentionally LOOSER than the room page's: a clinician
 * can preflight before the patient has consented (or even before the
 * admin starts the session). Useful pattern: clinician sets up their
 * gear during a five-minute gap, walks away, returns when the patient is
 * in the waiting room.
 *
 * Required: schedule exists in the signed-in org + clinicianOrgUserId
 * matches the caller (or caller is SUPER_ADMIN).
 */
export default async function TelehealthPreflightPage({
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
    select: {
      id: true,
      clinicianOrgUserId: true,
      scheduledStart: true,
      patient: { select: { firstName: true, lastName: true } },
    },
  });
  if (!schedule) notFound();

  const isOwningClinician = schedule.clinicianOrgUserId === orgUserId;
  if (!isOwningClinician && role !== 'SUPER_ADMIN') {
    return (
      <StatusBanner variant="danger" title="Not your visit">
        You can only preflight telehealth visits assigned to you.
      </StatusBanner>
    );
  }

  return (
    <div className="px-6 py-10 max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Pre-call checks</CardTitle>
          <CardDescription>
            Quick setup test for your visit with {schedule.patient.firstName} {schedule.patient.lastName[0] ?? ''}.
            Make sure your mic is on, your network is steady, and your browser supports the call before joining the room.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PreflightShell scheduleId={schedule.id} />
        </CardContent>
      </Card>
    </div>
  );
}
