# Unit 19: FHIR — SMART OAuth2 Auth Foundations (F1)

## Goal

Wave 4 opener. First foundation for read-only EHR integration per `references/fhir-integration-spec.md` Phase F1.

> **F1 ships when** a clinician can launch from NextGen, complete OAuth2, and the resulting token is encrypted in Postgres and refreshed before expiry. **No data fetching yet — auth only.**

This unit lands the SMART on FHIR auth foundation everything else in Wave 4 builds on. Resource fetching is F3 (Unit 21); brief enrichment is F4 (Unit 22). v1 is **per-clinician, provider-launched, read-only** — these are locked decisions per the reference spec.

## Locked decisions (carried from reference spec)

| # | Decision | Value |
|---|---|---|
| 1 | Launch model | Provider-launched (EHR-launched). Standalone launch is v2. |
| 2 | Identity scope | Per-clinician (each clinician auths separately). Per-org service accounts are v2. |
| 3 | First EHR vendor | NextGen (sandbox). Epic + Cerner are F6 (Unit 24). |
| 4 | Token encryption | AES-256-GCM at rest. Key from env (`FHIR_TOKEN_ENCRYPTION_KEY`, 32 raw bytes base64-encoded). |
| 5 | Required scopes (v1) | `launch launch/patient patient/Patient.read patient/Encounter.read patient/Observation.read patient/MedicationStatement.read patient/MedicationRequest.read patient/Condition.read patient/AllergyIntolerance.read patient/DiagnosticReport.read patient/Procedure.read offline_access` |
| 6 | Stub mode | When `FHIR_NEXTGEN_CLIENT_ID` is unset, the launch endpoint synthesizes a fake clinician identity + a stub access/refresh token. Matches the Soniox / Bedrock / S3 / Daily.co stub pattern. |

## Design

### Provider-launched flow

```
1. Clinician opens patient chart in NextGen
2. Clinician clicks "OmniScribe" launch button
3. NextGen redirects browser to: /api/fhir/launch?iss=<FHIR_BASE_URL>&launch=<launch_token>
4. /api/fhir/launch:
     - Resolves the EHR's SMART configuration via .well-known/smart-configuration
     - Generates state + code_verifier (PKCE)
     - Stores state → { clinicianId, iss, launchToken, codeVerifier } in a short-TTL row
     - Redirects to EHR's authorization endpoint with scopes + redirect_uri + state + code_challenge
5. Clinician already authenticated to NextGen → NextGen approves automatically → redirects to /api/fhir/callback?code=<auth_code>&state=<state>
6. /api/fhir/callback:
     - Resolves state → fetches the stored launch context
     - POSTs auth_code + code_verifier to EHR's token endpoint
     - Receives { access_token, refresh_token, expires_in, scope, patient }
     - Encrypts both tokens, upserts FhirIdentity row keyed by (clinicianId, ehrSystem)
     - Optionally seeds a PatientFhirIdentity row when `patient` context is present (Unit 20 owns matching; F1 just records what NextGen gave us)
     - Redirects to a small "Connected" surface inside OmniScribe
7. Subsequent FHIR calls (F3+): the resource sync worker reads FhirIdentity, decrypts, checks `expiresAt`; if within 5 min of expiry, refreshes via refresh_token; updates the row.
```

### Schema

Three tables go in this unit. PatientFhirIdentity + FhirCachedResource are referenced in the spec but their CRUD lands in Units 20–21; we ship the schema now so the lockfile / Prisma client are stable and F1 can write a partial PatientFhirIdentity when NextGen returns patient context.

```prisma
model FhirIdentity {
  id            String   @id @default(cuid())
  orgId         String
  organization  Organization @relation(fields: [orgId], references: [id])
  clinicianOrgUserId String
  clinician     OrgUser  @relation("FhirIdentityClinician", fields: [clinicianOrgUserId], references: [id])
  ehrSystem     String   // 'nextgen' | 'epic' | 'cerner' | 'stub'
  fhirBaseUrl   String
  /** AES-256-GCM-encrypted access token. Format: 'v1:<base64(iv)>:<base64(ciphertext)>:<base64(authTag)>' */
  accessTokenEnc  String  @db.Text
  refreshTokenEnc String  @db.Text
  scope         String   @db.Text
  expiresAt     DateTime
  /** Last successful refresh; null until first refresh fires. */
  refreshedAt   DateTime?
  /** Patient context from the launch, if present (NextGen typically includes it). */
  launchPatientFhirId String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([clinicianOrgUserId, ehrSystem])
  @@index([orgId, ehrSystem])
}

model PatientFhirIdentity {
  id              String   @id @default(cuid())
  patientId       String
  patient         Patient  @relation(fields: [patientId], references: [id])
  ehrSystem       String
  fhirPatientId   String
  fhirIdentifier  String?
  /** 'verified' = clinician confirmed, 'high' = strong auto-match, 'manual' = needs review */
  matchConfidence String
  verifiedAt      DateTime?
  verifiedByOrgUserId String?
  createdAt       DateTime @default(now())
  @@unique([ehrSystem, fhirPatientId])
  @@index([patientId, ehrSystem])
}

model FhirCachedResource {
  id              String   @id @default(cuid())
  patientId       String
  patient         Patient  @relation(fields: [patientId], references: [id])
  ehrSystem       String
  resourceType    String
  fhirResourceId  String
  resource        Json
  fetchedAt       DateTime @default(now())
  sensitivityLevel String?
  @@unique([ehrSystem, resourceType, fhirResourceId])
  @@index([patientId, resourceType, fetchedAt])
}

model FhirLaunchState {
  /** Short-lived row that holds the SMART launch context between
   *  /api/fhir/launch and /api/fhir/callback. Cleaned up by the callback
   *  on success or by a periodic sweeper (Wave 4 polish). */
  state         String   @id // opaque random — sent as the OAuth `state` param
  clinicianOrgUserId String
  iss           String   // EHR's FHIR base URL (the `iss` query param)
  launchToken   String?  // SMART `launch` param when provider-launched
  codeVerifier  String   // PKCE code_verifier (kept server-side; never sent to browser)
  redirectUri   String   // our callback URL — locked at row creation
  ehrSystem     String   // 'nextgen' for v1
  createdAt     DateTime @default(now())
  expiresAt     DateTime // createdAt + 10 min
  @@index([expiresAt])
}
```

### Token encryption

`src/lib/fhir/token-crypto.ts`:

- `encryptToken(plain: string): string` — generates random 12-byte IV, encrypts with AES-256-GCM using the env key, returns `v1:<base64(iv)>:<base64(ct)>:<base64(tag)>`.
- `decryptToken(enc: string): string` — parses the `v1:` envelope, derives + checks auth tag, returns plaintext.
- Throws explicit `FhirTokenCryptoError` (custom class) on tampered ciphertext, bad envelope, or wrong key.
- Pure node:crypto, no third-party deps. Test against happy + tamper + wrong-key + bad-envelope cases.

Key handling: `FHIR_TOKEN_ENCRYPTION_KEY` is a 32-byte raw key, base64-encoded for env transport. Loaded once at module scope; throws if absent in non-stub mode. In stub mode (when `FHIR_NEXTGEN_CLIENT_ID` is unset), the encryption still works — the key is required even in stub mode so encrypted-at-rest behavior is exercised end-to-end. A default dev key is provided in `.env.example` (clearly labeled "LOCAL DEV ONLY").

### Routes

- `GET /api/fhir/launch?iss=…&launch=…` — provider-launched entry. NextAuth-session-gated; the clinician must be signed into OmniScribe (the EHR sees the iframe; the clinician's existing OmniScribe session is what we resolve `clinicianOrgUserId` from). Generates state, writes `FhirLaunchState` row, redirects to EHR auth endpoint.
- `GET /api/fhir/callback?code=…&state=…` — OAuth callback. Resolves state, exchanges code for tokens, encrypts + upserts FhirIdentity, deletes the launch state row, redirects to `/admin/integrations/fhir?connected=1`.
- `POST /api/admin/integrations/fhir/[id]/disconnect` — admin or owning clinician can wipe a FhirIdentity row. Audits.
- `POST /api/admin/integrations/fhir/[id]/refresh` — manual token refresh trigger (mostly for dev / debugging; the resource worker will auto-refresh in F3).

### Service layer

`src/services/fhir/smart-client.ts`:

- `resolveSmartConfig(fhirBaseUrl: string)` — fetches `<base>/.well-known/smart-configuration`, returns `{ authorizationEndpoint, tokenEndpoint }`. Cached in-memory per process for 1 h.
- `exchangeAuthCode(opts: { tokenEndpoint, code, codeVerifier, redirectUri, clientId, clientSecret })` — POSTs the auth code, returns parsed token response.
- `refreshAccessToken(opts: { tokenEndpoint, refreshToken, clientId, clientSecret })` — refreshes; returns the new token response.
- `STUB_MODE` flag (true when `FHIR_NEXTGEN_CLIENT_ID` is unset). Stub-mode implementations synthesize plausible responses so the launch + callback flow works end-to-end without a real NextGen sandbox.

### Audit actions

- `FHIR_LAUNCH_INITIATED` — `/api/fhir/launch` writes; metadata includes `iss`, `ehrSystem`, has `launchToken` boolean.
- `FHIR_AUTH_GRANTED` — callback success; metadata: `ehrSystem`, `scope`, `expiresInSeconds`, `hasLaunchPatient`.
- `FHIR_AUTH_FAILED` — callback failure path; metadata: `ehrSystem`, `reason` (e.g., `state_unknown`, `state_expired`, `token_exchange_failed`).
- `FHIR_TOKEN_REFRESHED` — successful refresh; metadata: `ehrSystem`, `expiresInSeconds`.
- `FHIR_DISCONNECTED` — clinician or admin wiped a FhirIdentity row; metadata: `ehrSystem`, `reason`.

PHI-free throughout. The PHI denylist already covers patient identifiers; the launch context's `launchPatientFhirId` is a vendor-side identifier, not patient data per HIPAA Safe Harbor.

### UI

`/admin/integrations/fhir` page (server component, admin-only):

- Lists FhirIdentity rows for the org — one per (clinicianOrgUserId, ehrSystem) — with: clinician name, ehrSystem, fhirBaseUrl, scope, expiresAt + refreshedAt, "Disconnect" action.
- "Connect to NextGen sandbox" button. In stub mode, this triggers a synthetic launch (POST that internally completes the flow + redirects). In real mode, it points the clinician at NextGen with instructions ("From your NextGen patient chart, click the OmniScribe launch button").

A small `<EhrIndicator>` chip can be added to the `/home` clinician surface in a follow-up; not part of F1.

## Implementation order

1. Spec + schema + audit actions (this commit)
2. Token encryption helpers + tests
3. SMART client + launch/callback/refresh routes
4. /admin/integrations/fhir page
5. Tracker + PR #20

## Out of scope (F1)

- Patient identity matching (F2 / Unit 20)
- Resource sync worker + caching (F3 / Unit 21)
- Brief generator FHIR enrichment (F4 / Unit 22)
- Provenance UI on the brief (F5 / Unit 23)
- Multi-EHR adapter abstraction (F6 / Unit 24)
- Standalone OAuth launch (v2)
- Per-org service accounts (v2)
- Token refresh BullMQ scheduler (the resource sync worker in F3 will refresh on-demand; a proactive scheduler is post-MVP)

## Verify when done

- Schema migration applied: FhirIdentity, PatientFhirIdentity, FhirCachedResource, FhirLaunchState.
- Token crypto roundtrips clean; rejects tampered ciphertext + bad envelope.
- `/api/fhir/launch` in stub mode: redirects to a stub authorize URL.
- `/api/fhir/callback` in stub mode: exchanges synthetic code for synthetic tokens, persists encrypted FhirIdentity, deletes launch state.
- `/admin/integrations/fhir` page renders + shows the connection + "Disconnect" works + audit row written.
- All 5 audit actions wired.
- progress-tracker.md updated; PR #20 stacked on Unit 18.
