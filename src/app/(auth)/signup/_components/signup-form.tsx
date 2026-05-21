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

const DIVISIONS = ['MEDICAL', 'REHAB', 'BEHAVIORAL_HEALTH', 'MULTI'] as const;
type Division = (typeof DIVISIONS)[number];

const DIVISION_LABEL: Record<Division, string> = {
  MEDICAL: 'Medical',
  REHAB: 'Rehab / PT / OT',
  BEHAVIORAL_HEALTH: 'Behavioral health',
  MULTI: 'Multi-specialty',
};

/**
 * SignupForm — Unit 37 self-serve org creation.
 *
 * POSTs to /api/auth/signup. On 201, signs in via NextAuth credentials
 * provider (which the new user just created) and routes to /mfa-setup
 * per the D2 enforcement chain.
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
  const [division, setDivision] = useState<Division>('MEDICAL');
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
          division,
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
      // Auto sign-in. NextAuth's credentials provider validates the
      // freshly-created user; on success we route to /mfa-setup per
      // the D2 enforcement chain.
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
      // New accounts always need MFA setup. Hard-navigate so the server
      // reads the fresh JWT cookie rather than racing the cookie write.
      window.location.assign('/mfa-setup');
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
        <Label>Division</Label>
        <Select
          value={division}
          onValueChange={(v) => setDivision(v as Division)}
          disabled={pending}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIVISIONS.map((d) => (
              <SelectItem key={d} value={d}>
                {DIVISION_LABEL[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        disabled={pending || email.length === 0 || password.length === 0 || orgName.length === 0}
        className="w-full"
      >
        {pending ? 'Creating org…' : 'Create org + sign in'}
      </Button>
    </form>
  );
}
