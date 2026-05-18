# Seed credentials — LOCAL DEV ONLY

> **WARNING.** Every secret in this file is for the local development
> environment only. The TOTP seed below is a deterministic test value so
> developers can scan a QR with their authenticator and be productive in
> seconds. **Never** set this secret in a deployed environment — staging,
> production, customer-pilot, anything reachable beyond `localhost`.

After `npx prisma db seed` runs, the local database contains:

## Org

| Property | Value |
|---|---|
| Name | Demo Clinic |
| Division | `MULTI` |
| Compliance profile | `STANDARD` |
| BAA executed | `2026-05-17`, version `2026.05.01` |

## Users

All passwords: **`Demo1234!`** (bcrypt-hashed at rounds=12).

| Email | OrgRole | Division | MFA pre-enrolled? | Notes |
|---|---|---|---|---|
| `admin@demo.local` | `SUPER_ADMIN` | `MULTI` | yes | Use the TOTP secret below |
| `clinician@demo.local` | `CLINICIAN` | `MEDICAL` | no | `canManagePatients = true`, has PractitionerProfile |
| `viewer@demo.local` | `VIEWER` | `MEDICAL` | no | Read-only |
| `siteadmin@demo.local` | `SITE_ADMIN` | `MEDICAL` | no | Team scoped to site |
| `owner@demo.local` | `CLINICIAN` (at org) + **`platformRole = PLATFORM_OWNER`** | `MEDICAL` | no | Use for `/owner/orgs` testing |

The first time any non-admin user signs in, the D2 always-required-MFA chain
routes them through `/mfa-setup` to enroll.

## Pre-enrolled TOTP secret for `admin@demo.local`

```
7FSWEU6M2MYDQONC5WHDM72MK3FUQZ4Q
```

This is a 20-byte (32-character base32) secret that satisfies otplib v13's
16-byte minimum. The old canonical `JBSWY3DPEHPK3PXP` test vector is only
10 bytes and is rejected by v13.

To use it:

1. Open your authenticator app (Authy, 1Password, Google Authenticator,
   Microsoft Authenticator, etc.).
2. Choose "Add account" → "Enter setup key" (or "Enter manually").
3. Account name: `admin@demo.local`. Issuer: `OmniScribe`. Algorithm: SHA-1.
   Period: 30 sec. Digits: 6.
4. Paste the secret above.
5. The app now shows the current 6-digit code that changes every 30s. Use
   it on the `/mfa-challenge` page after signing in.

Alternatively, `npx prisma db seed` prints the current token at the end of
its output as a one-time sanity check.

### CLI fallback (no authenticator app handy)

Generate a code on demand from your terminal — uses the project's own
otplib config so the result matches what the server expects:

```bash
cd /Users/gil/Downloads/OmniScribe4.0
npx tsx -e "import('./src/lib/mfa.ts').then(m => m.generateTotpToken('7FSWEU6M2MYDQONC5WHDM72MK3FUQZ4Q').then(c => console.log(c)))"
```

Paste the printed 6-digit code immediately — TOTP windows are 30 seconds,
and otplib's default `window: 1` tolerance gives you ±1 step (90 s
effective grace). Re-run if the window flips before you submit.

> **Tripwire**: a `node -e "const {TOTP} = require('otplib')..."` one-liner
> from the bare Node REPL will fail with `CryptoPluginMissingError` —
> v13's CJS entry doesn't auto-attach the crypto + base32 plugins.
> ESM resolution via `tsx` does, which is why the snippet above works.

## Recovery codes

Recovery codes are regenerated at seed time and printed once to the seed
command's stdout. Grab them from the terminal where you ran
`npx prisma db seed`. They are stored bcrypt-hashed in
`User.mfaRecoveryCodes`; the plaintext is never persisted.

## Rotating the seed

If a developer needs to change the test secret:

1. Edit `DEMO_ADMIN_MFA_SECRET` in [`prisma/seed.ts`](../prisma/seed.ts).
2. Update the secret above.
3. Drop your local DB volume (`docker compose down -v && docker compose up -d`).
4. Re-run `npx prisma migrate dev` and `npx prisma db seed`.

## Why is this committed?

The seed is a deterministic, local-only test value. Committing it lets every
developer be productive within seconds of cloning the repo without exchanging
secrets out-of-band. The risk is bounded because the secret never matches a
deployed user (production seeds skip the pre-enrolled-MFA path; admins enroll
fresh on first sign-in).
