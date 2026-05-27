'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { KeyRound, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBanner } from '@/components/ui/status-banner';
import { LateEntryBanner } from '@/components/notes/late-entry-banner';
import { SignFollowUpSweep, type SweepFollowUp } from './sign-followup-sweep';

type Props = {
  noteId: string;
  patientName: string;
  mrn: string | null;
  division: string;
  sections: Array<{ id: string; label: string; content: string; required: boolean }>;
  /** Late-entry charting (spec: context/specs/late-entry-charting.md). */
  isLateEntry?: boolean;
  lateEntryDaysGap?: number | null;
  /** ISO date — the day care was delivered. */
  dateOfService?: string | null;
};

type PinState = { hasPin: boolean; unlockedUntil: string | null } | null;

/**
 * Sign client — read-only final preview + sign-time auth.
 *
 * Auth mode is chosen by the user's signing-PIN setup:
 *   - unlocked window active (PIN verified in last 30 min)  → just "Sign note"
 *   - PIN set but locked                                    → 4-digit PIN input
 *   - no PIN set                                            → inline PIN setup (required)
 */
export function SignClient({
  noteId,
  patientName,
  mrn,
  division,
  sections,
  isLateEntry = false,
  lateEntryDaysGap = null,
  dateOfService = null,
}: Props) {
  const router = useRouter();
  const [pinState, setPinState] = useState<PinState>(null);
  const [authValue, setAuthValue] = useState(''); // 4-digit signing PIN
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [sweepOpen, setSweepOpen] = useState(false);
  const [sweepFollowUps, setSweepFollowUps] = useState<SweepFollowUp[]>([]);
  const [showPinSetup, setShowPinSetup] = useState(false);
  // Sprint 0 flag-analysis lockdown — surfaced when the sign route
  // returns 409 `edited_since_analysis_unattested`. The list of
  // edited section ids comes back in `body.data.editedSectionIds` so
  // the panel can name them. The tick is sent on the NEXT sign POST
  // and audited server-side as NOTE_SIGNED_WITH_EDITED_SINCE_ANALYSIS_ATTESTATION.
  const [editedSectionIds, setEditedSectionIds] = useState<string[] | null>(null);
  const [editedAttested, setEditedAttested] = useState(false);
  const lastAuthValueRef = useRef<string>('');

  useEffect(() => {
    void fetch('/api/auth/pin/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setPinState(body?.data ?? { hasPin: false, unlockedUntil: null }))
      .catch(() => setPinState({ hasPin: false, unlockedUntil: null }));
  }, []);

  const isUnlocked = !!pinState?.unlockedUntil;
  const hasPin = !!pinState?.hasPin;

  function postSign(opts: {
    sweepAcknowledged: boolean;
    signPin?: string;
    editedSinceAnalysisAttested?: boolean;
  }) {
    return fetch(`/api/notes/${noteId}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signPin: opts.signPin,
        sweepAcknowledged: opts.sweepAcknowledged,
        editedSinceAnalysisAttested: opts.editedSinceAnalysisAttested,
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
    // If we've already surfaced the attestation panel, require the tick
    // before we POST again — server will refuse a second time
    // otherwise, and we don't want to waste a PIN verify on it.
    if (editedSectionIds && !editedAttested) {
      setError('Tick the attestation below to confirm you reviewed your edits.');
      return;
    }
    startTransition(async () => {
      try {
        const editedSinceAnalysisAttested = editedSectionIds ? editedAttested : undefined;
        if (isUnlocked) {
          // No input required — server honors the unlock window.
          const res = await postSign({ sweepAcknowledged: false, editedSinceAnalysisAttested });
          return handleSignResponse(res);
        }
        if (hasPin) {
          if (!/^\d{4}$/.test(authValue)) {
            setError('Enter your 4-digit signing PIN.');
            return;
          }
          await unlockWithPin(authValue);
          lastAuthValueRef.current = authValue;
          const res = await postSign({ sweepAcknowledged: false, editedSinceAnalysisAttested });
          return handleSignResponse(res);
        }
        setShowPinSetup(true);
        setError('Set up a signing PIN before you can sign notes.');
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
    if (code === 'invalid_pin') setError('Wrong PIN.');
    else if (code === 'pin_not_set') {
      setShowPinSetup(true);
      setError('Set up a signing PIN before you can sign notes.');
    }
    else if (code === 'auth_required') setError(body?.error?.message ?? 'Authorization required.');
    else if (code === 'not_ready') setError('Required sections still need attention — return to review.');
    else if (code === 'already_signed') setError('This note is already signed.');
    else if (code === 'flag_analysis_pending') {
      // Flag analyzer is still running. Tell the user clearly so they
      // don't guess; the analyzer typically completes in well under a
      // minute and re-clicking Sign will succeed.
      setError(
        body?.error?.message ??
          'AI is still analyzing this note for compliance flags. Wait a few seconds, then try again.',
      );
    }
    else if (code === 'open_red_flags') {
      // Hard block: at least one RED flag is unresolved. Send the
      // clinician back to /review to address them — they cannot be
      // bypassed at sign time.
      const count = (body?.data?.openRedCount as number | undefined) ?? null;
      setError(
        body?.error?.message ??
          `Resolve ${count ?? 'all'} RED flag${count === 1 ? '' : 's'} before signing — return to review.`,
      );
    }
    else if (code === 'edited_since_analysis_unattested') {
      // Sprint 0 lockdown — surface the attestation panel inline.
      // The clinician edited section content after the last AI
      // analysis pass; we need their explicit confirmation OR they
      // can go back and Re-analyze. The list of edited sections is
      // shown so they know which paragraphs changed.
      const list = (body?.data?.editedSectionIds as string[] | undefined) ?? [];
      setEditedSectionIds(list);
      setEditedAttested(false);
      setError(
        body?.error?.message ??
          "You've edited the note since the last AI analysis. Re-analyze for flags or confirm you've reviewed your edits.",
      );
    }
    else setError(body?.error?.message ?? `Sign failed (${res.status}).`);
  }

  function afterSweepResolved() {
    setSweepOpen(false);
    setSweepFollowUps([]);
    startTransition(async () => {
      const res = await postSign({
        sweepAcknowledged: true,
        signPin: !isUnlocked && hasPin ? lastAuthValueRef.current : undefined,
        // Carry the attestation forward through the sweep flow if it
        // was already ticked — otherwise the gate would fire again on
        // the post-sweep resubmit.
        editedSinceAnalysisAttested: editedSectionIds ? editedAttested : undefined,
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

      {isLateEntry && dateOfService && (
        <LateEntryBanner
          dateOfService={dateOfService}
          lateEntryDaysGap={lateEntryDaysGap ?? 0}
        />
      )}

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
                <KeyRound className="size-4" aria-hidden />
                Attest + sign — set up signing PIN
              </>
            )}
          </CardTitle>
          <CardDescription>
            {isLateEntry && dateOfService ? (
              <>
                This is a LATE ENTRY. By tapping Sign Note you attest that the content above
                accurately reflects the care you delivered on {formatAttestationDate(dateOfService)}{' '}
                (documented {formatAttestationDate(new Date().toISOString())}), and that you take
                responsibility for that care. Late entries are subject to audit scrutiny.
              </>
            ) : (
              <>
                By tapping Sign Note you attest that the content above accurately reflects
                today&apos;s visit and that you take responsibility for the documented care.
              </>
            )}
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
            <p className="text-sm text-muted-foreground">
              You need a 4-digit signing PIN before your first signature.{' '}
              <button
                type="button"
                className="underline underline-offset-4 hover:text-foreground"
                onClick={() => setShowPinSetup(true)}
              >
                Set up signing PIN
              </button>
            </p>
          )}
          {isUnlocked && (
            <p className="text-sm text-muted-foreground">
              Signing PIN verified — sign without re-entering until {formatTime(pinState!.unlockedUntil!)}.
            </p>
          )}
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}

          {editedSectionIds && (
            <div className="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]/30 p-3 space-y-2">
              <p className="text-sm font-medium">
                You&apos;ve edited the note since the last AI analysis pass.
              </p>
              {editedSectionIds.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Edited section{editedSectionIds.length === 1 ? '' : 's'}:{' '}
                  <span className="font-mono">{editedSectionIds.join(', ')}</span>
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                You can either return to review and re-analyze, or attest that
                you&apos;ve reviewed your edits and want to sign as-is.
              </p>
              <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 rounded border-border"
                  checked={editedAttested}
                  onChange={(e) => setEditedAttested(e.target.checked)}
                  disabled={pending}
                />
                <span>
                  I&apos;ve reviewed my edits since the last AI analysis and accept
                  them without re-analysis. This decision is audit-logged.
                </span>
              </label>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              onClick={sign}
              disabled={
                pending ||
                (!isUnlocked && hasPin && authValue.length !== 4) ||
                (!isUnlocked && !hasPin) ||
                (editedSectionIds !== null && !editedAttested)
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
        // First-time setup is allowed on a login-verified session.
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
          Pick a 4-digit PIN for signing notes. The unlock window is 30 minutes per verify.
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

function formatAttestationDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
