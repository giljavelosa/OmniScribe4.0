import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { MfaSetupWizard } from './_components/mfa-setup-wizard';

export const metadata: Metadata = { title: 'Set up authenticator' };
export const dynamic = 'force-dynamic';

export default async function MfaSetupPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.mfaEnabled) {
    // JWT already knows MFA is enrolled — go verify or home.
    redirect(session.user.mfaVerified ? '/home' : '/mfa-challenge');
  }

  // JWT says mfaEnabled=false, but the user may have completed
  // setup/confirm without the JWT being updated yet (mid-wizard refresh).
  // Check the DB directly so we don't re-run setup/begin and show a new QR.
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mfaEnabled: true },
  });
  if (dbUser?.mfaEnabled) {
    redirect('/mfa-challenge');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up authenticator</CardTitle>
        <CardDescription>
          An authenticator is required for every OmniScribe account. Takes about a minute.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MfaSetupWizard />
      </CardContent>
    </Card>
  );
}
