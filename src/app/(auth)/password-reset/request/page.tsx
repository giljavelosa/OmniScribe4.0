import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PasswordResetRequestForm } from './_components/request-form';

export const metadata: Metadata = { title: 'Reset password' };

export default function PasswordResetRequestPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset password</CardTitle>
        <CardDescription>
          Enter your email. We&apos;ll send a link to set a new password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PasswordResetRequestForm />
      </CardContent>
    </Card>
  );
}
