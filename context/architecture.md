# OmniScribe — Architecture

> Build this. Top-to-bottom, this is the system you are constructing.

## Stack

Choose every layer below at the start. The combination is intentional; do not substitute without explicit reason.

| Layer | Technology | Role |
|---|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript 5 (strict) | Web app + API routes; server-component-first; route handlers for REST + SSE |
| UI | Tailwind CSS v4 + shadcn/ui + Base UI primitives | Design tokens via CSS custom properties; component primitives in `src/components/ui/` |
| Rich text | TipTap 3 (StarterKit + Placeholder) | Note section editor; `Note.draftJson` is TipTap JSON |
| Validation | Zod 4 | Schema validation at every API boundary |
| State (client) | Zustand 5 + TanStack Query 5 | Lightweight client state + server-state cache |
| Auth | NextAuth.js 5 + bcryptjs | JWT sessions, password + one-time email/SMS login codes |
| Database | Prisma 7 ORM + PostgreSQL 16 + pgvector | Structured data; voice embeddings as `vector(192)` |
| Queues | BullMQ 5 + ioredis 5 + Redis 7 | Async pipelines (transcription, AI generation, finalize, voice-id, brief) |
| Transcription | Soniox real-time STT (model `stt-rt-v4`, BAA) | Browser-side WebSocket; ephemeral key minted server-side |
| LLM (primary) | AWS Bedrock — Claude Sonnet 4.5 (note gen, brief, copilot) | Cross-region inference profile (`us.anthropic.claude-sonnet-4-5-...`) |
| LLM (fast/fallback) | AWS Bedrock — Claude Haiku 4.5 | For lighter tasks + Sonnet fallback |
| LLM (non-PHI dev) | OpenRouter / OpenAI (env-gated, blocked for PHI) | Dev experiments only — PHI allowlist rejects |
| Voice ID | TitaNet 192-dim x-vector embeddings | Speaker identification post-finalization |
| Object storage | AWS S3 | Audio segments (`audio/raw/{noteId}/{segmentId}.wav`); presigned URLs only |
| CDN | CloudFront | Static + media in front of S3 assets bucket |
| Compute (app) | AWS App Runner OR ECS Fargate + ALB | Next.js standalone container |
| Compute (workers) | AWS ECS Fargate | BullMQ worker fleet (`Dockerfile.worker`, runs `npx tsx src/workers/index.ts`) |
| Database (prod) | AWS RDS PostgreSQL 16 Multi-AZ | Encrypted at rest, SSL enforced, 30-day backups, deletion protection |
| Cache (prod) | AWS ElastiCache Redis 7.1 | TLS in-transit, KMS at-rest, primary + 2 replicas, automatic failover |
| Secrets | AWS Secrets Manager | All credentials; never in console env vars |
| IaC | AWS CDK (TypeScript) | `infra/lib/{compute,data,vpc,monitoring}-stack.ts` |
| Billing | Stripe 21 | Subscriptions, seat tiers, customer portal — **Wave 7** in [`specs/00-build-plan.md`](specs/00-build-plan.md) |
| Email | Resend (verified domain) | Transactional auth emails (login codes, reset, invites) |
| PWA | next-pwa 5 | Installable web app for tablet clinicians |
| Testing | Vitest + @testing-library/react + happy-dom | Unit + integration; integration tests touch real DB (no mocks for DB layer) |
| Video (Wave 3) | Daily.co (HIPAA BAA) | Telehealth rooms, magic-link patient join |
| EHR (Wave 4) | SMART on FHIR R4 OAuth2 (NextGen first) | Read-only cached resources via worker |

## System Boundaries

Each top-level folder under `src/` owns exactly one responsibility. Cross-folder calls are explicit, typed, one-directional (UI → app routes → lib/services → db).

- **`src/app/(auth)/`** — public sign-in, signup-via-invite, password reset. **Sprint 0.20 — MFA + login-verified gates removed; auth is password-only.**
- **`src/app/(clinical)/`** — clinician workspace: `/home`, `/patients`, `/prepare/[noteId]`, `/capture/[noteId]`, `/processing/[noteId]`, `/review/[noteId]`, `/sign/[noteId]`, `/drafts`, `/templates`, `/profile`, `/profile/voice`. Gated by `requireFeatureAccess` + division scoping.
- **`src/app/(admin)/`** — org-admin console: users, sites, rooms, seats, billing, manage-templates, voice profile admin, audit, org-settings, dashboard. Gated by `OrgRole` ∈ `{ORG_ADMIN, SITE_ADMIN}`.
- **`src/app/(telehealth)/`** — `/telehealth/room/[scheduleId]`, `/telehealth/waiting/[scheduleId]`. Clinician + patient telehealth surfaces.
- **`src/app/v/[magicToken]/`** — public telehealth patient identity verification.
- **`src/app/(owner)/`** — platform-owner cross-org console. Gated by `PlatformRole = PLATFORM_OWNER`.
- **`src/app/(onboarding)/[token]/`** — public 4-step customer onboarding wizard.
- **`src/app/api/`** — HTTP boundary. Every route: Zod parse → `requireFeatureAccess` → service call → consistent response shape. SSE routes live here too (`/api/notes/[id]/stream`).
- **`src/components/`** — composed React components by domain (capture, review, brief, copilot, patients, admin, etc.).
- **`src/components/ui/`** — shadcn/ui + Base UI primitives. **Protected**: do not modify generated primitives — extend with CVA variants in sibling files.
- **`src/services/transcription/`** — sole ingress for Soniox / batch transcription. App code never imports the Soniox SDK directly.
- **`src/services/llm/`** — sole ingress for LLM calls. PHI guard (`assertProviderAllowedForPHI`) lives here; provider allowlist enforced at runtime.
- **`src/services/voice-id/`** — TitaNet embedding + matching.
- **`src/services/brief/`** — `BriefGenerator`, `FollowupExtractor`, `BriefBuilderInput`.
- **`src/services/copilot/`** — copilot tool registry + agent loop (Wave 5).
- **`src/services/fhir/`** — SMART OAuth2, resource cache, sync worker (Wave 4).
- **`src/workers/`** — BullMQ entry point (`index.ts`). One process; one worker per queue; **never two fleets per Redis** (rule 18).
- **`src/lib/authz/`** — `server.ts` (`requireFeatureAccess`), `internal-authorization.ts` (`canUseFeature`, `canAccessDivisionTemplates`), `resolvers.ts`, `types.ts` (`FeatureKey`, `OrgRole`, `Division` enums), `template-visibility.ts`.
- **`src/lib/phi-access.ts`** — PHI scoping predicates.
- **`src/lib/audit/`** — append-only audit log writer; PHI-free metadata enforcement.
- **`src/lib/queue.ts`** — BullMQ enqueue helpers with stable jobId idempotency.
- **`src/lib/s3/`** — S3 client + presigned-URL minting.
- **`src/lib/auth.config.ts`, `src/lib/auth.ts`, `src/lib/auth/login-verification.ts`** — NextAuth config, JWT callbacks, login codes.
- **`src/lib/prisma.ts`** — Prisma client singleton.
- **`src/lib/redis.ts`** — ioredis singleton.
- **`src/lib/note-medical-prompt.ts`, `note-behavioral-health-prompt.ts`, `note-rehab-master-prompt.ts`** — division-aware master prompt composition.
- **`src/lib/tiptap-content.ts`** — TipTap doc ↔ HTML ↔ plaintext serialization.
- **`src/lib/notes/derive-progress-strip.ts`** — derives `NoteProgressStrip` from `Note.inferenceLog._sectionStatus`.
- **`src/types/`** — shared TypeScript types not generated by Prisma.
- **`src/generated/prisma/`** — Prisma client (do not edit; regenerated on `prisma generate`).
- **`prisma/`** — `schema.prisma`, `migrations/`, `seed.ts`.
- **`public/audio/pcm-worklet.js`** — AudioWorklet PCM capture (Int16 LE @ 16 kHz mono).
- **`infra/`** — AWS CDK stacks.
- **`scripts/`** — build/test utilities (`clean-next.mjs`, `start-standalone.mjs`, `run-tests.mjs`).

## Data Model

Build the `prisma/schema.prisma` file with these models grouped by domain. Migrations are append-only after first apply.

### Tenancy
- `Organization` — tenant root; `division` (REHAB/MEDICAL/BEHAVIORAL_HEALTH/MULTI), `defaultDivision`, billing email, Stripe customer ID, **`baaExecutedAt`, `baaVersion`, `baaCountersignedBy`, `complianceProfile`** (enum: STANDARD / BH_42CFR2 / RESEARCH).
- `Site` — clinic location; optional primary division.
- `Department` — clinical department (PT, OT, SLP, etc.); org + optional site scope.
- `Room` — physical or virtual room for encounters.
- `Seat` — subscription seat; `SeatTier` enum (SOLO/TEAM/ENTERPRISE), assigned to `OrgUser`, expirations + transfers.
- `FeatureFlag` — per-org toggle (key/value metadata).
- `SystemAnnouncement`, `IpAllowlistEntry` — ops controls.

### Identity & Roles
- `User` — global identity; `email` (unique), `passwordHash`, optional `phone`, `loginVerifyChannel`, `platformRole` (`PLATFORM_OWNER` | `NONE`).
- `LoginVerificationCode` — bcrypt-hashed one-time codes; fresh row per sign-in attempt.
- `OrgUser` — membership row joining User × Org; `role` ∈ `{ORG_ADMIN, SITE_ADMIN, CLINICIAN, VIEWER}`, `division`, `profession`, `canManagePatients`, `preferredNoteStyle`. Platform-owner authority is exclusively on `User.platformRole = PLATFORM_OWNER` — never conflated with OrgRole.
- `UserSession` — active session tokens.
- `PractitionerProfile` — clinician identity for EHR (NPI, specialty, display name).
- `Invite` — org-scoped user invites with role pre-configured; `expiresAt`, `consumedAt`.

### Patient
- `Patient` — demographics, MRN, DOB, sex (SAAB), insurance, division, site, `isDeleted`, `deletedAt`.
- `PatientAddress`, `PatientCoverage`, `PatientEmergencyContact`, `PatientGuarantor`, `PatientConsent`, `PatientCommunicationPreference`.
- `PatientDepartmentEnrollment` + `PatientDepartmentIntake` (sensitivity-level gated; `42 CFR Part 2` propagation).

### Encounter & Note
- `Encounter` — single clinical visit; `EncounterStatus`; links to Schedule, Note, Patient, Practitioner, Room.
- `Schedule` — appointment; `VisitType` (IN_PERSON/TELEHEALTH), duration, `ScheduleStatus`.
- `Note` — core clinical document. Key fields:
  - `status` (`NoteStatus`: PREPARING/RECORDING/PAUSED/TRANSCRIBING/DRAFTING/DRAFT/REVIEWING/SIGNED/TRANSFERRED/INTERRUPTED/PENDING_REVIEW) — **append-only enum**
  - `captureMode` (LIVE/UPLOADED/PASTED)
  - `audioFileKey` — S3 path (never hard-deleted)
  - `transcriptRaw` (raw Soniox JSON), `transcriptClean` (post-processed)
  - `draftJson` (TipTap, in-progress), `finalJson` (frozen on sign)
  - `inferenceLog` — JSON tracking AI gen state, `_sectionStatus`, retries, regenerations
  - `noteStyle`, `division`, `sensitivityLevel`
  - `templateId`, `templateVersion`
  - `signedAt`, `signedByUserId`, `authorOrgUserId`
  - `backfilledAt`, `backfillReason`
  - `episodeId` (optional link)
- `AudioSegment` — per-segment metadata (S3 key, duration, start/end, room).
- `NoteBrief` — precomputed prior-context brief (1:1 with signed `Note`).
- `NoteTemplate` — section schema JSON; visibility (`PERSONAL`/`TEAM`/`PUBLIC`); division; specialty; preset flag; `sensitivityDefault`; `promptHints` JSON.
- `NoteArtifact` — post-sign documents (referral letters, patient instructions); distinct from `finalJson`; per-`NoteArtifactKind` enum.

### Episodes & Goals
- `EpisodeOfCare` — patient + clinician + dept; diagnosis + body part; start/end; `EpisodeStatus` (ACTIVE/RECERT_DUE/DISCHARGED/CANCELLED).
- `EpisodeGoal` — `goalText`, `goalType` (STG/LTG), baseline/target/current, `GoalStatus`, origin/resolved note references.
- `GoalProgressEntry` — per-goal progress update; `measureValue`, `statusAtEntry`, `deltaNote`, `recordedAt`, `recordedByOrgUserId`.
- `FollowUp` — extracted from plan sections; `FollowUpStatus` (OPEN/MET/CARRIED/DROPPED/CLOSED_BY_DISCHARGE); origin note + optional closing note.

> **UI scope rule (enforced as of Sprint 0.10):** The Episodes tab on `/patients/[id]` is gated to patients who have at least one `REHAB`-division episode. The plan-of-care structure (recert cycles, visit authorizations, STG/LTG goals) is a Rehab / therapy construct. Medical and BH episodes exist in the data model and continue to feed AI prompts, the prior-context brief, and the Safety Band problems list — they are never hidden from the AI or the data layer, only from the dedicated Episodes UI tab. When Medical and BH receive their own plan-of-care UI in a future wave, the tab gate will be updated.

### Voice ID
- `VoiceProfile` — TitaNet enrollment per user × org; `embedding vector(192)`, `displayName`, `defaultRole` (CLINICIAN/OTHER); BIPA consent versioning; soft-delete + 30-day hard-delete grace.

### Audit & Snapshot
- `AuditLog` — append-only; `(userId, orgId, action, resourceType, resourceId, metadata JSON)`; indexed by `(orgId, createdAt)`, `(patientId, createdAt)`. **PHI-free metadata** (rule 8).
- `PlatformAuditLog` — owner/staff actions.
- `PlatformSession` — owner/staff session tracking.
- `SnapshotOverride` — clinician-edited measure overrides for patient snapshot strip; reversible.

### Telehealth (Wave 3)
- `TelehealthSession` — `magicToken`, `magicTokenExpiresAt`, `patientVerifiedAt`, `patientSessionToken`, `dailyRoomUrl`, `dailyRoomCreatedAt`, `dailyRoomEndedAt`, `status` (`TelehealthSessionStatus`), `startedAt`, `endedAt`, `consentCapturedAt`.

### FHIR (Wave 4)
- `FhirCachedResource` — local cache of FHIR R4 resources keyed by EHR + patient + resource type; `verifiedAt`, refresh policy fields.

## Storage Model

- **PostgreSQL (RDS)** — all structured data (users, orgs, notes, patients, encounters, episodes, goals, follow-ups, audit logs, templates, sessions, briefs, FHIR cache, telehealth sessions). pgvector extension for `VoiceProfile.embedding`. Multi-AZ, encrypted at rest, SSL required (`rds.force_ssl: 1`), 30-day backups, 7-year HIPAA deletion delay.
- **Redis (ElastiCache)** — BullMQ queues only: `transcription`, `ai-generation`, `note-finalize`, `voice-id`, `note-brief`, `post-sign-artifacts`, `fhir-sync` (Wave 4). **One fleet per Redis** (rule 18). TLS in-transit, KMS at-rest, 2 replicas, automatic failover.
- **S3** — two buckets:
  - `omniscribe-audio-{env}` — audio files; versioned, encrypted, public access blocked, presigned URLs only (rule 15), lifecycle 90 d → Glacier Instant → 365 d → Deep Archive → 2555 d → expire. **Never hard-deleted** (rule 7).
  - `omniscribe-assets-{env}` — frontend assets; CloudFront in front.
- **Audio key convention** — `audio/raw/{noteId}/{segmentId}.wav` (derived from `AudioSegment`).
- **pgvector** — `VoiceProfile.embedding` only in v1. (Future: brief embeddings — out of scope.)

## Auth & Access Model

- **NextAuth.js v5** with JWT strategy (stateless; no DB session table per NextAuth convention).
- **Session shape** — `{ user: { id, email, name, image, orgId, role, division, profession, professionType, platformRole } }`.
- **Authentication** — password-only (NextAuth credentials provider; bcrypt 12 rounds; account lockout via `User.failedLoginCount` / `lockedUntil`). **Sprint 0.20 removed MFA + login-verified gates entirely.** Account recovery: admin invite (`POST /api/admin/invites` → `/onboarding/[token]`) + password reset (`/password-reset/{request,verify,confirm}`). Note-signing PIN (`User.signingPinHash` / `signUnlockedUntil`) is the only remaining second-factor and applies at sign-time only.
- **Password reset** — single-use token via Resend email; bcryptjs hash on confirm; all sessions invalidated.
- **Sign-time auth** — 4-digit signing PIN with 30-minute unlock window (separate from login codes).
- **API route gate** — `requireFeatureAccess(featureKey, req)` resolves `User` → `OrgUser` → `FeatureKey` allowlist. Returns `{ user, orgUser, authorizationUser, error }`. Routes early-return on error.
- **FeatureKey enum** — `NOTE_CREATE, NOTE_EDIT, NOTE_REVIEW, NOTE_SIGN, VOICE_ID, PATIENT_MANAGEMENT, TEMPLATE_MANAGEMENT, BILLING_MANAGE, TEAM_MEMBERS_MANAGE, TRANSCRIPT_VIEW, VOICE_PROFILE_MANAGE, VISITS_CREATE, TEMPLATE_LIBRARY_READ, TEMPLATE_LIBRARY_MANAGE`. The (`OrgRole` × `Division` × `FeatureKey`) matrix lives in `src/lib/authz/internal-authorization.ts`.
- **PHI scoping** — `src/lib/phi-access.ts` (`canAccessClinicianOwnedResource`, division gating, sensitivity-level gating). Org scoping enforced at the Prisma query layer (`WHERE orgId = ?` on every PHI query).
- **Sensitivity tiers** (`NoteSensitivityLevel`) — STANDARD_CLINICAL / BEHAVIORAL_HEALTH (42 CFR Part 2 gate) / BILLING_ONLY / ADMINISTRATIVE.
- **Platform role** — `PLATFORM_OWNER` for cross-org owner console; `NONE` otherwise.

## AI & Background Task Model

Five BullMQ queues in v1, plus 2 in later waves. One shared Redis, one worker fleet per environment.

| Queue | Job types | Enqueued by | Retries | Writes |
|---|---|---|---|---|
| `transcription` | `finalize-realtime-transcript`, `transcribe-uploaded-audio` | `/api/notes/[id]/complete-stream`, `/api/notes/[id]/upload-audio` | 3, exp backoff 5s/10s/20s | `Note.transcriptRaw`, `Note.transcriptClean`, `Note.status` |
| `ai-generation` | `generate-note`, `regenerate-section` (discriminator on `job.data.type`) | review/capture API routes; section regenerate POST endpoint | 3, exp backoff | `Note.draftJson`, `Note.inferenceLog._sectionStatus` |
| `note-finalize` | `finalize-note` | post-sign route | 3, exp backoff | `Note.finalJson` (immutable after) |
| `voice-id` | `match-speakers`, `compute-enrollment-embedding` | transcription worker fan-out; profile enrollment | 2, best-effort | `Note.transcriptClean` (speaker labels); `VoiceProfile.embedding` |
| `note-brief` | `precompute-brief` | post-sign route | 3, exp backoff, idempotent jobId `note-brief:{noteId}` | `NoteBrief` row |
| `post-sign-artifacts` | `generate-patient-instructions`, `generate-referral-letter` | post-sign route | 3, exp backoff | `NoteArtifact` row |
| `fhir-sync` (Wave 4) | `sync-patient-resources` | brief generator + on-demand | 3, exp backoff + rate limit | `FhirCachedResource` rows |

### LLM Abstraction (sole AI ingress — rule 6)

`src/services/llm/index.ts`:

```ts
export function getLLMService(): LLMService;

interface LLMService {
  generate(systemPrompt: string, userPrompt: string, opts?: GenerateOptions): Promise<GenerateResult>;
  generateStream(systemPrompt: string, userPrompt: string, opts?: GenerateOptions): AsyncIterator<GenerateChunk>;
}

interface GenerateOptions {
  phi: boolean;             // triggers assertProviderAllowedForPHI
  temperature?: number;     // default 0
  maxTokens?: number;
  model?: 'sonnet' | 'haiku';  // default sonnet; haiku on retry
  jsonMode?: boolean;
  requestId?: string;
}
```

**Provider allowlist for PHI** (`assertProviderAllowedForPHI`):
- ✅ `bedrock` (AWS Bedrock; BAA via AWS)
- ✅ `vllm` (self-hosted; BAA n/a)
- ❌ `openai`, `openrouter`, `anthropic-direct` — blocked for PHI; usable only when `opts.phi === false`

**Bedrock config**:
- `BEDROCK_REGION=us-east-1`
- `BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-...` (cross-region profile; **`us.` prefix required**)
- `BEDROCK_FAST_MODEL_ID=us.anthropic.claude-haiku-4-5-...`
- `AWS_BEARER_TOKEN_BEDROCK=ABSK…` (long-term API key, **not** `AWS_ACCESS_KEY_ID`)

### Prompt templates

- `src/lib/note-medical-prompt.ts` — SOAP/medical formats; `deriveMedNoteType()` picks subtype.
- `src/lib/note-behavioral-health-prompt.ts` — BH formats; `buildBHMasterPrompt()`.
- `src/lib/note-rehab-master-prompt.ts` — Rehab episodes + goals; `buildRehabMasterPrompt()`.
- All temperature 0. All take `BuildPromptInput` (transcript + template + style + patient projection + episode + prior context).

### Section status JSON

`Note.inferenceLog._sectionStatus`:
```ts
{
  [sectionId: string]: {
    status: 'empty' | 'generating' | 'populated' | 'edited' | 'failed';
    progressPercent?: number;
    generationStartedAt?: string;
    lastGeneratedAt?: string;
    error?: { code: string; message: string };
  }
}
```

Derived to UI via `src/lib/notes/derive-progress-strip.ts` → `NoteProgressStrip`.

## Real-time Pipeline (browser → signed note)

```
[Browser AudioWorklet (PCM Int16 LE @ 16 kHz)]
        │
        │ port.postMessage(chunks)
        ▼
[Browser app] ── POST /api/notes/[id]/realtime-key ──> [Server: mint Soniox ephemeral key (60s TTL, STT-WS only)]
        │ (api_key, ws_url, config)
        │
        │ open WebSocket directly to Soniox (browser-side)
        ▼
[Soniox] ── partials + finals ──> [Browser: render diarized transcript live]
        │
        │ POST /api/notes/[id]/complete-stream { finalTranscript, audioBlob }
        ▼
[Server] writes Note.transcriptRaw + uploads audio to S3 (audio/raw/{noteId}/{segmentId}.wav)
        │
        │ enqueue transcription job
        ▼
[transcription worker] cleans transcript, writes Note.transcriptClean, transitions status
        │
        │ enqueue ai-generation job (and voice-id fan-out)
        ▼
[ai-generation worker] streams sections via LLM, writes Note.draftJson + _sectionStatus
        │                                    │
        │                                    └── SSE: clients subscribed to /api/notes/[id]/stream?include=sections receive section.generating / section.completed
        ▼
Note.status: DRAFTING → DRAFT → REVIEWING (when clinician opens /review)
        │
        │ clinician edits, regenerates sections, sweeps follow-ups
        ▼
[POST /api/notes/[id]/sign] → signing PIN → finalize → status: SIGNED, finalJson frozen, audit log
        │
        │ enqueue note-brief job (precompute next visit's brief)
        │ enqueue post-sign-artifacts jobs (referral letters, patient instructions)
```

### Telehealth variant (Wave 3)

Identical pipeline except the audio source: the browser uses `MediaStreamTrackProcessor` to tap the WebRTC audio track from Daily.co, then pumps it through the same Soniox real-time WS. The capture page knows it's a telehealth session via `Note.captureSubMode: 'TELEHEALTH'` but downstream code doesn't care.

### SSE / Progress Streams

`GET /api/notes/[id]/stream?include=status,sections` — polling-based SSE (2-second poll interval, not Redis pub/sub).

- **PROCESSING** (`?include=status`) — subscribes to note-level status; closes when note exits `DRAFTING`. Auth: `NOTE_REVIEW`.
- **CAPTURE** (`?include=sections`) — subscribes to section-level events; allows clinician to edit during AI generation. Auth: `NOTE_EDIT`.

Both modes max 10 minutes per connection; client reconnects automatically.

## Deployment Topology

```
                      [CloudFront]
                          │
                          ▼
                     [App Runner OR ECS Fargate + ALB]   ← Dockerfile.app, Next.js standalone
                          │
                          │  (private)
                          ├──> [RDS PostgreSQL 16 Multi-AZ, encrypted, SSL]
                          │
                          ├──> [ElastiCache Redis 7.1, TLS, 2 replicas]
                          │
                          └──> [S3 audio + assets buckets, KMS]

                     [ECS Fargate: omniscribe-workers]   ← Dockerfile.worker, npx tsx src/workers/index.ts
                       1–5 tasks, 512 CPU / 1024 MB, IAM task role
                          │
                          └──> same RDS / Redis / S3 / Bedrock / Soniox
```

- **Networking** — VPC with private subnets for RDS, ElastiCache, Fargate; egress for external APIs (Soniox, Bedrock, Stripe, Resend, Daily.co).
- **Secrets** — AWS Secrets Manager loaded at container startup; **never** in console env vars (rule 14).
- **AWS credentials** — IAM task roles in production (rule 13); no static access keys in env.
- **Healthchecks** — workers expose no HTTP port; healthcheck = task RUNNING + CloudWatch log activity. App runs `/api/health` + `/api/healthcheck`.
- **Deploy** — after Redis recovery events (cap reset, plan upgrade, outage), force a fresh ECS deployment so workers don't stay in retry backoff (rule 19).

## Environment Variables

`.env` (loaded by docker-compose + Next.js):
- `SONIOX_API_KEY` — long-lived org key, **server-side only**, **never ship to browser** (rule 11)

`.env.local` (loaded by Next.js + workers):
- `DATABASE_URL` — Postgres connection
- `REDIS_URL` — Redis connection
- `TRANSCRIPTION_PROVIDER=soniox` — default
- `SONIOX_BAA_ON_FILE=true` — **required in any non-dev env** (rule 17)
- `SONIOX_REALTIME_MODEL=stt-rt-v4` — optional default
- `LLM_PROVIDER=bedrock`
- `BEDROCK_REGION=us-east-1`
- `BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-...` — **must include `us.` prefix**
- `BEDROCK_FAST_MODEL_ID=us.anthropic.claude-haiku-4-5-...`
- `AWS_BEARER_TOKEN_BEDROCK` — Bedrock long-term API key (`ABSK…` format); **do not** put in `AWS_ACCESS_KEY_ID`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — only for S3 / other SDKs that use SigV4
- `NEXTAUTH_SECRET` — JWT secret (32+ chars)
- `NEXTAUTH_URL` — base URL of app
- `RESEND_API_KEY` — transactional email
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — billing
- `DAILY_API_KEY`, `DAILY_DOMAIN` — telehealth (Wave 3)
- `NODE_ENV=production` for prod

Production secrets in AWS Secrets Manager:
- `/omniscribe/production/database`
- `/omniscribe/production/redis`
- `/omniscribe/production/soniox-api-key`
- `/omniscribe/production/bedrock-bearer-token`
- `/omniscribe/production/nextauth-secret`
- `/omniscribe/production/stripe-secret-key`
- `/omniscribe/production/resend-api-key`
- `/omniscribe/production/daily-api-key` (Wave 3)

## Local Development

```bash
docker compose up -d            # postgres + redis only
npx prisma migrate dev
npx prisma db seed              # REQUIRED after any schema change (rule 4)
npm run dev                     # Terminal 1: Next.js
npm run dev:workers             # Terminal 2: BullMQ workers (REQUIRED — rule 16)
```

**Rule 16 reminder**: `npm run dev:workers` MUST run alongside `npm run dev`. Without it, transcription, AI generation, voice-id, brief — none of it processes. Notes get stuck in `DRAFTING`. If you see a stuck note, check `dev:workers` is alive *before* debugging anything else.

Seed credentials (canonical demo data):
- Admin: `admin@demo.local` / `Demo1234!`
- Clinician: `clinician@demo.local` / `Demo1234!`

## Invariants (anti-regression rules — never violate)

The build is governed by these rules from day one. Violating them causes production incidents, audit failures, or data loss.

1. **NEVER remove or rename existing Prisma models** without a migration.
2. **NEVER change `NoteStatus` enum values** — append only.
3. **NEVER modify a signed note's `finalJson`** — it is immutable. Addenda are distinct `NoteArtifact` records.
4. **ALWAYS run `npx prisma db seed`** after schema changes.
5. **ALWAYS verify file existence** after creating files (S3 upload verification).
6. **NEVER remove the LLM abstraction layer** — all AI calls go through `src/services/llm/`.
7. **Audio files NEVER deleted from S3** — only soft-deleted in DB.
8. **Audit log writes NEVER wrapped in try-catch** that silently swallows errors.
9. **Clinical screens must always pass the "3-tap test"** before merging.
10. **BullMQ jobs MUST have retry logic** — 3 retries, exponential backoff.
11. **NEVER call the Soniox SDK directly** from app code — go through `src/services/transcription/`. Browser WS bootstrapped via `/api/notes/[id]/realtime-key`.
12. **Soniox real-time configs MUST keep** `enable_speaker_diarization: true` and `audio_format: "pcm_s16le"`.
13. **NEVER use AWS access keys in production** — use IAM roles.
14. **NEVER store secrets in AWS console env vars** — use Secrets Manager only.
15. **S3 bucket public access MUST ALWAYS be blocked** — presigned URLs only.
16. **`npm run dev:workers` MUST be running** for any flow that ends in a generated note.
17. **Any non-dev environment processing PHI MUST set `SONIOX_BAA_ON_FILE=true`** AND have a current Soniox BAA on file.
18. **NEVER run two BullMQ worker fleets** against the same Redis simultaneously.
19. **After any Redis recovery event**, force a fresh ECS deployment.
20. **Copilot reads only `Note.status ∈ {SIGNED, TRANSFERRED}`, clinician-confirmed `FollowUp` rows, and verified `FhirCachedResource`.** Never drafts. Never inferences beyond source.
21. **Three-lens evaluation** — every feature passes Clinician + Medicare Compliance Officer + Insurance Auditor before merge.
22. **No native `confirm()` or `alert()`** in clinical surfaces — use `<AlertDialog>`.
23. **No hardcoded status colors** in clinical surfaces — use `<StatusBadge>` / `<StatusBanner>`.
24. **Copilot cards never make clinical recommendations** — data only; action tools require explicit clinician initiation + confirmation.

## Deep-Dive Companion References

| Subsystem | Deep dive |
|---|---|
| Copilot architecture | [`references/encounter-copilot-spec.md`](../references/encounter-copilot-spec.md) |
| FHIR architecture (Wave 4) | [`references/fhir-integration-spec.md`](../references/fhir-integration-spec.md) |
| Telehealth architecture (Wave 3) | [`references/telehealth-architecture-spec.md`](../references/telehealth-architecture-spec.md) |
| Prior-context brief | [`references/prior-context-brief-spec.md`](../references/prior-context-brief-spec.md), [`references/prior-context-brief-prompt.md`](../references/prior-context-brief-prompt.md) |
| Section progress + regenerate | [`references/section-progress-spec.md`](../references/section-progress-spec.md) |
| Admin commercial-readiness | [`references/audit-admin-state-of-play.md`](../references/audit-admin-state-of-play.md) |
| HIPAA controls matrix | [`references/strategic/hipaa-scribe-controls-matrix.md`](../references/strategic/hipaa-scribe-controls-matrix.md) |
