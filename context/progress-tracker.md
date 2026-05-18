# Progress Tracker

> Update this file after every meaningful implementation change. This is the only file in `context/` that changes constantly; the others are stable.

## Current Phase

- **Wave 0 — Foundation.** Unit 02 shipped (PR #3). Unit 01 shipped (PR #2). Scaffold (PR #1).

## Current Goal

- Land Unit 03 — Capture & Recording, per `context/specs/03-capture-recording.md`. Awaiting user confirmation per Prompt A's stop-between-units contract.

## Completed

- **2026-05-17 — Repo scaffold** (PR #1 — `chore: scaffold the OmniScribe app`).
  - docker-compose with pgvector + Redis (host ports 5434/6381 to avoid collision with the legacy genscribe_copy stack).
  - `.env.example`, `.env`, NEXTAUTH_SECRET generation flow.
  - Hand-rolled `package.json` (Next 16 + React 19 + TS 5.9 strict, NextAuth 5.0.0-beta.31, Prisma 6.19.3, BullMQ 5, Resend, otplib v13, qrcode, Zod 4, Vitest + happy-dom + RTL).
  - Tailwind v4 + 17px base + full OKLCH token set (light + dark) in `src/app/globals.css`.
  - shadcn primitives (17) + custom `BrandWordmark`, `StatusBadge`, `StatusBanner`, `ProcessingIndicator`, `SectionLabel`.
  - ESLint custom rules pre-locking rule 22 (no native `confirm()`/`alert()` in clinical/admin), rule 6 (Bedrock SDK fence), rule 11 (Soniox fence).
  - Placeholder `/login` rendering correctly.

- **2026-05-17 — Unit 01: Foundation Auth & Tenancy** (PR #2 — `feat(unit-01): foundation auth & tenancy`).
  - Prisma schema: Organization (with BAA fields), Site, Room, User (with `mfaSecret` + `mfaRecoveryCodes`), OrgUser, Seat, UserSession, PractitionerProfile, Invite, AuditLog, PlatformAuditLog, PlatformSession, FeatureFlag, SystemAnnouncement, IpAllowlistEntry, and new `PasswordResetToken`.
  - Seed: 1 Demo Clinic org (BAA on file), 1 site, 2 rooms, 5 users covering every role, 5 seats, 1 PractitionerProfile. `admin@demo.local` MFA pre-enrolled with the documented test secret (see `docs/SEED_CREDENTIALS.md`).
  - NextAuth v5 credentials provider, JWT strategy, extended session shape (`orgId`, `orgUserId`, `role`, `division`, `profession`, `mfaEnabled`, `mfaVerified`, `platformRole`).
  - MFA TOTP enrollment + challenge + 10 bcrypt-hashed recovery codes.
  - User-initiated password reset (anti-enumeration, 1h TTL, sessions invalidated on confirm).
  - Resend email transport with console-stub fallback (D3).
  - Admin-initiated MFA reset (requires admin re-MFA + reason ≥10 chars; wipes sessions; emails the user).
  - Admin-initiated password reset.
  - Customer onboarding wizard `/onboarding/[token]` (password → auto-signin → MFA enrollment via the clinical layout's D2 chain). 410 Gone on expired/consumed tokens, enforced in code not just DB.
  - `requireFeatureAccess` + `canUseFeature` matrix + PHI scoping helper (`canAccessClinicianOwnedResource` + `assertOrgScoped`).
  - `writeAuditLog` with PHI denylist (rule 8 — never wrapped in swallowing try-catch).
  - `/admin/users` table with row dropdown (Reset MFA / Send password reset / Deactivate) — all destructive flows via `<AlertDialog>` (rule 22).
  - `/owner/orgs` cross-org list, `/owner/orgs/new` provisioning form with BAA required, `/owner/orgs/[id]` BAA editor with before/after snapshots in both `AuditLog` and `PlatformAuditLog`.

- **2026-05-17 — Unit 02: Patient & Schedule core** (PR #3 — `feat(unit-02): patient & schedule core`).
  - 13 new enums (PatientSex, PatientAddressKind, PatientCoverageStatus, PatientConsentStatus, PatientDepartmentEnrollmentStatus, PatientDepartmentIntakeStatus, VisitType, ScheduleStatus, EncounterStatus, EpisodeStatus, GoalStatus, GoalType, NoteSensitivityLevel) + NoteStatus enum seeded with PREPARING (append-only).
  - 15 new Prisma models: Patient + 6 nested (addresses, coverages, emergency contacts, guarantors, consents, communication prefs); Department + PatientDepartmentEnrollment + PatientDepartmentIntake; Schedule + Encounter; EpisodeOfCare + EpisodeGoal + GoalProgressEntry; **minimal Note shell** (Unit 04/05 will append the rest).
  - Seed adds 3 departments (one per division), 3 patients (James Park / Maria Alvarez / Devon Mitchell), 3 active episodes with goals, 3 schedules for "today" (9/10/11am with the BH visit as TELEHEALTH).
  - `src/lib/divisions/resolve.ts` — pure division resolver (episode → org → patient). 4 unit tests.
  - Patient CRUD API (GET list with pagination + filters, POST atomic create with optional first address/coverage, GET detail with episodes/goals/contacts/coverages, PATCH partial with changed-field audit, DELETE soft-delete) + nested POST /addresses /coverages.
  - Department CRUD admin API + DELETE 409 in_use guard + patient enrollment POST/PATCH + intake POST + intake sensitivity PATCH (requires reason ≥10 chars).
  - Schedule + Encounter API: GET day-bounded list, POST create with time-range validation + cross-org patient check, PATCH status/time edits, POST /start (idempotent, mints Encounter + Note with division locked), POST /cancel, POST /api/encounters for ad-hoc visits, GET /api/encounters/[id].
  - `src/lib/encounters/start.ts` — single source of truth for "mint Encounter + Note." Reused by /schedules/[id]/start and /encounters. Locks Note.division at creation per spec §E.
  - `/patients` list with paginated table + URL-driven search/filter + AddPatient sheet.
  - `/patients/[id]` detail with PatientIdentityHeader + active-episodes card + recent-visits card + demographics card + ad-hoc StartVisit button.
  - `/home` clinician dashboard: today's schedule with SchedulingCard per visit (Start/Resume button; idempotent), patient search field, drafts placeholder.
  - `/prepare/[noteId]` minimal server-rendered placeholder (real prepare surface lands in Unit 03).
  - 20 new AuditAction values appended (PATIENT_*, DEPARTMENT_*, SCHEDULE_*, ENCOUNTER_*, etc.).

## In Progress

None.

## Next Up

In priority order:

1. **Unit 03 — Capture & Recording** ([`context/specs/03-capture-recording.md`](specs/03-capture-recording.md)) — browser AudioWorklet + Soniox ephemeral key + capture page (built per design-critique findings from day one).
5. **Unit 04 — Transcription Pipeline** ([`context/specs/04-transcription-pipeline.md`](specs/04-transcription-pipeline.md)) — finalization + cleaning + voice-id fan-out + SSE status stream.
6. **Unit 05 — Note Generation & Sign** ([`context/specs/05-note-generation-and-sign.md`](specs/05-note-generation-and-sign.md)) — LLM abstraction + division prompts + section progress + review + sign + immutability + post-sign artifacts.
7. **Unit 06 — Prior-Context Brief** ([`context/specs/06-prior-context-brief.md`](specs/06-prior-context-brief.md)) — `NoteBrief` precompute + brief UI + `FollowUp` lifecycle.
8. **Unit 07 — Encounter Copilot Watch v0** ([`context/specs/07-encounter-copilot-watch-v0.md`](specs/07-encounter-copilot-watch-v0.md)) — beacon + open-follow-ups + plan-for-today cards.
9. **Unit 08 — Admin & Compliance Ready** ([`context/specs/08-admin-and-compliance-ready.md`](specs/08-admin-and-compliance-ready.md)) — Sites + Rooms CRUD, admin-initiated MFA reset + password reset, customer self-onboarding wizard, BAA admin UI.

That's Wave 0 + Wave 1 = minimum credible v1, ~9–12 weeks for a 2–4 engineer team.

After Wave 1: see `context/specs/00-build-plan.md` for Waves 2–6.

## Open Questions

These need user/PM decision before the depending unit can ship. Quote the source so context isn't lost.

1. **Authentication seed data** — what test users should `prisma db seed` create besides `admin@demo.local` and `clinician@demo.local`? Suggest: at least one VIEWER, one ORG_ADMIN, one SITE_ADMIN, and one PLATFORM_OWNER for owner-console testing. Decide before completing Unit 01.

2. **Default templates to seed** — which preset templates ship in the initial seed? Suggest: 2 per division (one for new-patient intake, one for established-patient progress) — total 6 CMS-default templates. Decide before completing Unit 05.

3. **Watch v0 card content scope** — Watch v0 includes both open-follow-ups + plan-for-today cards. Should they ship as one PR or sequentially? Recommend one PR (they share the same data source); decide before starting Unit 07.

4. **Telehealth provider** — Daily.co is recommended in `references/telehealth-architecture-spec.md`. Confirm before Wave 3 starts.

5. **FHIR SMART launch model** — provider-launched per-clinician or per-org for v1? Affects token storage shape + consent UX. Decide before Wave 4 (Unit 19).

6. **Default note style preference** — initial value for `OrgUser.preferredNoteStyle`. Suggest `HYBRID`. Decide before completing Unit 05.

7. **Customer self-onboarding wizard placement** — single 4-step wizard (recommended) or split across pages with progress bar? Decide before completing Unit 08.

8. **Public signup** — confirm out of scope for v1 (invite-only). If/when added later, requires `User.failedLoginAttempts` + `User.lockedUntil` fields + lockout policy.

## Architecture Decisions

### Unit 01 (2026-05-17) — locked in `/Users/gil/.claude/plans/we-will-not-use-twinkling-lovelace.md`

- **D1 — Dev prereqs**: Node 20+ and Docker Desktop confirmed on dev host.
- **D2 — MFA enrollment policy = always required for everyone**. Stricter than the spec's literal "optional unless `forceMfa`" — every user, including existing seeded users, gets the `/mfa-setup` chain on first sign-in. Source: this PR's `src/lib/post-signin-redirect.ts` + `(clinical)/layout.tsx`.
- **D3 — Email transport in dev** = Resend when `RESEND_API_KEY` set; console-stub fallback otherwise. Throws loudly on Resend non-2xx. Source: `src/lib/email/transport.ts`.
- **D4 — Two-PR strategy** = `chore: scaffold the OmniScribe app` followed by `feat(unit-01): foundation auth & tenancy`.
- **D5 — Recovery codes** stored as JSON array of bcrypt hashes on `User.mfaRecoveryCodes`. Matches spec §A literal.
- **D6 — Password reset tokens** stored in a new `PasswordResetToken` model (preserves audit history; cleaner than transient fields on User).
- **D7 — Password complexity** = 12+ chars with ≥3 of {upper, lower, digit, symbol} (NIST 800-63B aligned). Source: `src/lib/auth/password-policy.ts`.
- **D8 — `infra/` CDK skeleton deferred**. Empty `.gitkeep`; CDK stacks land alongside Wave 0 deployment readiness (post-Unit 05).
- **D9 — Test TOTP secret documented** in `docs/SEED_CREDENTIALS.md` (committed; LOCAL DEV ONLY banner). The canonical `JBSWY3DPEHPK3PXP` test vector is rejected by otplib v13 (10 bytes < 16-byte minimum); replaced with `7FSWEU6M2MYDQONC5WHDM72MK3FUQZ4Q` (20 bytes).
- **D10 — npm** chosen as package manager (matches every script in `context/architecture.md` Local Development).
- **D11 — Local port mapping** = Postgres host 5434, Redis host 6381. Shifted from 5433/6380 to avoid colliding with another running Docker stack on the dev host (`genscribe_copy-postgres-1` / `genscribe_copy-redis-1`).
- **D12 — Prisma pinned to ^6.19.3** (stable 6.x) instead of the spec's "Prisma 7". Prisma 7 dropped `url = env(...)` in the datasource block and now requires connection details in a separate `prisma.config.ts` plus a driver-adapter pattern (`PrismaPg`) at client construction. `@auth/prisma-adapter` doesn't yet support the 7.x adapter pattern, so adopting 7.x today breaks NextAuth integration. Revisit when the auth ecosystem catches up.
- **2026-05-17 — ESLint 9.x pin** instead of 10. eslint-config-next 16.2.6 bundles an `eslint-plugin-react` that calls the legacy `context.getFilename()` API removed in ESLint 10. ESLint 9 still has it; revisit when Next.js + plugins update.
- **2026-05-17 — otplib v13 API** = named function exports taking `{ secret }` opts; `verify` returns `{ valid, delta, epoch, timeStep }` (read `.valid`). The old `authenticator` singleton from earlier major versions is gone.

### Unit 02 (2026-05-17)

- **2026-05-17 — Note shell ships in Unit 02, not Unit 05.** Schema spec §A originally put Note in Unit 05, but spec §C requires POST /api/schedules/[id]/start to "auto-create Encounter + Note (status PREPARING)" and return noteId. Resolution: minimal Note model added now (orgId, patientId, encounterId?, clinicianOrgUserId, division, status, timestamps) so Unit 02 verify-when-done passes. NoteStatus enum seeded with PREPARING only — Unit 04/05 will append the rest (rule 2: append-only).
- **2026-05-17 — Department.delete is hard-delete with 409 in_use guard, not soft-archive.** Refuses 409 if any enrollment / encounter / episode / intake references it. Departments rarely deactivate in normal operation; if it becomes a pain point, Unit 11 (episode maturity) may add a soft-archive flag. Documented so a future agent doesn't add isArchived without considering the use-case.
- **2026-05-17 — Patient cascade behavior.** Nested rows (addresses, coverages, emergency contacts, guarantors, consents, communication prefs) onDelete: Cascade from Patient. The Patient row itself is never hard-deleted (isDeleted soft-delete is the only retention-compliant path). Acceptable because Patient.isDeleted gates retrieval — Unit 11/12 may revisit if cascade behavior surprises anyone.
- **2026-05-17 — Patient search uses Prisma contains+insensitive, not pg_trgm.** Spec said "trigram match." Postgres pg_trgm extension would require an extra migration step + a separate query path. Contains+insensitive satisfies the < 1 second on 3-patient demo set verify-when-done bar. Swap to pg_trgm is contract-preserving and can land when a real customer's MRN volume warrants it.

### Pre-existing (foundational, from spec)

Append-only log. Include date + source so future agents can trace the why. Pre-populated with foundational decisions from the kit's specs and references — confirm or revise on day one before coding starts.

- **2026-05-17 — Stack** — Next.js 16 App Router + React 19 + TypeScript strict + Tailwind v4 + shadcn/ui + Base UI + Prisma 7 + Postgres 16 + pgvector + Redis 7 + BullMQ + Soniox + AWS Bedrock (Sonnet 4.5 / Haiku 4.5) + NextAuth v5. Source: `context/architecture.md` Stack.
- **2026-05-17 — Soniox for transcription** — BAA-confirmed; real-time `stt-rt-v4` with PCM Int16 LE @ 16 kHz mono + diarization. No AssemblyAI fallback in v1 (can re-add later). Source: `context/architecture.md` Stack + `references/encounter-copilot-spec.md`.
- **2026-05-17 — Bedrock Sonnet 4.5 default LLM, Haiku 4.5 fallback** — cross-region inference profile (`us.` prefix). PHI guard blocks OpenAI/OpenRouter for PHI. Source: `context/architecture.md` LLM Abstraction.
- **2026-05-17 — Single Redis fleet per environment** (rule 18). Section regenerate uses `ai-generation` queue with discriminator, NOT a new queue. Source: `references/section-progress-spec.md`.
- **2026-05-17 — `Note.finalJson` immutable on sign** (rule 3). Addenda are `NoteArtifact` records. Source: `context/architecture.md` Invariants.
- **2026-05-17 — Brief precomputed on sign, not per render**. Cached in `NoteBrief` table (1:1 with signed note). Cost ~$0.05/brief. Source: `references/prior-context-brief-spec.md`.
- **2026-05-17 — Rule 20 attested sources only for copilot** — reads only SIGNED/TRANSFERRED notes, clinician-confirmed FollowUp, verified FhirCachedResource. Source: `references/encounter-copilot-spec.md`.
- **2026-05-17 — Multi-division model** — `Organization.division` + `Organization.defaultDivision` + per-episode override via `EpisodeOfCare.division`. Source: `context/project-overview.md`.
- **2026-05-17 — Video NEVER stored as artifact of record** — telehealth audio is processed and retained per S3 lifecycle; video is discarded after call. Note is the artifact. Source: `references/telehealth-architecture-spec.md`.
- **2026-05-17 — Three-lens evaluation as merge gate** — Clinician / Medicare Compliance Officer / Insurance Auditor. Documented in every PR. Source: `context/code-standards.md`.

## Session Notes

For the next agent picking up cold:

- **Start here**: read `README.md` → `CLAUDE.md` → `journeys/02-typical-visit.md`, then context files in order.
- **Strategic anchors**: [`references/strategic/four-pillars-commercial-charter.md`](../references/strategic/four-pillars-commercial-charter.md). Four pillars: Trust, Diagnosis Support, Workflow Integration, Clinician Autonomy.
- **Commercial-readiness backlog**: [`references/strategic/commercial-readiness-backlog.md`](../references/strategic/commercial-readiness-backlog.md). Most items are addressed by Wave 1.
- **HIPAA controls matrix**: [`references/strategic/hipaa-scribe-controls-matrix.md`](../references/strategic/hipaa-scribe-controls-matrix.md).

## How to Update This File

After every meaningful change:

1. **Move completed work** from "In Progress" → "Completed" with date + summary + reference to commit/PR.
2. **Add new in-progress items** under "In Progress" when starting a unit.
3. **Update "Current Goal"** if the focus shifts.
4. **Append to "Architecture Decisions"** when you make a decision that affects future work. Include date + source.
5. **Add to "Open Questions"** when you find ambiguity you can't resolve alone.
6. **Append to "Session Notes"** when leaving context for the next session.

Never delete history. This file is the audit log of the build.
