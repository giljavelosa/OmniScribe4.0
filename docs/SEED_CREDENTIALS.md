# Seed credentials — LOCAL DEV ONLY

> **WARNING.** Every credential below is for the local development
> environment only. **Never** reuse these passwords in a deployed
> environment — staging, production, customer-pilot, anything reachable
> beyond `localhost`.
>
> **Sprint 0.20 — MFA removed.** Authentication is password-only.
> Account recovery is admin-initiated invites + user-initiated password
> reset. The previous TOTP setup, recovery codes, and authenticator-app
> instructions in this file have been deleted along with the
> supporting code.

After `npx prisma db seed` runs, the local database contains **two organizations** with full clinical corpora:

---

## Org 1 — Demo Clinic

| Property | Value |
|---|---|
| Name | Demo Clinic |
| Division | `MULTI` |
| Compliance profile | `STANDARD` |
| BAA executed | `2026-05-17`, version `2026.05.01` |

### Demo Clinic users

All passwords: **`Demo1234!`** (bcrypt-hashed at rounds=12).

| Email | OrgRole | Division | Notes |
|---|---|---|---|
| `admin@demo.local` | `ORG_ADMIN` | `MULTI` | Org admin |
| `clinician@demo.local` | `CLINICIAN` | `MEDICAL` | `canManagePatients = true`, has PractitionerProfile |
| `viewer@demo.local` | `VIEWER` | `MEDICAL` | Read-only |
| `siteadmin@demo.local` | `SITE_ADMIN` | `MEDICAL` | Team scoped to site |
| `owner@demo.local` | `CLINICIAN` (at org) + **`platformRole = PLATFORM_OWNER`** | `MEDICAL` | Use for `/owner/orgs` testing |

Demo Clinic also has 6 extra clinicians (`pt.smith@demo.local`, `np.brown@demo.local`, etc.) and **3 patients** with **7 signed visits each** (James Park, Maria Alvarez, Devon Mitchell).

---

## Org 2 — Acme Specialty Care

| Property | Value |
|---|---|
| Name | Acme Specialty Care |
| Org ID | `seed-acme-clinic` |
| Division | `MULTI` |
| Sites | **Acme Downtown Medical** + **Acme North Rehab Center** |

### Acme users

All passwords: **`Demo1234!`**

| Email | OrgRole | Notes |
|---|---|---|
| `admin@acme.local` | `ORG_ADMIN` | Org admin for Acme |
| `clinician@acme.local` | `CLINICIAN` | Dr. Olivia Reed — Internal Medicine MD |
| `np.acme@acme.local` | `CLINICIAN` | Dr. Maya Chen — Family NP |
| `pt.nguyen@acme.local` | `CLINICIAN` | Dr. Linh Nguyen — PT at North campus |
| `lcsw.taylor@acme.local` | `CLINICIAN` | Jordan Taylor — LCSW |
| `viewer@acme.local` | `VIEWER` | Read-only |

### Acme patients (rich visit corpus)

| Patient | MRN | Focus | Signed visits |
|---|---|---|---|
| Rachel Kim | ACME-1001 | Type 2 diabetes | 3 (diagnosis → A1c at goal) |
| Robert Hayes | ACME-2001 | Low back pain / PT | 3 (eval → near discharge) |
| Elena Santos | ACME-3001 | Major depression | 4 (BH intake → recovery) |

Log in as `clinician@acme.local` to explore Acme charts. Use `owner@demo.local` to see both orgs in the owner console.

---

## Account recovery

Sprint 0.20 removed MFA. Account recovery follows two paths, both
already wired:

- **Admin invite** — `POST /api/admin/invites` sends an email with a
  one-time setup link. The recipient lands at `/onboarding/[token]`,
  sets a password, and is signed in.
- **User-initiated password reset** — `/password-reset/request` →
  email link → `/password-reset/[token]` → set new password.
- **Admin-initiated password reset** — admin opens the user row in
  `/admin/users`, clicks "Send password reset". Same email + token
  flow as the user-initiated path; emits an audit row attributing it
  to the admin.

## Why these passwords are committed

`Demo1234!` is a deterministic, local-only test value. Committing it
lets every developer be productive within seconds of cloning the repo
without exchanging secrets out-of-band. The risk is bounded because
none of these accounts exist in any deployed environment — production
seeds never run.
