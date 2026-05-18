'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBanner } from '@/components/ui/status-banner';
import { PASSWORD_POLICY_DESCRIPTION } from '@/lib/auth/password-policy';

type Stage = 'password' | 'signing-in';

export function OnboardingWizard({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('password');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw !== confirm) {
      setError('Passwords don\'t match.');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/onboarding/${token}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (res.status === 410) setError('This invite link has expired or already been used.');
        else if (body?.error?.code === 'weak_password') setError(body.error.message ?? 'Password too weak.');
        else setError('Could not set password.');
        return;
      }
      setStage('signing-in');
      // Auto sign-in. The clinical layout's D2 redirect chain will route the
      // user to /mfa-setup since their fresh account has mfaEnabled=false.
      const signinRes = await signIn('credentials', {
        email,
        password: pw,
        redirect: false,
      });
      if (!signinRes || signinRes.error) {
        setError('Account created but auto sign-in failed. Please sign in from /login.');
        return;
      }
      router.push('/mfa-setup');
      router.refresh();
    });
  }

  if (stage === 'signing-in') {
    return <p className="text-sm text-muted-foreground">Signing you in…</p>;
  }

  return (
    <form onSubmit={setPassword} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Step 1 of 2 — choose a password. (Step 2 sets up multi-factor authentication.)
      </p>
      <div className="space-y-2">
        <Label htmlFor="pw">Password for {email}</Label>
        <Input
          id="pw"
          type="password"
          autoComplete="new-password"
          required
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">{PASSWORD_POLICY_DESCRIPTION}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={pending}
        />
      </div>
      {error && (
        <StatusBanner variant="danger" title="Couldn&apos;t continue">{error}</StatusBanner>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Creating account…' : 'Continue'}
      </Button>
    </form>
  );
}
