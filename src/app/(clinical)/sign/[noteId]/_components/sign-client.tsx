'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBanner } from '@/components/ui/status-banner';

type Props = {
  noteId: string;
  patientName: string;
  mrn: string;
  division: string;
  sections: Array<{ id: string; label: string; content: string; required: boolean }>;
};

/**
 * Sign client — read-only final preview + MFA re-verify input + Sign Note
 * CTA. The MFA re-verify is required regardless of forceMfa (Unit 01 D2:
 * MFA always required for everyone; sign is a sensitive action ⇒ always
 * re-verify).
 */
export function SignClient({ noteId, patientName, mrn, division, sections }: Props) {
  const router = useRouter();
  const [mfaToken, setMfaToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function sign() {
    setError(null);
    if (!/^\d{6}$/.test(mfaToken)) {
      setError('Enter a 6-digit code from your authenticator.');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/notes/${noteId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const code = body?.error?.code as string | undefined;
        if (code === 'invalid_mfa') setError('Invalid 6-digit code.');
        else if (code === 'not_ready') setError('Required sections still need attention — return to review.');
        else if (code === 'already_signed') setError('This note is already signed.');
        else setError(body?.error?.message ?? `Sign failed (${res.status}).`);
        return;
      }
      router.push(`/review/${noteId}`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2lg font-semibold">Sign note</h1>
        <p className="text-sm text-muted-foreground">
          {patientName} <span className="font-mono">{mrn}</span> · {division}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Final preview</CardTitle>
          <CardDescription>
            What you sign is exactly this. After signing, the note is immutable; addenda live in a separate
            artifact.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No populated sections to preview.</p>
          ) : (
            sections.map((s) => (
              <div key={s.id}>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
                <pre className="mt-1 whitespace-pre-wrap font-sans text-sm leading-relaxed">
                  {s.content || '(empty)'}
                </pre>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Attest + sign</CardTitle>
          <CardDescription>
            By entering your 6-digit MFA code and tapping Sign Note, you attest that the content above
            accurately reflects today&apos;s visit and that you take responsibility for the documented
            care.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="sign-mfa">6-digit MFA code</Label>
            <Input
              id="sign-mfa"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={mfaToken}
              onChange={(e) => setMfaToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={pending}
            />
          </div>
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          <div className="flex items-center gap-3">
            <Button onClick={sign} disabled={pending || mfaToken.length !== 6}>
              {pending ? 'Signing…' : 'Sign note'}
            </Button>
            <Button asChild variant="outline">
              <Link href={`/review/${noteId}`}>Back to review</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
