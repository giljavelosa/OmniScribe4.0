import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PasswordResetConfirmForm } from './_components/confirm-form';

export const metadata: Metadata = { title: 'Set new password' };
export const dynamic = 'force-dynamic';

export default function PasswordResetConfirmPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Set new password</CardTitle>
        <CardDescription>Choose a new password for your OmniScribe account.</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <PasswordResetConfirmForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
