# Unit 37: Public Signup + Self-Serve Org Creation

## Goal

**Wave 6 closer — final unit of the 37-unit build plan.** The app
today is invite-only: every org is provisioned by the platform owner,
every user joins via an admin invite. That's the right posture for
the HIPAA-grade pilot phase. To go to GA, the platform needs:

1. **Public landing page** at `/` that pitches OmniScribe instead of
   silently redirecting to `/login`.
2. **Self-serve signup** at `/signup` — email + password + org name +
   division → atomic creation of Organization + User +
   OrgUser(SUPER_ADMIN) + Seat. New user lands on `/mfa-setup` per
   the existing D2 enforcement chain.
3. **Account lockout** — `User.failedLoginCount` + `User.lockedUntil`.
   After 5 failed sign-ins → 15-minute lock. NextAuth's `authorize()`
   short-circuits with a clear "account temporarily locked" error.
4. **Signup rate-limit** — per-IP cap of 5 signup attempts per
   15-minute window. Redis-backed when available; in-memory fallback
   for dev. Returns 429 + Retry-After.
5. **CAPTCHA hook** — Cloudflare Turnstile integration point.
   Required when `TURNSTILE_SITE_KEY` is set in env (production
   posture); skipped in dev (no key = no friction). Signup route
   validates the token against Turnstile's siteverify endpoint.
6. **Invite-token sweep verification** — Unit 01 already 410s expired
   invites. This unit adds a cron-friendly script
   (`scripts/invite-sweep.mjs`) that marks long-expired invites as
   consumed with a `INVITE_EXPIRED_SWEPT` audit row so the audit trail
   shows housekeeping ran.

> **Unit 37 ships when** a stranger can visit `/` → see a real
> landing page → click "Sign up" → fill the form → submit → land on
> `/mfa-setup` as the SUPER_ADMIN of a freshly provisioned org. AND
> 5 failed sign-ins lock the account for 15 minutes (visible as a
> "locked" error on the sign-in form). AND 5 signup POSTs from the
> same IP within 15 min get 429. AND when `TURNSTILE_SITE_KEY` is
> set, the signup form fails without a valid Turnstile token.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Self-provisioned org default | New orgs land with `subscriptionPlan = STARTER`, `complianceProfile = STANDARD`, `baaExecutedAt = null`. Owner-side workflow flips BAA + tier when the customer enters the paid funnel. Surface a "BAA pending" banner on the new admin's dashboard until BAA is countersigned (out-of-scope visual; signal via existing org page badge). |
| 2 | SUPER_ADMIN role | The signup user becomes SUPER_ADMIN of the new org (highest tenant role; full TEAM_MEMBERS_MANAGE + ORG_SETTINGS access). Single-seat org by default; admin invites teammates through the existing Unit 01 flow. |
| 3 | Lockout policy | 5 consecutive failed attempts → 15-minute lock. Counter resets on successful sign-in OR after the lock expires + the next attempt succeeds. NextAuth `authorize()` returns null for "locked" same as "wrong password" (no enumeration), but the audit row distinguishes (`USER_SIGNED_IN_FAILED` metadata gains `reason: 'locked'`). |
| 4 | Lockout schema | `User.failedLoginCount Int @default(0)` + `User.lockedUntil DateTime?`. Cleared on successful auth. Increments on every wrong-password attempt regardless of lock state (so an attacker pinging a locked account doesn't see "lock cleared but still wrong" timing artifacts). |
| 5 | Rate-limit storage | Redis-first via `INCR + EXPIRE` on key `signup-rate:${ip}`. Falls back to an in-memory `Map` when Redis throws (dev without Redis up, integration tests). Window: 15 minutes; ceiling: 5 attempts. |
| 6 | Rate-limit return | 429 + `Retry-After: <seconds>` header. Body: `{ error: { code: 'rate_limited', retryAfterSeconds: N } }`. UI surfaces "Too many signup attempts. Try again in N minutes." |
| 7 | CAPTCHA provider | Cloudflare Turnstile. Free, no PII collection, drops PII-heavy reCAPTCHA. Required when `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` are set; skipped (form proceeds without verification) when either is missing. Avoids hard-requiring a key for dev environments. |
| 8 | CAPTCHA failure | When Turnstile is configured + verification fails: route returns 400 `captcha_failed`; UI re-renders the challenge widget. NO audit row on captcha failure (would balloon noise from bots). |
| 9 | Signup audit | New action `ORG_SELF_PROVISIONED` written to BOTH AuditLog (org-scope, userId = creator) AND PlatformAuditLog (cross-org governance trail — owner needs visibility into self-provisioned orgs for billing + outreach). Metadata: `{ orgId, orgName, division, ipHash, captchaUsed: boolean }`. IP HASHED (last-3-chars + SHA prefix) so the auditor can detect repeat-IP signups without storing raw IP indefinitely. |
| 10 | Lockout audit | 2 new actions: `USER_LOCKED` (fires when failedLoginCount crosses 5) + `USER_UNLOCKED` (fires on first successful auth after lock expires, OR when an admin force-unlocks via a future polish iteration — Unit 37 v1 only has the automatic clear). |
| 11 | Invite sweep | `scripts/invite-sweep.mjs` runs `prisma.invite.updateMany({ where: { expiresAt: { lt: now }, consumedAt: null }, data: { consumedAt: now } })` + writes one `INVITE_EXPIRED_SWEPT` audit row per org with the count. Cron-suggested daily. Auditable cleanup. |
| 12 | Landing page scope | Brand wordmark + 1-sentence value prop + "Sign up" + "Sign in" CTAs + 3 sentence-long feature bullets. Server-rendered static; no auth gate. Replaces the existing `redirect('/login')`. |

## Design

### Schema additions

```prisma
model User {
  // ...existing
  /// Unit 37 — Account lockout. Incremented on every wrong-password
  /// attempt; cleared on successful auth OR when a fresh attempt
  /// succeeds after lockedUntil has passed.
  failedLoginCount Int        @default(0)
  /// When set, NextAuth authorize() returns null until this time
  /// passes (regardless of password correctness). Cleared on
  /// successful auth.
  lockedUntil      DateTime?
}
```

### Audit actions

```ts
| 'ORG_SELF_PROVISIONED'      // Unit 37 — new org via /signup
| 'USER_LOCKED'               // Unit 37 — 5 failed attempts crossed
| 'USER_UNLOCKED'             // Unit 37 — automatic / admin clear
| 'INVITE_EXPIRED_SWEPT'      // Unit 37 — cron housekeeping
```

### Lockout policy

```ts
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// In authorize():
//   1. Load user. If !user → return null (existing behavior).
//   2. If user.lockedUntil > now → audit USER_SIGNED_IN_FAILED with
//      reason='locked'; return null.
//   3. If password matches:
//        a. If user.lockedUntil != null AND now > lockedUntil → audit
//           USER_UNLOCKED; clear lockedUntil + failedLoginCount.
//        b. Else clear failedLoginCount.
//        c. Return user shape.
//   4. If password wrong:
//        a. Increment failedLoginCount.
//        b. If count >= LOCKOUT_THRESHOLD → set lockedUntil + audit
//           USER_LOCKED.
//        c. Audit USER_SIGNED_IN_FAILED with reason='wrong_password'
//           (existing) or 'lockout_triggered'.
//        d. Return null.
```

### Rate limiter

```ts
// src/lib/rate-limit.ts
export async function consumeSignupAttempt(ip: string): Promise<
  | { ok: true }
  | { ok: false; retryAfterSeconds: number }
>;
```

Redis-first via `MULTI`: `INCR key`, `EXPIRE key 900 NX`. If the new
value exceeds 5, return `{ ok: false, retryAfterSeconds: ttl }`.
Falls back to in-memory `Map<string, { count, expiresAt }>` when
Redis throws.

### Signup endpoint

```
POST /api/auth/signup
  Body: {
    email: string (valid email),
    password: string (validate via password-policy),
    orgName: string (1-200 chars),
    division: 'MEDICAL' | 'REHAB' | 'BEHAVIORAL_HEALTH' | 'MULTI',
    captchaToken?: string,    // Turnstile token; required when TURNSTILE_*
  }

  Flow:
    1. Rate-limit check by IP (from x-forwarded-for or req).
    2. If captcha required, verify token against Turnstile API.
    3. Validate body. Email uniqueness check on User.
    4. Atomic transaction:
        - Create Organization with defaults (STARTER, STANDARD, no BAA)
        - Create User with bcrypt password hash
        - Create OrgUser (SUPER_ADMIN, isActive: true, the chosen division)
        - Create Seat (1)
        - Write ORG_SELF_PROVISIONED audit row (org + platform)
    5. Return 201 with `{ ok: true }`. Client signs in via NextAuth.
```

### Turnstile verification

`src/lib/captcha/turnstile.ts`:

```ts
export async function verifyTurnstileToken(token: string, ip: string): Promise<boolean>;
```

POSTs to `https://challenges.cloudflare.com/turnstile/v0/siteverify`
with `{ secret, response: token, remoteip: ip }`. Returns true only
on `success: true`. Returns false on any error.

### Invite sweep script

`scripts/invite-sweep.mjs` delegates to `scripts/invite-sweep.ts`
(same pattern as audit-purge.mjs/ts):

```ts
// scripts/invite-sweep.ts
const result = await prisma.invite.updateMany({
  where: { expiresAt: { lt: now }, consumedAt: null },
  data: { consumedAt: now },
});
// Per-org grouping for the audit rows...
```

### Public landing

`src/app/page.tsx` becomes a server component rendering the brand +
copy + Sign Up / Sign In CTAs. No auth gate.

## Permission posture

- `/` — public (anyone)
- `/signup` — public (anyone, with optional CAPTCHA gate)
- `/login` — public (existing)
- All other routes unchanged.

## Implementation order

1. Spec + lockout schema + 3 new audit actions + migration (this commit)
2. Lockout enforcement in auth.config.ts + signup rate limiter module + tests
3. Public signup API endpoint + Turnstile verification module + tests
4. Public signup page + public landing redesign + InviteExpiredSweep CLI
5. Tracker + PR #38

## Out of scope (Unit 37)

- Email verification on signup (sends a confirmation email before activating; v1 trusts the captcha + manual review of suspicious org names)
- SSO / SAML for self-serve orgs
- Stripe checkout integration during signup (BAA workflow still manual)
- Multi-step onboarding wizard for the new org (uses existing /mfa-setup chain)
- Per-org signup gate (allow/deny list of email domains)
- Admin force-unlock UI (only auto-unlock in v1; admin polish can follow)
- Public marketing pages beyond the landing (pricing, features, blog)

## Verify when done

- Migration applied; `User.failedLoginCount` + `User.lockedUntil` columns present.
- 4 new audit actions in `AuditAction` union.
- 5 wrong-password attempts on `clinician@demo.local` → 6th attempt blocked even with correct password → `lockedUntil` set; `USER_LOCKED` audit row present.
- 15 minutes later, correct password succeeds → `USER_UNLOCKED` audit row written; lockedUntil cleared.
- `POST /api/auth/signup` with valid body creates org + user + orgUser + seat in one transaction; client redirected to `/mfa-setup`.
- 6 signup POSTs from the same IP within 15 minutes → 6th returns 429 with Retry-After header.
- When `TURNSTILE_SECRET_KEY` set, signup without a valid token returns 400 `captcha_failed`.
- `node scripts/invite-sweep.mjs` marks expired-unconsumed invites as consumed + writes `INVITE_EXPIRED_SWEPT` rows per affected org.
- `/` renders the new landing page (brand + CTAs + bullets); `/signup` renders the form.
- `npm run build`, `npm run lint`, `npm test` all green.
- progress-tracker.md updated; PR #38 stacked on Unit 36. **The 37-unit build plan closes.**
