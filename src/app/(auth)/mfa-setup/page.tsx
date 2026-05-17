import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { MfaSetupWizard } from './_components/mfa-setup-wizard';

export const metadata: Metadata = { title: 'Set up MFA' };
export const dynamic = 'force-dynamic';

export default async function MfaSetupPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.mfaEnabled) {
    // Already enrolled — go verify or home depending on session state.
    redirect(session.user.mfaVerified ? '/home' : '/mfa-challenge');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up MFA</CardTitle>
        <CardDescription>
          MFA is required for every OmniScribe account. Takes about a minute.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MfaSetupWizard />
      </CardContent>
    </Card>
  );
}
