'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBanner } from '@/components/ui/status-banner';
import { PASSWORD_POLICY_DESCRIPTION } from '@/lib/auth/password-policy';

export function PasswordResetConfirmForm() {
  const router = useRouter();
  const search = useSearchParams();
  const token = search.get('token') ?? '';
  const [tokenStatus, setTokenStatus] = useState<'checking' | 'valid' | 'invalid'>(
    token ? 'checking' : 'invalid',
  );
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/auth/password-reset/verify?token=${encodeURIComponent(token)}`);
      if (!cancelled) setTokenStatus(r.ok ? 'valid' : 'invalid');
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw !== confirm) {
      setError('Passwords don\'t match.');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: pw }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (res.status === 410) setError('This link has expired or already been used.');
        else if (body?.error?.code === 'weak_password') setError(body.error.message ?? 'Password too weak.');
        else setError('Could not reset password.');
        return;
      }
      setDone(true);
      setTimeout(() => router.push('/login'), 2000);
    });
  }

  if (tokenStatus === 'checking') return <p className="text-sm text-muted-foreground">Checking link…</p>;

  if (tokenStatus === 'invalid') {
    return (
      <StatusBanner variant="danger" title="Link expired">
        This password-reset link is no longer valid. Request a new one from{' '}
        <a className="underline" href="/password-reset/request">password reset</a>.
      </StatusBanner>
    );
  }

  if (done) {
    return (
      <StatusBanner variant="success" title="Password updated">
        Redirecting you to sign in…
      </StatusBanner>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pw">New password</Label>
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
        <StatusBanner variant="danger" title="Couldn&apos;t reset">{error}</StatusBanner>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Updating…' : 'Set new password'}
      </Button>
    </form>
  );
}
