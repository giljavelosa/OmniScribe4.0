# Unit 15: Telehealth Infrastructure + Patient Auth

## Goal

Wave 3's opener — stand up the telehealth session lifecycle that Units 16+17 build on. A clinician schedules a telehealth visit (existing Schedule with `visitType: TELEHEALTH` from Unit 02) → backend mints a magic link → patient receives email/SMS → clicks the link → verifies DOB → lands in the waiting room → clinician starts the call → patient enters the Daily.co room.

Per [`references/telehealth-architecture-spec.md`](../../references/telehealth-architecture-spec.md) Phase 1. Video is NOT an artifact of record — the note is. The session table tracks lifecycle + audit, not the call recording.

## Design

### Magic link contract

- 22-char random token (URL-safe base64; ~131 bits of entropy)
- 24-hour expiration after issuance + 2-hour grace period after the scheduled visit start time
- Single-use: consumed on DOB verification; subsequent visits to the URL surface "link already used" with a "request a new link" CTA (out of scope v1 — clinic admin re-issues manually)
- DOB verify is the second factor (link possession + identity proof). DOB stored on Patient (Unit 02) — comparison done server-side via direct field equality.

### Daily.co integration

Stub-mode pattern matching Soniox/Bedrock/S3/Stripe: when `DAILY_API_KEY` is unset, `DailyService.createRoom` returns a synthetic `{ stub: true, roomUrl, roomName, expiresAt }`. Real-mode call lives in `src/services/telehealth/daily.ts` but throws an explicit gap error in v1 — wire when the first paying customer signs.

Rooms are created on session start (not at schedule time) so a no-show patient doesn't consume Daily.co allotment. Room destroy on session end.

### Surfaces (this unit)

- `/v/[magicToken]` — patient identity verification page (token + DOB form)
- `/telehealth/waiting/[scheduleId]` — patient waiting room (post-verify; polls for clinician readiness)

Clinician-side `/telehealth/room/[scheduleId]` lands in Unit 17 (integrates capture controls). Unit 15 ships server-side endpoints + patient surfaces only.

## Implementation

### A. Schema

```prisma
model TelehealthSession {
  id               String    @id @default(cuid())
  orgId            String
  organization     Organization @relation(fields: [orgId], references: [id])
  scheduleId       String    @unique
  schedule         Schedule  @relation(fields: [scheduleId], references: [id])
  patientId        String
  patient          Patient   @relation(fields: [patientId], references: [id])
  /** Magic-link token, 22 char base64url. Indexed for the GET /v/[token] lookup. */
  magicToken       String    @unique
  /** Token expires at the earlier of: issuedAt + 24h, scheduledEnd + 2h. */
  magicExpiresAt   DateTime
  /** Set when patient successfully verifies DOB. Single-use semantics:
   *  subsequent magicToken lookups return "consumed". */
  verifiedAt       DateTime?
  /** Patient consent capture — required before clinician starts the call. */
  consentAt        DateTime?
  consentVersion   String?
  /** Daily.co room metadata (or stub equivalents). */
  roomUrl          String?
  roomName         String?
  roomExpiresAt    DateTime?
  status           TelehealthSessionStatus @default(SCHEDULED)
  startedAt        DateTime?
  endedAt          DateTime?
  endedReason      String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
}

enum TelehealthSessionStatus {
  SCHEDULED         // session row exists, magic link issued
  VERIFIED          // patient verified DOB, in waiting room
  CONSENT_CAPTURED  // consent recorded, ready for clinician to start
  ACTIVE            // clinician started; Daily.co room live
  COMPLETED         // call ended normally
  CANCELLED         // pre-call cancellation (clinician or patient)
  EXPIRED           // magic link expired before verification
}
```

### B. Magic-link generator

`src/lib/telehealth/magic-link.ts`:
- `generateMagicToken()` — 22 chars from `crypto.randomBytes(16)` base64url-encoded (drops `=` padding).
- `computeMagicExpiresAt(issuedAt, scheduledEnd)` — min(issuedAt + 24h, scheduledEnd + 2h).
- `verifyDob(input, stored)` — strict YYYY-MM-DD comparison after stripping time component. Returns boolean; on mismatch, the route returns 401 but does NOT distinguish "wrong DOB" from "unknown token" (anti-enumeration).

### C. Daily.co stub-mode service

`src/services/telehealth/daily.ts`:
- `dailyConfig.isStubMode` flag (true when `DAILY_API_KEY` unset)
- `createRoom({ sessionId, expiresAt })` — stub: `{ stub: true, roomUrl: 'https://stub.daily.co/...', roomName: 'stub-...', expiresAt }`
- `destroyRoom({ roomName })` — stub no-op
- Real-mode: throws explicit gap error until wired

### D. APIs

- `POST /api/admin/telehealth/sessions` — admin creates a session for a Schedule. Mints token + computes expiry + writes session row + sends magic link email. Audits `TELEHEALTH_SESSION_CREATED`.
- `POST /api/telehealth/v/[token]/verify` — patient submits DOB. Validates expiry + verifies + flips status to VERIFIED. Audits `TELEHEALTH_PATIENT_VERIFIED` (PHI-free).
- `POST /api/telehealth/v/[token]/consent` — patient submits consent (consentVersion). Flips status to CONSENT_CAPTURED. Audits `TELEHEALTH_CONSENT_CAPTURED`.
- `POST /api/admin/telehealth/sessions/[id]/start` — clinician starts; creates Daily.co room (stub-mode safe); flips status to ACTIVE. Audits `TELEHEALTH_SESSION_STARTED`.
- `POST /api/admin/telehealth/sessions/[id]/end` — clinician ends; destroys room; flips to COMPLETED. Audits `TELEHEALTH_SESSION_ENDED`.
- `GET /api/telehealth/v/[token]/status` — patient polls in the waiting room.

### E. UI

- `/v/[token]` — minimal landing page: token (in URL) + DOB input; on success → redirect to `/telehealth/waiting/[scheduleId]`. Anti-enumeration: generic "Invalid link or DOB" error.
- `/telehealth/waiting/[scheduleId]` — patient-facing waiting room. Polls `/status` every 5s; transitions to call surface (Unit 17) when status flips to ACTIVE.

### F. Audit actions

- `TELEHEALTH_SESSION_CREATED`
- `TELEHEALTH_MAGIC_LINK_FAILED` (DOB mismatch / expired / consumed — single PHI-free action)
- `TELEHEALTH_PATIENT_VERIFIED`
- `TELEHEALTH_CONSENT_CAPTURED`
- `TELEHEALTH_SESSION_STARTED`
- `TELEHEALTH_SESSION_ENDED`
- `TELEHEALTH_ROOM_CREATED`
- `TELEHEALTH_ROOM_DESTROYED`

## Out of scope (v1)

- Real Daily.co integration (stub-mode pattern applies — flips when DAILY_API_KEY is set)
- SMS magic-link delivery (email only via existing Resend transport)
- Clinician-side `/telehealth/room/[scheduleId]` (Unit 17)
- Mid-call rejoin if patient disconnects (Wave 3 polish)
- Recording / video artifact storage (out of scope per spec — video is NOT an artifact of record)

## Verify when done

- Schema migration applied; demo seed unchanged.
- Magic token generator produces 22-char URL-safe tokens with ≥128 bits entropy.
- DOB verify returns generic error on mismatch (anti-enumeration).
- Stub-mode Daily.co works end-to-end without DAILY_API_KEY.
- /v/[token] page renders + verifies + redirects to waiting room.
- /telehealth/waiting/[scheduleId] polls status + auto-advances on ACTIVE.
- All 8 audit actions wired.
- progress-tracker.md updated.
