# Progress Tracker

> Update this file after every meaningful implementation change. This is the only file in `context/` that changes constantly; the others are stable.

## Current Phase

- **Wave 0 — Foundation.** Unit 04 shipped (PR #5). Unit 03 shipped (PR #4). Unit 02 shipped (PR #3). Unit 01 shipped (PR #2). Scaffold (PR #1).

## Current Goal

- Land Unit 05 — Note Generation & Sign, per `context/specs/05-note-generation-and-sign.md`. Awaiting user confirmation per Prompt B's stop-between-units contract.

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

- **2026-05-17 — Unit 03: Capture & Recording** (PR #4 — `feat(unit-03): capture & recording`).
  - Schema: NoteStatus appends (RECORDING, PAUSED, TRANSCRIBING; rest in Unit 04/05); new `CaptureMode` enum (LIVE/UPLOADED/PASTED); Note gains `captureMode`, `audioFileKey`, `transcriptRaw`, `transcriptClean`; new `AudioSegment` model (soft-delete only, rule 7).
  - `src/services/transcription/SonioxService.ts` — THE sole path to Soniox (rule 11). Mints ephemeral STT-WS-only keys (60s TTL); stub mode when SONIOX_API_KEY unset; `assertSonioxAllowedForPHI` rule-17 gate. Real-time config locks `enable_speaker_diarization: true` + `audio_format: pcm_s16le` (rule 12).
  - `src/lib/s3/client.ts` — S3 put + presigned GET helpers with local-fs stub (writes to `./tmp/audio/` when S3_AUDIO_BUCKET unset).
  - `public/audio/pcm-worklet.js` — 16,000 Hz mono Int16 LE AudioWorklet (rule 12 locked here).
  - APIs (all `requireFeatureAccess('NOTE_CREATE')`, ownership check, org-scoped, audit-logged):
    - `POST /api/notes/[id]/realtime-key` — mints ephemeral key, flips PREPARING → RECORDING on first mint, audits REALTIME_KEY_ISSUED + RECORDING_STARTED.
    - `POST /api/notes/[id]/complete-stream` — multipart finalize, uploads WAV to S3, creates AudioSegment, writes transcriptRaw, transitions → TRANSCRIBING, audits RECORDING_FINALIZED.
    - `POST /api/notes/[id]/upload-audio` — UPLOADED mode, 200 MB cap, mime allowlist.
    - `POST /api/notes/[id]/paste-transcript` — PASTED mode, writes transcriptClean directly.
    - `POST /api/notes/[id]/recording-state` — pause/resume audit hook, flips RECORDING ⇄ PAUSED.
  - `CaptureStateProvider` (single source of truth) — AudioWorklet + WebSocket lifecycle, RMS smoothing, transcript state, pipeline teardown on unmount. Granular hooks (`useRecordingState`, `useAudioLevel`, `useTranscript`, `useCaptureControls`, `useStubBanner`) so each component subscribes to only what it needs.
  - 9 capture components — none over 120 lines, total 1066 lines across 12 files (vs. prior prototype's 2,245-line monolith). Honors all design-critique-capture-flow.md findings: single RecordingStatus source of truth, correct button polarity (Start Drafting loud pre-draft, Finish & Review loud post-draft, Finish never red), AlertDialog leave-confirm (never native confirm), AudioLevelBars reading the shared level state.
  - `/capture/[noteId]` (68-line orchestration only); `/prepare/[noteId]` now has three real capture-mode cards (Live → /capture, Upload → /api/notes/[id]/upload-audio, Paste → /api/notes/[id]/paste-transcript).
  - 7 new AuditAction values appended (REALTIME_KEY_ISSUED, RECORDING_STARTED/PAUSED/RESUMED/FINALIZED, AUDIO_UPLOADED, TRANSCRIPT_PASTED).

- **2026-05-17 — Unit 04: Transcription Pipeline** (PR #5 — `feat(unit-04): transcription pipeline`).
  - Schema: NoteStatus appends DRAFTING + INTERRUPTED. Note gains inferenceLog (Json?) + interruptedAt + lastWorkerError (PHI-free; class + message only).
  - `src/lib/redis.ts` — ioredis singleton with `maxRetriesPerRequest: null` (required by BullMQ). HMR-safe globalThis cache.
  - `src/lib/queue.ts` — 6 BullMQ Queue instances + typed enqueue helpers with stable jobIds (`transcription:{noteId}:{requestId}` etc.). Defaults: 3 attempts, exp backoff 5s/10s/20s; voice-id at 2 attempts (best-effort).
  - `src/workers/index.ts` — worker fleet entry point. One Worker per queue. Real handlers for transcription + voice-id; log-only stubs for ai-generation / note-finalize / note-brief / post-sign-artifacts (each defers to later units). SIGTERM/SIGINT graceful shutdown.
  - `src/services/transcription/clean.ts` — pure cleanRealtimeTranscript / cleanBatchTranscript / cleanPastedTranscript. Drop non-final partials, coalesce same-speaker runs, map Soniox speaker int → role enum (CLINICIAN/PATIENT/OTHER), normalize whitespace, return TranscriptClean shape. 9 unit tests.
  - `SonioxService.transcribeBatch()` — POST audio to /v1/transcribe-async + poll. Stub mode (no SONIOX_API_KEY) returns a synthetic transcript so the pipeline exercises locally without a Soniox account.
  - `transcription.worker.ts` — three branches (finalize-realtime-transcript / transcribe-uploaded-audio / cleanup-pasted-transcript). On success: writes transcriptClean, flips TRANSCRIBING → DRAFTING, audits TRANSCRIPT_FINALIZED + NOTE_STATUS_TRANSITIONED, enqueues ai-generation + voice-id. On unrecoverable failure (final attempt): marks INTERRUPTED + interruptedAt + lastWorkerError, audits NOTE_INTERRUPTED.
  - `voice-id.worker.ts` — SKELETON (TitaNet + VoiceProfile not yet in kit). Validates note + transcript, audits VOICE_ID_SKIPPED with reason `voice_profile_not_yet_implemented`, never blocks ai-generation. Real impl when VoiceProfile model + TitaNet land.
  - Capture endpoints (Unit 03) wired to enqueue: /complete-stream → finalize-realtime-transcript; /upload-audio → transcribe-uploaded-audio; /paste-transcript → cleanup-pasted-transcript (now also produces canonical TranscriptClean shape inline). Each writes a TRANSCRIPTION_JOB_ENQUEUED audit row.
  - `GET /api/notes/[id]/stream` — SSE stream of Note lifecycle. Default mode emits STATUS events + closes on exit from TRANSCRIBING/DRAFTING; ?include=sections also diffs Note.inferenceLog._sectionStatus (wiring for Unit 05). 2s poll, 10min cap, 15s heartbeat. Race-safe (every enqueue/close wrapped to swallow client-disconnect throws).
  - 7 new AuditAction values appended (NOTE_STATUS_TRANSITIONED, NOTE_INTERRUPTED, TRANSCRIPTION_JOB_ENQUEUED, TRANSCRIPT_FINALIZED, VOICE_ID_MATCHED, VOICE_ID_SKIPPED, VOICE_ID_FAILED).

## In Progress

None.

## Next Up

In priority order:

1. **Unit 05 — Note Generation & Sign** ([`context/specs/05-note-generation-and-sign.md`](specs/05-note-generation-and-sign.md)) — LLM abstraction + division prompts + section progress + review + sign + immutability + post-sign artifacts.
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

### Unit 03 (2026-05-17)

- **2026-05-17 — Soniox stub mode for dev.** When SONIOX_API_KEY is unset, `mintEphemeralKey` returns a fake key + the production WS URL + the fixed config. The capture page detects this via `useStubBanner()` and shows a warning banner — the rest of the flow (mic permission, AudioWorklet, finalize upload, audit, status transitions) still exercises end-to-end. Lets local dev work without a Soniox account. Real Soniox requires both SONIOX_API_KEY AND SONIOX_BAA_ON_FILE=true in any non-dev env (rule 17, enforced by `assertSonioxAllowedForPHI`).
- **2026-05-17 — Local-fs S3 stub.** `src/lib/s3/client.ts` writes to `./tmp/audio/` when S3_AUDIO_BUCKET is unset. Production sets the bucket + relies on the IAM task role (rule 13 — never static access keys). Stub mode logs the path so devs can inspect captures locally.
- **2026-05-17 — Single CaptureStateProvider over Zustand.** Spec mentioned "Context or Zustand"; chose Context to avoid adding a new dependency for one provider. Granular hooks (`useAudioLevel`, `useTranscript`, etc.) prevent over-rendering — a component that only needs the level doesn't re-render on transcript updates.
- **2026-05-17 — RMS smoothed via rAF, not on every worklet message.** AudioWorklet emits at ~16ms intervals; setting React state that often would melt the renderer. Worklet writes to a ref; a `requestAnimationFrame` loop reads the ref + commits a smoothed value 60×/sec. AudioLevelBars re-renders ≤60×/sec regardless of worklet frequency.
- **2026-05-17 — Start Drafting button shipped disabled in Unit 03.** Pre-draft button polarity matters (the prior prototype's #1 friction was clinicians hitting Finish first); but the actual drafting pipeline lands in Unit 05. The button is present, primary-teal styled, with a tooltip explaining it lights up in Unit 05. Honors the design rule without faking the behavior.
- **2026-05-17 — Browser sends raw PCM bytes to Soniox WS.** No JSON framing on the audio path — Soniox's documented protocol takes the `api_key` + config as the first JSON message then accepts raw Int16 LE PCM payloads. The AudioWorklet's `samples.buffer` is transferred to avoid a copy.
- **2026-05-17 — Soniox temporary-key endpoint not available on the deployed tier.** Verified live: `POST /v1/auth/temporary-api-keys` returns 404, so `SonioxService.mintEphemeralKey` falls back to passing the long-lived key through to the browser. The key still goes only through `/api/notes/[id]/realtime-key` (rule 11), but loses the 60s TTL the spec assumed. If the Soniox plan is upgraded to a tier that exposes the endpoint, the fallback path becomes dead code and can be deleted. Documented + accepted.
- **2026-05-17 — `npm run verify:providers`** added — exercises each configured provider (Soniox mint, S3 round-trip, Bedrock list-foundation-models, Resend /domains) and reports a green/red checklist. Used in dev + CI for sanity-checking key rotations.

### Unit 04 (2026-05-17)

- **2026-05-17 — Real handlers wrapped via dynamic import indirection in worker entry.** `src/workers/index.ts` imports thin wrapper modules (`transcription.worker.ts`, `voice-id.worker.ts`) that dynamically import the real handler at first invocation. Pattern lets Commit 2 stand up the fleet with stub handlers and Commit 4 land the real implementation in the same file path without forcing Commit 2 to know what's coming.
- **2026-05-17 — Voice-id ships as a skeleton in Unit 04.** Real impl requires VoiceProfile model with `embedding vector(192)` + pgvector + TitaNet x-vector service — none of which exist in the kit yet. Skeleton audits VOICE_ID_SKIPPED with reason `voice_profile_not_yet_implemented` and never blocks ai-generation (voice-id is best-effort per spec §H). Replace with real match-speakers when TitaNet + VoiceProfile land in a later unit; the job-data contract is already in place.
- **2026-05-17 — Note.lastWorkerError is PHI-free + capped at 500 chars.** Stores `${errorName}: ${errorMessage}` only — never transcript text, never patient identifiers. Truncated to keep audit metadata small even if a downstream SDK throws a multi-kB error.
- **2026-05-17 — INTERRUPTED only on the FINAL BullMQ attempt.** Transient errors get the standard 3-attempt retry; the worker marks INTERRUPTED + writes lastWorkerError + audits NOTE_INTERRUPTED only on the last retry's catch, so a flaky Soniox request doesn't immediately surface "interrupted" to the clinician.
- **2026-05-17 — /paste-transcript cleans inline.** Spec said write a transcriptClean directly; we now use `cleanPastedTranscript` to produce the canonical TranscriptClean shape (plaintext, structured, speakerCount, wordCount, durationMs, source). Worker's cleanup-pasted-transcript branch becomes a true pass-through; Unit 05 LLM prompts get the same shape regardless of capture mode.
- **2026-05-17 — SSE handler bounds: 10min cap + 15s heartbeat.** A stalled note shouldn't tie up a connection forever; the client reopens on close. Heartbeat ":\n\n" comment beats proxy idle-timeout (Cloudflare 100s, Nginx 60s default).
- **2026-05-17 — SSE includes an initial STATUS event** so /processing renders the current state synchronously rather than waiting for the first 2s poll tick.

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
