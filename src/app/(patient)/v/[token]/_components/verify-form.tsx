'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBanner } from '@/components/ui/status-banner';

/**
 * DOB form for /v/[token]. Submits to /api/telehealth/v/[token]/verify.
 *
 * Anti-enumeration: the server returns a single 'invalid' code for
 * unknown token / expired / consumed / DOB mismatch. We map all of those
 * to the same generic "Couldn't verify your identity" message — never
 * hint to the patient (or an attacker) which check failed.
 *
 * On success the verify route sets the httpOnly tele_session cookie and
 * returns scheduleId; we navigate to the waiting room. The token vanishes
 * from JS at that point.
 */
export function VerifyForm({ token }: { token: string }) {
  const router = useRouter();
  const [dob, setDob] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      setError('Please enter your date of birth.');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/telehealth/v/${encodeURIComponent(token)}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dob }),
      });
      if (!res.ok) {
        setError('We couldn’t verify your identity with that date of birth. Please double-check and try again, or contact your clinic.');
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { data?: { scheduleId?: string } }
        | null;
      const scheduleId = body?.data?.scheduleId;
      if (!scheduleId) {
        setError('Something went wrong. Please contact your clinic.');
        return;
      }
      router.push(`/telehealth/waiting/${scheduleId}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="dob">Date of birth</Label>
        <Input
          id="dob"
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          autoComplete="bday"
          required
          disabled={pending}
        />
      </div>
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      <Button type="submit" className="w-full" disabled={pending || !dob}>
        {pending ? 'Verifying…' : 'Continue'}
      </Button>
    </form>
  );
}
