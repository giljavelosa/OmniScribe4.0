'use client';

import { useState, useTransition } from 'react';
import { signIn } from 'next-auth/react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBanner } from '@/components/ui/status-banner';
import { Division, Profession } from '@prisma/client';
import {
  divisionForProfession,
  PROFESSION_OPTIONS,
  professionLabel,
} from '@/lib/professions';

/** Concrete divisions only — MULTI is an org-aggregate value, never a
 *  per-clinician scope. A multi-specialty practice broadens the org to MULTI
 *  later via org-settings. */
const DIVISION_LABEL: Record<Division, string> = {
  [Division.MEDICAL]: 'Medical',
  [Division.REHAB]: 'Rehab / PT / OT',
  [Division.BEHAVIORAL_HEALTH]: 'Behavioral health',
  [Division.MULTI]: 'Multi-specialty', // never offered at signup; kept so the map is exhaustive
};

/**
 * SignupForm — Unit 37 self-serve org creation.
 *
 * POSTs to /api/auth/signup. On 201, signs in via NextAuth credentials
 * provider (which the new user just created) and routes to /home.
 *
 * Error surface:
 *   - 429 → rate-limit banner with retry timer
 *   - 400 captcha_required / captcha_failed → "complete the challenge"
 *   - 400 password_policy → policy detail from server
 *   - 409 email_in_use → suggestive copy + sign-in link
 *   - other → generic banner
 *
 * Turnstile widget: rendered when NEXT_PUBLIC_TURNSTILE_SITE_KEY env is
 * set. Otherwise the form proceeds without it (dev).
 */
export function SignupForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [professionType, setProfessionType] = useState<Profession | ''>('');
  // Division is derived from profession (1:1 map) — never an independent choice,
  // so a PT can't register under MEDICAL. Shown read-only below.
  const derivedDivision = professionType ? divisionForProfession(professionType) : null;
  const [trialKind, setTrialKind] = useState<'solo' | 'org'>('solo');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      // Turnstile token retrieval — Cloudflare's widget posts the
      // token to a hidden input via its own JS once the user solves
      // the challenge. We read it here when present.
      let captchaToken: string | undefined;
      if (siteKey) {
        const form = e.currentTarget as HTMLFormElement;
        const input = form.querySelector<HTMLInputElement>(
          'input[name="cf-turnstile-response"]',
        );
        captchaToken = input?.value;
      }

      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          orgName,
          professionType,
          trialKind,
          ...(captchaToken ? { captchaToken } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | {
              error?: { code?: string; message?: string; retryAfterSeconds?: number };
            }
          | null;
        const code = body?.error?.code ?? '';
        if (code === 'rate_limited') {
          const mins = Math.ceil((body?.error?.retryAfterSeconds ?? 60) / 60);
          setError(`Too many signup attempts. Try again in ~${mins} minute${mins === 1 ? '' : 's'}.`);
        } else if (code === 'captcha_required' || code === 'captcha_failed') {
          setError('Please complete the security challenge and try again.');
        } else if (code === 'password_policy') {
          setError(body?.error?.message ?? 'Password does not meet the policy.');
        } else if (code === 'email_in_use') {
          setError('An account already exists for that email. Try signing in instead.');
        } else {
          setError(`Signup failed (${res.status}). Please try again.`);
        }
        return;
      }
      // Auto sign-in, then land at home.
      const signinRes = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });
      if (!signinRes || signinRes.error) {
        // Edge case: account created but sign-in failed. Send to login
        // so the user can try manually.
        window.location.assign('/login');
        return;
      }
      // Sprint 0.20 — password-only auth; land at home after sign-in.
      window.location.assign('/home');
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="org-name">Organization name</Label>
        <Input
          id="org-name"
          name="orgName"
          required
          maxLength={200}
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          disabled={pending}
          placeholder="e.g. Acme Family Medicine"
        />
      </div>
      <div className="space-y-2">
        <Label>Your profession</Label>
        <Select
          value={professionType}
          onValueChange={(v) => setProfessionType(v as Profession)}
          disabled={pending}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select your profession" />
          </SelectTrigger>
          <SelectContent>
            {PROFESSION_OPTIONS.map((p) => (
              <SelectItem key={p} value={p}>
                {professionLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Your profession determines the clinical division your notes are
          documented under.
        </p>
      </div>
      <div className="space-y-2">
        <Label>Your division</Label>
        <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm">
          {derivedDivision ? (
            <span>{DIVISION_LABEL[derivedDivision]}</span>
          ) : (
            <span className="text-muted-foreground">Select your profession first</span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Derived from your profession — your notes are always documented under
          this division.
        </p>
      </div>
      <div className="space-y-2">
        <Label>Who is signing up?</Label>
        <Select
          value={trialKind}
          onValueChange={(v) => setTrialKind(v as 'solo' | 'org')}
          disabled={pending}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="solo">Just me — solo clinician</SelectItem>
            <SelectItem value="org">Our practice — team of clinicians</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          {trialKind === 'solo'
            ? '14-day trial with visit bank for one clinician.'
            : '14-day team trial with multiple seats and a shared visit bank.'}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Your email</Label>
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
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
        />
        <p className="text-[11px] text-muted-foreground">
          12+ characters with at least 3 of: uppercase, lowercase, digit, symbol.
        </p>
      </div>

      {/* Turnstile widget — only when configured. The cf-turnstile
          script is expected to be loaded on the page (out-of-scope
          for v1; dev runs without it). */}
      {siteKey && (
        <div
          className="cf-turnstile"
          data-sitekey={siteKey}
          data-theme="light"
        />
      )}

      {error && <StatusBanner variant="danger">{error}</StatusBanner>}

      <Button
        type="submit"
        disabled={
          pending ||
          email.length === 0 ||
          password.length === 0 ||
          orgName.length === 0 ||
          !professionType
        }
        className="w-full"
      >
        {pending ? 'Creating org…' : 'Create org + sign in'}
      </Button>
    </form>
  );
}
