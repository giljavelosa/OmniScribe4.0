'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { KeyRound, ShieldCheck, Unlock } from 'lucide-react';
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

type PinState = { hasPin: boolean; unlockedUntil: string | null } | null;

/**
 * Sign client — read-only final preview + sign-time auth.
 *
 * Auth mode is chosen by the user's signing-PIN setup:
 *   - unlocked window active (PIN verified in last 30 min)  → just "Sign note"
 *   - PIN set but locked                                    → 4-digit PIN input
 *   - no PIN set                                            → 6-digit TOTP input
 *                                                            with a one-time
 *                                                            "Set up signing PIN"
 *                                                            offer.
 */
export function SignClient({ noteId, patientName, mrn, division, sections }: Props) {
  const router = useRouter();
  const [pinState, setPinState] = useState<PinState>(null);
  const [authValue, setAuthValue] = useState(''); // 6-digit TOTP or 4-digit PIN
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [sweepOpen, setSweepOpen] = useState(false);
  const [sweepFollowUps, setSweepFollowUps] = useState<SweepFollowUp[]>([]);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const lastAuthValueRef = useRef<string>('');

  useEffect(() => {
    void fetch('/api/auth/pin/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setPinState(body?.data ?? { hasPin: false, unlockedUntil: null }))
      .catch(() => setPinState({ hasPin: false, unlockedUntil: null }));
  }, []);

  const isUnlocked = !!pinState?.unlockedUntil;
  const hasPin = !!pinState?.hasPin;

  function postSign(opts: { sweepAcknowledged: boolean; mfaToken?: string }) {
    return fetch(`/api/notes/${noteId}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mfaToken: opts.mfaToken,
        sweepAcknowledged: opts.sweepAcknowledged,
      }),
    });
  }

  async function unlockWithPin(pin: string) {
    const res = await fetch('/api/auth/pin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error?.code === 'invalid_pin' ? 'Wrong PIN.' : 'PIN verify failed.');
    }
    const body = await res.json();
    setPinState({ hasPin: true, unlockedUntil: body?.data?.unlockedUntil ?? null });
  }

  function sign() {
    setError(null);
    startTransition(async () => {
      try {
        if (isUnlocked) {
          // No input required — server honors the unlock window.
          const res = await postSign({ sweepAcknowledged: false });
          return handleSignResponse(res);
        }
        if (hasPin) {
          if (!/^\d{4}$/.test(authValue)) {
            setError('Enter your 4-digit signing PIN.');
            return;
          }
          await unlockWithPin(authValue);
          lastAuthValueRef.current = authValue;
          const res = await postSign({ sweepAcknowledged: false });
          return handleSignResponse(res);
        }
        // No PIN set — fall back to TOTP.
        if (!/^\d{6}$/.test(authValue)) {
          setError('Enter the 6-digit code from your authenticator.');
          return;
        }
        lastAuthValueRef.current = authValue;
        const res = await postSign({ sweepAcknowledged: false, mfaToken: authValue });
        return handleSignResponse(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  async function handleSignResponse(res: Response) {
    if (res.ok) {
      router.push(`/review/${noteId}`);
      router.refresh();
      return;
    }
    const body = await res.json().catch(() => null);
    const code = body?.error?.code as string | undefined;
    if (code === 'open_followups_present') {
      setSweepFollowUps((body?.data?.openFollowUps ?? []) as SweepFollowUp[]);
      setSweepOpen(true);
      return;
    }
    if (code === 'invalid_mfa') setError('Invalid 6-digit code.');
    else if (code === 'invalid_pin') setError('Wrong PIN.');
    else if (code === 'auth_required') setError(body?.error?.message ?? 'Authorization required.');
    else if (code === 'not_ready') setError('Required sections still need attention — return to review.');
    else if (code === 'already_signed') setError('This note is already signed.');
    else setError(body?.error?.message ?? `Sign failed (${res.status}).`);
  }

  function afterSweepResolved() {
    setSweepOpen(false);
    setSweepFollowUps([]);
    startTransition(async () => {
      const res = await postSign({
        sweepAcknowledged: true,
        mfaToken: !isUnlocked && !hasPin ? lastAuthValueRef.current : undefined,
      });
      await handleSignResponse(res);
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
          <CardTitle className="text-md flex items-center gap-2">
            {isUnlocked ? (
              <>
                <Unlock className="size-4 text-[var(--status-success-fg)]" aria-hidden />
                Attest + sign — unlocked
              </>
            ) : hasPin ? (
              <>
                <KeyRound className="size-4" aria-hidden />
                Attest + sign — enter signing PIN
              </>
            ) : (
              <>
                <ShieldCheck className="size-4" aria-hidden />
                Attest + sign — enter authenticator code
              </>
            )}
          </CardTitle>
          <CardDescription>
            By tapping Sign Note you attest that the content above accurately reflects today&apos;s visit
            and that you take responsibility for the documented care.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isUnlocked && hasPin && (
            <div className="space-y-2">
              <Label htmlFor="sign-pin">4-digit signing PIN</Label>
              <Input
                id="sign-pin"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={authValue}
                onChange={(e) => setAuthValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
                disabled={pending}
                placeholder="••••"
              />
              <p className="text-xs text-muted-foreground">
                After verifying, you won&apos;t be re-prompted for 30 minutes.
              </p>
            </div>
          )}
          {!isUnlocked && !hasPin && (
            <div className="space-y-2">
              <Label htmlFor="sign-mfa">6-digit authenticator code</Label>
              <Input
                id="sign-mfa"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={authValue}
                onChange={(e) => setAuthValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={pending}
              />
              <button
                type="button"
                className="text-xs underline text-muted-foreground hover:text-foreground"
                onClick={() => setShowPinSetup(true)}
              >
                Set up a 4-digit signing PIN so you don&apos;t have to type the authenticator code each time
              </button>
            </div>
          )}
          {isUnlocked && (
            <p className="text-sm text-muted-foreground">
              Signing PIN verified — sign without re-entering until {formatTime(pinState!.unlockedUntil!)}.
            </p>
          )}
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          <div className="flex items-center gap-3">
            <Button
              onClick={sign}
              disabled={
                pending ||
                (!isUnlocked && hasPin && authValue.length !== 4) ||
                (!isUnlocked && !hasPin && authValue.length !== 6)
              }
            >
              {pending ? 'Signing…' : 'Sign note'}
            </Button>
            <Button asChild variant="outline">
              <Link href={`/review/${noteId}`}>Back to review</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {showPinSetup && (
        <PinSetupInline
          onClose={(setNow) => {
            setShowPinSetup(false);
            if (setNow) {
              // Re-fetch status so the UI flips to PIN-mode.
              void fetch('/api/auth/pin/status')
                .then((r) => r.json())
                .then((body) => setPinState(body?.data ?? null));
            }
          }}
        />
      )}

      <SignFollowUpSweep
        open={sweepOpen}
        onOpenChange={(next) => {
          if (!next) setSweepOpen(false);
        }}
        followUps={sweepFollowUps}
        onResolved={afterSweepResolved}
      />
    </div>
  );
}

function PinSetupInline({ onClose }: { onClose: (setNow: boolean) => void }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!/^\d{4}$/.test(pin)) return setError('PIN must be 4 digits.');
    if (pin !== confirmPin) return setError('PINs do not match.');
    startTransition(async () => {
      const res = await fetch('/api/auth/pin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No TOTP — server accepts first-time setup based on the session's
        // mfaVerified flag (user already passed MFA at sign-in).
        body: JSON.stringify({ newPin: pin }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Setup failed (${res.status}).`);
        return;
      }
      onClose(true);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">Set up signing PIN</CardTitle>
        <CardDescription>
          Pick a 4-digit PIN to use instead of typing your authenticator code every time. The unlock
          window is 30 minutes per verify. You can change the PIN later from your profile.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="setup-pin">New 4-digit PIN</Label>
          <Input
            id="setup-pin"
            inputMode="numeric"
            type="password"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            disabled={pending}
            placeholder="••••"
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="setup-confirm">Confirm 4-digit PIN</Label>
          <Input
            id="setup-confirm"
            inputMode="numeric"
            type="password"
            maxLength={4}
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            disabled={pending}
            placeholder="••••"
          />
        </div>
        {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Saving…' : 'Save PIN'}
          </Button>
          <Button variant="outline" onClick={() => onClose(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}
