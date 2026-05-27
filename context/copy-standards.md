# Copy Standards — Plain English for clinician-facing strings

> **Sprint 0.20 — MFA removed.** Any reference to MFA, /mfa-challenge, /mfa-setup, TOTP, authenticator app setup, or login-verified gates in this document is HISTORICAL. Authentication is now password-only. See `context/specs/01-foundation-auth-tenant.md` and `progress-tracker.md`.


OmniScribe's clinical surfaces are read by clinicians of varying tech literacy. Tech jargon (MFA, TOTP, SSO, JSON) is alienating and the wrong vocabulary even for sophisticated users. The opposite extreme — spelling out *every* abbreviation — is condescending and harder to scan for clinicians who use abbreviations every day (MRN, DOB, ICD, CPT).

This doc defines the two lists and the principle.

## Principle

**User-visible strings use natural English. Tech jargon is replaced. Clinical standard abbreviations are kept.**

Applies to: labels, headings, button text, placeholders, error messages, page titles, tooltip copy, email subjects, audit log displays, status banners.

Does NOT apply to: code identifiers (`mfaSecret`, `signingPinHash`), JSDoc comments, internal logs (`console.warn`), git commit messages, audit log `action` enum values (e.g., `MFA_VERIFIED` — those are stable identifiers, the display surfaces translate).

## Keep abbreviated (clinical standard — every clinician knows them)

- **MRN** (Medical Record Number)
- **DOB** (Date of Birth)
- **CPT**, **HCPCS**, **ICD-10** codes
- **SOAP**, **HPI**, **PMH**, **ROS**, **HEENT** note section names
- **ROM**, **MMT**, **AROM**, **PROM**, **WBAT**, **AAROM** rehab terms
- **PT**, **OT**, **SLP** division names
- **BP**, **HR**, **RR**, **SpO2**, **T** vitals
- **EHR**, **FHIR**, **NextGen**, **Epic**, **Cerner** integration partner names
- **AI** (acceptable shorthand for AI features; do NOT use "LLM" user-facing)
- **PHI** (only in compliance / admin contexts — clinicians know it)

## Always expand (tech jargon — replace in every user-visible string)

| Tech term | Replacement (label) | Replacement (verb phrase) |
|---|---|---|
| MFA | "Authenticator" | "Set up authenticator", "Verify with authenticator" |
| TOTP / OTP | "Authenticator code" | "Enter the 6-digit code from your authenticator" |
| 2FA / Two-factor | "Authenticator" | same as above |
| Admin | "Administration" | — |
| Org / OrgUser | "Organization" / "User account" | — |
| API | (avoid entirely user-facing) | — |
| JSON | (avoid entirely user-facing) | "raw data" if needed |
| SSE | (never user-facing) | "live updates" |
| LLM | "AI" | — |
| SSO | "Single sign-on" (or "Sign in with [provider]") | — |
| 401 / Unauthorized | — | "You'll need to sign in again" |
| 403 / Forbidden | — | "You don't have permission to do that" |
| 400 / Bad request | — | "Something we sent wasn't quite right" |
| 500 / Server error | — | "Something on our end went wrong" |
| PIN | "PIN" (keep — universal) | "Set up a 4-digit signing PIN" |

## Existing examples that follow the standard (use these as references)

- "Sign note" (button) — not "Submit signature"
- "Start visit (ad-hoc)" — not "Init encounter"
- "Verify with authenticator" — not "Verify MFA"
- "Reset authenticator" — not "Reset MFA"
- "6-digit authenticator code" — not "6-digit MFA code"
- "Set up authenticator" — not "Enroll MFA"
- "Require authenticator at sign-in" — not "Force MFA at sign-in"

## How to enforce

- **Code review**: every PR touching JSX, button text, error toasts, or page metadata gets a copy-pass against this list.
- **No automated lint rule yet** — copy review is human-judgment work (context matters; abbreviation acceptability varies by surface).
- **Future:** if drift becomes a problem, add an ESLint rule banning the tech-jargon list from JSX text + attribute strings (`title`, `placeholder`, `aria-label`).

## Edge cases

- **Email subjects / body** — same rules. Clinician opens it on a phone, not in a developer-aware context.
- **Audit log display** — the action enum (`MFA_VERIFIED`) is the stable internal name; the UI translates to "Authenticator verified" in the audit table.
- **Onboarding wizard step labels** — terse natural language: "Set password", "Set up authenticator", "Done".
- **Help/empty-state copy** — full sentences, contractions allowed (more humane: "We couldn't find that" > "Resource not found").

## Out of scope (intentional)

- Marketing site copy — different audience, not governed here.
- API error codes returned to clients — internal, machine-readable, stable identifiers.
- Database column names / Prisma model fields — code-only.
- Git commit subjects + PR titles — engineering audience.
