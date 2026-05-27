# HIPAA readiness matrix — OmniScribe scribe / documentation scope

**Status:** Engineering artifact for compliance review — **not** legal advice or a HIPAA certification.  
**Scope:** Audio capture → transcription → AI-assisted draft → clinician review/sign → immutable signed note. Does **not** assert full EHR, billing clearinghouse, or payer-facing workflows.

> **Sprint 0.20 deliberate omission — MFA removed.** OmniScribe v1
> ships with password-only authentication (NextAuth credentials
> provider, bcrypt 12-round hash, account lockout via
> `User.failedLoginCount` / `lockedUntil`, admin-initiated invites,
> admin- and user-initiated password reset). HIPAA Security Rule
> §164.312(d) "Person or entity authentication" is **technically
> satisfied** by password + lockout. MFA is widely treated as a
> baseline expectation by reasonable peers and many SOC 2 auditors,
> and its omission is a **deliberate product decision** — not an
> oversight. The supporting code (`User.mfaSecret` / `mfaEnabled` /
> `mfaRecoveryCodes` / `Organization.forceMfa` columns;
> `/mfa-setup` + `/mfa-challenge` pages; `/api/auth/mfa/*` routes;
> `src/lib/mfa.ts`; otplib + qrcode dependencies) was removed in
> the Sprint 0.20 PR. Re-introducing MFA is a future product
> decision; the schema migration that dropped the columns is the
> only blocker (additive re-add). Note-signing PIN
> (`User.signingPinHash` + `signUnlockedUntil`) is a **separate
> sign-time gate** that is unchanged.

## 1. Roles & governance

| Topic | Target posture | Evidence / pointers |
|--------|----------------|---------------------|
| Covered entity vs BA | Customer CE determines BAAs; OmniScribe typically BA to CE | Downstream BAA fields on `Organization` (`baaExecutedAt`, `baaVersion`, `baaCountersignedBy`, `complianceProfile`); ops dashboard **BAA** dialog |
| Vendor BAAs | PHI subprocessors under written BAA or HIPAA-eligible offering | AWS HIPAA-eligible stack; Soniox `SONIOX_BAA_ON_FILE`; Bedrock-only LLM path (`CLAUDE.md`) |
| Policies | Security/privacy/incident response documented | Outside repo — legal/ops owns |

## 2. Administrative safeguards

| Topic | Target posture | Evidence / pointers |
|--------|----------------|---------------------|
| Workforce access | Role-based access; password + lockout (Sprint 0.20 — MFA removed) | NextAuth credentials provider; `User.failedLoginCount` / `lockedUntil`; platform vs org roles |
| Minimum necessary | Org/site scoping; clinical feature gates | `requireFeatureAccess`, org-scoped APIs |
| Admin accountability | Org admin + ops actions logged | `AuditLog`; `ADMIN_FORCE_PASSWORD_RESET`; platform `logPlatformAction` |

## 3. Physical & technical safeguards

| Topic | Target posture | Evidence / pointers |
|--------|----------------|---------------------|
| Encryption in transit | TLS for app and APIs | Deployment standard (ALB/CloudFront/Vercel) |
| Encryption at rest | RDS, S3 server-side encryption | AWS baseline |
| Integrity | Signed notes immutable (`finalJson`) | `.cursorrules` / ingestion pipeline |
| Audit controls | PHI access and sensitive admin events logged | `auditLog` writes (no silent swallow — rule 8) |
| Authentication | Password (Sprint 0.20 — MFA removed; deliberate omission); session invalidation on credential reset | User model; admin credential routes clear sessions; `User.failedLoginCount` / `lockedUntil` |

## 4. Product-specific (scribe)

| Topic | Target posture | Evidence / pointers |
|--------|----------------|---------------------|
| No auto-sign | Clinician must explicitly sign | Sign flow |
| No fabricated clinical content | Transcript-sourced generation; flags | Prompt + flag system |
| Audio retention | S3 soft-delete only | `CLAUDE.md` rule 7 |
| AI subprocessors | No client-side long-lived Soniox keys | `/api/notes/[id]/realtime-key`; `src/services/transcription/` |

## 5. Gaps to close with counsel / ops

- Formal **risk analysis** (SRA) and **HIPAA policies** packet for each commercial CE customer.
- **Breach notification** runbook and 24/7 contact path.
- **Training** records for workforce with PHI access.
- **Retention schedule** aligned with customer BAAs (notes vs audio vs audit logs).
- Customer DPAs / **subprocessor list** published and kept current.

## 6. “Goals / assist” without a separate Copilot product

Assist stays inside the **documentation boundary**: transcription, draft, prior context, flags, section regenerate — all governed like other PHI. Longitudinal **clinical dashboards** (problems/meds/goals as chart widgets) require separate scope, schema, and DPIA language.
