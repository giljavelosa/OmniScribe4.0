import type { Metadata } from 'next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBanner } from '@/components/ui/status-banner';
import { prisma } from '@/lib/prisma';
import { isExpired } from '@/lib/telehealth/magic-link';
import { readPatientSessionToken } from '@/lib/telehealth/patient-session';
import { WaitingRoom } from './_components/waiting-room';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Waiting room',
  robots: { index: false, follow: false },
};

const CURRENT_CONSENT_VERSION = 'v1-default';

/**
 * /telehealth/waiting/[scheduleId] — patient waiting room.
 *
 * Auth: httpOnly tele_session cookie (set by POST /verify). Server-side
 * we resolve cookie → session, then sanity-check that the session's
 * scheduleId matches the URL. If a stale cookie points at a different
 * session, treat it as a re-verify needed (no info leak — we just
 * redirect to a generic "link expired" surface).
 *
 * Status drives the UI: VERIFIED → consent form, CONSENT_CAPTURED →
 * "waiting for provider", ACTIVE → "join call" CTA (room URL surfaced
 * by /me/status poll). Polling itself happens client-side.
 */
export default async function PatientWaitingRoomPage({
  params,
}: {
  params: Promise<{ scheduleId: string }>;
}) {
  const { scheduleId } = await params;
  const token = await readPatientSessionToken();

  if (!token) {
    return (
      <StatusBanner variant="warning" title="Verify your identity first">
        Open the telehealth link from your appointment email and enter your date of birth to continue.
      </StatusBanner>
    );
  }

  const session = await prisma.telehealthSession.findUnique({
    where: { magicToken: token },
    select: {
      id: true,
      status: true,
      scheduleId: true,
      magicExpiresAt: true,
      verifiedAt: true,
      consentAt: true,
      consentVersion: true,
      schedule: {
        select: {
          scheduledStart: true,
          scheduledEnd: true,
          clinicianOrgUserId: true,
        },
      },
    },
  });

  if (
    !session ||
    session.scheduleId !== scheduleId ||
    !session.verifiedAt ||
    session.status === 'EXPIRED' ||
    session.status === 'CANCELLED' ||
    isExpired(session.magicExpiresAt)
  ) {
    return (
      <StatusBanner variant="danger" title="This visit isn’t available right now">
        Please contact your clinic to request a fresh telehealth link.
      </StatusBanner>
    );
  }

  // Session ended while patient was elsewhere — friendly close-out, not an error.
  if (session.status === 'COMPLETED') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Visit complete</CardTitle>
          <CardDescription>
            Thanks for joining your telehealth visit. You can close this page.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const clinicianOrgUser = await prisma.orgUser.findUnique({
    where: { id: session.schedule.clinicianOrgUserId },
    select: { user: { select: { name: true } } },
  });
  const clinicianName = clinicianOrgUser?.user.name ?? 'your provider';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Telehealth waiting room</CardTitle>
        <CardDescription>
          You&apos;re checked in for your visit with {clinicianName}. {' '}
          {session.status === 'ACTIVE'
            ? 'Your provider is ready — tap “Join call” below.'
            : 'Your provider will join shortly. Please don’t close this page.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <WaitingRoom
          initialStatus={session.status}
          consentVersion={CURRENT_CONSENT_VERSION}
          scheduledStartIso={session.schedule.scheduledStart.toISOString()}
        />
      </CardContent>
    </Card>
  );
}
