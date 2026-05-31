# Seed credentials — LOCAL DEV ONLY

> **WARNING.** Every secret in this file is for the local development
> environment only. **Never** reuse these passwords in a deployed
> environment — staging, production, customer-pilot, anything reachable
> beyond `localhost`.

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
| `admin@demo.local` | `ORG_ADMIN` | `MEDICAL` | `professionType = MD` — concrete so it can record; the org itself stays `MULTI` |
| `clinician@demo.local` | `CLINICIAN` | `MEDICAL` | `professionType = MD`, `canManagePatients = true`, has PractitionerProfile |
| `viewer@demo.local` | `VIEWER` | `MEDICAL` | Read-only (no profession — exempt from the gate) |
| `siteadmin@demo.local` | `SITE_ADMIN` | `MEDICAL` | `professionType = MD`; team scoped to site |
| `owner@demo.local` | `CLINICIAN` (at org) + **`platformRole = PLATFORM_OWNER`** | `MEDICAL` | `professionType = MD`; use for `/owner/orgs` testing |

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
| `admin@acme.local` | `ORG_ADMIN` | Org admin for Acme — `MEDICAL` / `professionType = MD` (concrete so it can record; org stays `MULTI`) |
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

## Auth model

Password-only. Sprint 0.20 removed MFA permanently — no TOTP, no recovery codes, no `/mfa-setup`. Note-signing is gated separately by the per-user signing PIN (`User.signingPinHash`).
