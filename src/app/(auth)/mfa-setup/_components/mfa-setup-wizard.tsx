'use client';

import { useEffect, useState, useTransition } from 'react';
import { useSession } from 'next-auth/react';
import QRCode from 'qrcode';

import { completeMfaNavigation } from '@/lib/auth/complete-mfa-navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBanner } from '@/components/ui/status-banner';

type Stage = 'load' | 'scan' | 'codes' | 'done';

export function MfaSetupWizard() {
  const { update } = useSession();
  const [stage, setStage] = useState<Stage>('load');
  const [secret, setSecret] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/auth/mfa/setup/begin', { method: 'POST' });
      if (!res.ok) {
        if (!cancelled) setError('Could not start authenticator setup.');
        return;
      }
      const json = await res.json();
      const secret = json?.data?.secret as string | undefined;
      const uri = json?.data?.uri as string | undefined;
      if (!secret || !uri) {
        if (!cancelled) setError('Malformed authenticator setup response.');
        return;
      }
      const dataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 256 });
      if (!cancelled) {
        setSecret(secret);
        setQrDataUrl(dataUrl);
        setStage('scan');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function confirmEnrollment(e: React.FormEvent) {
    e.preventDefault();
    if (!secret) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/auth/mfa/setup/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, token: token.trim() }),
      });
      if (!res.ok) {
        setError('Invalid 6-digit code. Make sure your device clock is accurate and try again.');
        return;
      }
      const json = await res.json();
      const codes = (json?.data?.recoveryCodes ?? []) as string[];
      setRecoveryCodes(codes);
      setStage('codes');
    });
  }

  async function finish() {
    setStage('done');
    // Multi-site enrollment — the /onboarding-sites page short-circuits
    // straight to /home for org-wide-admins and anyone already enrolled,
    // so unconditional hard-nav here keeps the redirect logic in one place.
    await completeMfaNavigation(
      update,
      { mfaEnabled: true, mfaVerified: true },
      '/onboarding-sites',
    );
  }

  if (stage === 'load') {
    return (
      <p className="text-sm text-muted-foreground">Preparing your enrollment…</p>
    );
  }

  if (stage === 'scan' && qrDataUrl && secret) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Scan this QR with your authenticator app (Authy, 1Password, Google Authenticator,
          etc.) then enter the 6-digit code.
        </p>
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="Authenticator QR code" className="rounded-md border border-border" />
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Can&apos;t scan? Enter manually</summary>
          <p className="mt-2 font-mono break-all">{secret}</p>
        </details>
        <form onSubmit={confirmEnrollment} className="space-y-3">
          <Label htmlFor="enroll-token">6-digit code</Label>
          <Input
            id="enroll-token"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
          {error && (
            <StatusBanner variant="danger" title="Verification failed">
              {error}
            </StatusBanner>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Verifying…' : 'Verify & enroll'}
          </Button>
        </form>
      </div>
    );
  }

  if (stage === 'codes') {
    return (
      <div className="space-y-4">
        <StatusBanner variant="warning" title="Save these recovery codes">
          You won&apos;t see them again. Each code works once if you lose access to your authenticator.
        </StatusBanner>
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
          {recoveryCodes.map((c) => (
            <li key={c} className="rounded-md border border-border bg-muted px-2 py-1">{c}</li>
          ))}
        </ul>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={savedConfirmed}
            onChange={(e) => setSavedConfirmed(e.target.checked)}
          />
          I&apos;ve saved these recovery codes somewhere safe.
        </label>
        <Button onClick={finish} disabled={!savedConfirmed} className="w-full">
          Continue
        </Button>
      </div>
    );
  }

  return null;
}
