'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { signIn, getSession } from 'next-auth/react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBanner } from '@/components/ui/status-banner';
import { postSigninRedirect } from '@/lib/post-signin-redirect';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });
      if (!res || res.error) {
        setError('Invalid email or password.');
        return;
      }
      // getSession() may race the JWT cookie write immediately after signIn.
      // Retry up to 3 times with a 150ms gap to let the cookie propagate,
      // then hard-navigate so the server always reads the fresh token.
      let session = await getSession();
      for (let i = 0; i < 2 && !session?.user; i++) {
        await new Promise((r) => setTimeout(r, 150));
        session = await getSession();
      }
      const target = postSigninRedirect({
        mfaEnabled: session?.user.mfaEnabled ?? false,
        mfaVerified: session?.user.mfaVerified ?? false,
      });
      window.location.assign(target);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/password-reset/request"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
        />
      </div>

      {error && (
        <StatusBanner variant="danger" title="Sign-in failed">
          {error}
        </StatusBanner>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
