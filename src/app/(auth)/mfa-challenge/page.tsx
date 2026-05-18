import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { MfaChallengeForm } from './_components/mfa-challenge-form';

export const metadata: Metadata = { title: 'Verify MFA' };
export const dynamic = 'force-dynamic';

export default async function MfaChallengePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!session.user.mfaEnabled) redirect('/mfa-setup');
  if (session.user.mfaVerified) redirect('/home');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verify MFA</CardTitle>
        <CardDescription>Enter the 6-digit code from your authenticator app.</CardDescription>
      </CardHeader>
      <CardContent>
        <MfaChallengeForm />
      </CardContent>
    </Card>
  );
}
