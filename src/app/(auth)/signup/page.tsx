import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { SignupForm } from './_components/signup-form';

export const metadata: Metadata = { title: 'Create an OmniScribe org' };
export const dynamic = 'force-dynamic';

/**
 * /signup — Unit 37 public self-serve org creation page.
 *
 * Already-signed-in users get redirected to /home (mirrors /login).
 * Anonymous visitors see the form. Submission hits POST /api/auth/signup;
 * the client follows up with NextAuth sign-in + lands at /home.
 * Sprint 0.20 removed the post-signin MFA setup detour.
 */
export default async function SignupPage() {
  const session = await auth();
  if (session?.user) {
    redirect('/home');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your org</CardTitle>
        <CardDescription>
          Self-serve provisioning — STARTER tier; BAA countersignature
          activates real PHI processing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm />
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        Already have an account?&nbsp;
        <Link href="/login" className="underline hover:text-foreground">
          Sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
