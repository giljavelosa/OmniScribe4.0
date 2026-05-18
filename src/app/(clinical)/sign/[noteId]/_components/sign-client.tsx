'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBanner } from '@/components/ui/status-banner';
import { SignFollowUpSweep, type SweepFollowUp } from './sign-followup-sweep';

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
  const [sweepOpen, setSweepOpen] = useState(false);
  const [sweepFollowUps, setSweepFollowUps] = useState<SweepFollowUp[]>([]);
  // Holds the MFA token captured at the user's "Sign" click so the post-
  // sweep retry uses the same value without re-asking.
  const pendingMfaTokenRef = useRef<string | null>(null);

  function postSign(opts: { sweepAcknowledged: boolean }) {
    const token = pendingMfaTokenRef.current ?? mfaToken;
    return fetch(`/api/notes/${noteId}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken: token, sweepAcknowledged: opts.sweepAcknowledged }),
    });
  }

  function sign() {
    setError(null);
    if (!/^\d{6}$/.test(mfaToken)) {
      setError('Enter a 6-digit code from your authenticator.');
      return;
    }
    pendingMfaTokenRef.current = mfaToken;
    startTransition(async () => {
      const res = await postSign({ sweepAcknowledged: false });
      if (res.ok) {
        pendingMfaTokenRef.current = null;
        router.push(`/review/${noteId}`);
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => null);
      const code = body?.error?.code as string | undefined;
      if (code === 'open_followups_present') {
        const followUps = (body?.data?.openFollowUps ?? []) as SweepFollowUp[];
        setSweepFollowUps(followUps);
        setSweepOpen(true);
        return;
      }
      if (code === 'invalid_mfa') setError('Invalid 6-digit code.');
      else if (code === 'not_ready') setError('Required sections still need attention — return to review.');
      else if (code === 'already_signed') setError('This note is already signed.');
      else setError(body?.error?.message ?? `Sign failed (${res.status}).`);
    });
  }

  function afterSweepResolved() {
    setSweepOpen(false);
    setSweepFollowUps([]);
    startTransition(async () => {
      const res = await postSign({ sweepAcknowledged: true });
      if (res.ok) {
        pendingMfaTokenRef.current = null;
        router.push(`/review/${noteId}`);
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => null);
      const code = body?.error?.code as string | undefined;
      if (code === 'invalid_mfa') setError('Invalid 6-digit code.');
      else setError(body?.error?.message ?? `Sign failed after sweep (${res.status}).`);
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

      <SignFollowUpSweep
        open={sweepOpen}
        onOpenChange={(next) => {
          // Outside-tap is suppressed by AlertDialog itself; the only path
          // to close is the Skip/Continue buttons inside the modal, which
          // set state explicitly.
          if (!next) setSweepOpen(false);
        }}
        followUps={sweepFollowUps}
        onResolved={afterSweepResolved}
      />
    </div>
  );
}
