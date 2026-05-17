'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBanner } from '@/components/ui/status-banner';

export function MfaChallengeForm() {
  const router = useRouter();
  const { update } = useSession();
  const [token, setToken] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), useRecoveryCode: useRecovery }),
      });
      if (!res.ok) {
        setError(useRecovery ? 'Invalid recovery code.' : 'Invalid 6-digit code.');
        return;
      }
      // Tell the JWT to flip mfaVerified=true.
      await update({ mfaVerified: true });
      router.push('/home');
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="mfa-token">{useRecovery ? 'Recovery code' : '6-digit code'}</Label>
        <Input
          id="mfa-token"
          inputMode={useRecovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          required
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={pending}
        />
      </div>

      {error && (
        <StatusBanner variant="danger" title="Verification failed">
          {error}
        </StatusBanner>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Verifying…' : 'Verify'}
      </Button>

      <button
        type="button"
        onClick={() => {
          setUseRecovery((v) => !v);
          setToken('');
          setError(null);
        }}
        className="block w-full text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        {useRecovery ? 'Use 6-digit code instead' : 'Use a recovery code'}
      </button>
    </form>
  );
}
