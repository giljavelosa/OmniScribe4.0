# HIPAA readiness matrix — OmniScribe scribe / documentation scope

**Status:** Engineering artifact for compliance review — **not** legal advice or a HIPAA certification.  
**Scope:** Audio capture → transcription → AI-assisted draft → clinician review/sign → immutable signed note. Does **not** assert full EHR, billing clearinghouse, or payer-facing workflows.

## 1. Roles & governance

| Topic | Target posture | Evidence / pointers |
|--------|----------------|---------------------|
| Covered entity vs BA | Customer CE determines BAAs; OmniScribe typically BA to CE | Downstream BAA fields on `Organization` (`baaExecutedAt`, `baaVersion`, `baaCountersignedBy`, `complianceProfile`); ops dashboard **BAA** dialog |
| Vendor BAAs | PHI subprocessors under written BAA or HIPAA-eligible offering | AWS HIPAA-eligible stack; Soniox `SONIOX_BAA_ON_FILE`; Bedrock-only LLM path (`CLAUDE.md`) |
| Policies | Security/privacy/incident response documented | Outside repo — legal/ops owns |

## 2. Administrative safeguards

| Topic | Target posture | Evidence / pointers |
|--------|----------------|---------------------|
| Workforce access | Role-based access; password authentication + 4-digit signing PIN for sign-time re-auth (WebAuthn/hardware-key a future option) | NextAuth password login; signing PIN via `/api/auth/pin/*`; platform vs org roles |
| Minimum necessary | Org/site scoping; clinical feature gates | `requireFeatureAccess`, org-scoped APIs |
| Admin accountability | Org admin + ops actions logged | `AuditLog`; actions include `ADMIN_FORCE_PASSWORD_RESET` (admin-initiated account recovery); platform `logPlatformAction` |

## 3. Physical & technical safeguards

| Topic | Target posture | Evidence / pointers |
|--------|----------------|---------------------|
| Encryption in transit | TLS for app and APIs | Deployment standard (ALB/CloudFront/Vercel) |
| Encryption at rest | RDS, S3 server-side encryption | AWS baseline |
| Integrity | Signed notes immutable (`finalJson`) | `.cursorrules` / ingestion pipeline |
| Audit controls | PHI access and sensitive admin events logged | `auditLog` writes (no silent swallow — rule 8) |
| Authentication | Password authentication + 4-digit signing PIN for sign-time re-auth (WebAuthn/hardware-key a future option); session invalidation on credential reset | User model (`signingPinHash`); admin credential routes clear sessions |

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
