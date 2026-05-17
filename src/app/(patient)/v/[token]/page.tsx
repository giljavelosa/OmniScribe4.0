import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBanner } from '@/components/ui/status-banner';
import { prisma } from '@/lib/prisma';
import { isExpired } from '@/lib/telehealth/magic-link';
import { readPatientSessionToken } from '@/lib/telehealth/patient-session';
import { VerifyForm } from './_components/verify-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Verify identity',
  // Prevent search engines from indexing patient-link URLs even if they
  // leak — the magic token is the auth, and indexing increases blast radius.
  robots: { index: false, follow: false },
};

/**
 * /v/[token] — patient identity verification landing.
 *
 * The token IS the auth (~131 bits of entropy); this page renders the
 * DOB form on top of it. Spec §E: anti-enumeration on the VERIFY endpoint
 * (uniform 'invalid' for unknown/expired/wrong-DOB), but the spec
 * deliberately allows a distinct "link already used" UX here — only the
 * legitimate patient can reach that state via this URL, and the better UX
 * lets a confused patient ask their clinic for a fresh link.
 *
 * If the cookie matches the URL token AND the patient already verified,
 * skip the form entirely and bounce to the waiting room — covers the
 * "patient refreshed the verify URL" case.
 */
export default async function PatientVerifyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const cookieToken = await readPatientSessionToken();
  if (cookieToken === token) {
    const existing = await prisma.telehealthSession.findUnique({
      where: { magicToken: token },
      select: { verifiedAt: true, scheduleId: true, status: true },
    });
    if (
      existing?.verifiedAt &&
      (existing.status === 'VERIFIED' ||
        existing.status === 'CONSENT_CAPTURED' ||
        existing.status === 'ACTIVE')
    ) {
      redirect(`/telehealth/waiting/${existing.scheduleId}`);
    }
  }

  const session = await prisma.telehealthSession.findUnique({
    where: { magicToken: token },
    select: { status: true, magicExpiresAt: true, verifiedAt: true },
  });

  if (
    !session ||
    session.status === 'EXPIRED' ||
    session.status === 'CANCELLED' ||
    session.status === 'COMPLETED' ||
    isExpired(session.magicExpiresAt)
  ) {
    return (
      <StatusBanner variant="danger" title="This link is no longer valid">
        Please contact your clinic to request a fresh appointment link.
      </StatusBanner>
    );
  }

  if (session.verifiedAt) {
    return (
      <StatusBanner variant="warning" title="This link has already been used">
        For your security, telehealth links can only be opened once. Please contact your clinic to request a fresh link.
      </StatusBanner>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verify your identity</CardTitle>
        <CardDescription>
          Enter your date of birth to join your telehealth visit. This step protects your private health information.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VerifyForm token={token} />
      </CardContent>
    </Card>
  );
}
