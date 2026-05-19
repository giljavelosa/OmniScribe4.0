# External Context Upload — Spec

**Status:** approved 2026-05-18 (live walkthrough). Implementation: background agent.

## Problem

A patient may have prior care delivered elsewhere or earlier that the clinician wants to reference when documenting today's visit:

- Audio/transcript from a telehealth visit the patient sent in
- Documentation from a referring provider (paste or upload)
- A prior visit the clinician did but never documented (e.g., from a covering colleague's note, a chart-review session)
- Patient-supplied audio (e.g., home-recorded symptom diary)

Today the only path to "transcript + audio" is `/capture`, which assumes same-day clinician-delivered care. There is no clean way to add prior context without backdating a `Note`, which is a compliance hazard.

## Goals

1. **Compliance-clean date attribution.** Every entry records BOTH the date of the underlying event (`dateOfRecord`) AND when it was added to the system (`addedAt`). Never confuse the two.
2. **Surfaces in the next brief.** The Unit-06 brief generator considers ExternalContext alongside signed Notes when building prior-visit context.
3. **Read-only after upload.** No editing the body. Source-pill provenance (added by Dr. X on YYYY-MM-DD, dated YYYY-MM-DD, source: outside-provider).
4. **Never billable, never sign-able.** No `Note.signedAt` semantics. No CPT codes attached.

## Non-goals (v1)

- No clinician attestation flow. Adding ExternalContext is an information event, not a clinical-care event.
- No retroactive billing. CPT codes are not generated for ExternalContext.
- No follow-up extraction (Unit 06's FollowUp extractor reads signed-Note Plan sections only). ExternalContext narrates history; commitments live in actual Notes.
- No real-time pipeline. Uploads are processed (audio → transcribed via batch Soniox) on save, not live.

## Schema

```prisma
enum ExternalContextSource {
  PATIENT_SUPPLIED      // patient sent audio / transcript
  OUTSIDE_PROVIDER      // referring doc, prior facility
  EARLIER_UNDOCUMENTED  // visit clinician did but never documented
  CLINICIAN_NOTES       // free-text recollection
  OTHER
}

enum ExternalContextStatus {
  PENDING_TRANSCRIPTION  // audio uploaded, batch job queued
  READY                  // transcript + (optional) audio stored
  FAILED                 // transcription failed; transcript not available
}

model ExternalContext {
  id                String   @id @default(cuid())
  orgId             String
  organization      Organization @relation(fields: [orgId], references: [id])
  patientId         String
  patient           Patient  @relation(fields: [patientId], references: [id])
  episodeOfCareId   String?
  episode           EpisodeOfCare? @relation(fields: [episodeOfCareId], references: [id])

  /** Date the underlying event happened — NOT when the row was created. */
  dateOfRecord      DateTime
  source            ExternalContextSource
  /** Optional human note about the source ("Dr. Smith referral letter", "patient phone follow-up", etc.). */
  sourceLabel       String?

  /** Free-text recollection / paste-in transcript / OCR output. Always present. */
  transcriptClean   String
  /** Soniox batch result raw form (if from audio upload). Null when transcript was pasted. */
  transcriptRaw     Json?
  /** S3 key for the source audio. Null when transcript-only. */
  audioFileKey      String?

  status            ExternalContextStatus

  addedAt           DateTime @default(now())
  addedByOrgUserId  String
  addedBy           OrgUser  @relation(fields: [addedByOrgUserId], references: [id])

  @@index([patientId, dateOfRecord])
  @@index([orgId])
}
```

Migration: append-only (no rename / drop), rule-1-clean.

## Endpoints

### `POST /api/patients/[id]/external-context`

Create a new ExternalContext. Body validates against discriminated union:

```ts
// Paste mode
{
  mode: 'paste',
  dateOfRecord: ISO8601,        // required, must be ≤ today
  source: ExternalContextSource,
  sourceLabel?: string,
  episodeOfCareId?: string,
  transcript: string,           // min length: 1 char; max: 200 KB
}

// Upload mode (multipart/form-data)
{
  mode: 'upload',
  dateOfRecord: ISO8601,
  source: ExternalContextSource,
  sourceLabel?: string,
  episodeOfCareId?: string,
  audio: File,                  // .wav / .mp3 / .m4a; max 200 MB
}
```

Validation rules:
- `dateOfRecord` MUST be ≤ today and ≥ patient.createdAt - 5y (sanity).
- Paste mode → status = READY, transcriptClean = body, no audio.
- Upload mode → audio S3-uploaded immediately, status = PENDING_TRANSCRIPTION, BullMQ job enqueued (`transcribe-external-context` → Soniox batch → write transcriptClean + flip to READY).
- Requires `requireFeatureAccess('NOTE_CREATE')` (same gate as ad-hoc visit creation; clinicians can add context, no separate permission).
- Audit: `EXTERNAL_CONTEXT_ADDED` with `{ id, dateOfRecord, source, mode }` (PHI-free).

### `GET /api/patients/[id]/external-context`

List patient's ExternalContext records (most recent first by dateOfRecord). Returns id, dateOfRecord, source, sourceLabel, status, addedAt, addedBy.email, has-audio boolean. Body excluded from list view; load on detail.

### `GET /api/patients/[id]/external-context/[ecId]`

Detail view — returns full transcriptClean + presigned audio URL (if available + caller has access). Audit: `EXTERNAL_CONTEXT_VIEWED`.

### `DELETE /api/patients/[id]/external-context/[ecId]`

Soft-delete (add `deletedAt` column to schema if so). `EXTERNAL_CONTEXT_DELETED` audit. Only ORG_ADMIN+ can delete; clinicians cannot.

(For v1, simpler: no delete endpoint. Anything added is permanent. Add delete in v2 if needed.)

## Worker

New BullMQ queue: `external-context-transcription`. Handler:

```ts
type Job = { externalContextId: string; orgId: string; requestId: string };

async function handle(job: Job<Job>) {
  // 1. Load ExternalContext, verify status === PENDING_TRANSCRIPTION
  // 2. Soniox batch transcribe (reuse SonioxService.transcribeBatch)
  // 3. Run cleanBatchTranscript on the result
  // 4. Update ExternalContext: status = READY, transcriptClean = cleaned, transcriptRaw = batch result
  // 5. Audit EXTERNAL_CONTEXT_TRANSCRIPTION_COMPLETED
  // On unrecoverable failure: status = FAILED, audit EXTERNAL_CONTEXT_TRANSCRIPTION_FAILED
}
```

Idempotency: stable jobId `external-ctx:{externalContextId}:{requestId}`.

## Brief integration (Unit 06)

`BriefGenerator.loadPriorContext` currently pulls the 2 most recent signed Notes for the same episode (preferred) or patient (fallback). Extend to ALSO include all READY ExternalContext for the same patient where `dateOfRecord <= currentVisitStart`, ordered by `dateOfRecord` desc, max 5 records.

Brief prompt addition: a new system-prompt rule that ExternalContext entries are LOWER-CONFIDENCE than signed Notes (source is patient or outside provider, not attested by this clinician). Brief output should still source-pill them but use language like "per outside provider note dated YYYY-MM-DD" instead of "Last visit X said".

## UI

### Patient chart — new "Prior context" section (between "Episodes of care" and "Visit history")

```
┌─ Prior context ─────────────────────────────────────────────────┐
│  External records added by the care team. Reference only —     │
│  not part of any visit note.                  [+ Add prior context] │
│                                                                  │
│  2026-04-12 · OUTSIDE_PROVIDER · "Dr. Smith referral"          │
│      Audio + transcript · added by clinician@demo.local 5/14  → │
│                                                                  │
│  2026-03-20 · PATIENT_SUPPLIED · audio                          │
│      Transcribing… (queued 5/18 09:23)                          │
│                                                                  │
│  2026-03-10 · CLINICIAN_NOTES · paste                           │
│      Transcript only · added by you 5/12                      → │
└──────────────────────────────────────────────────────────────────┘
```

### "Add prior context" dialog (modal)

Tabbed: **Paste transcript** | **Upload audio**

Common fields (both tabs):
- **Date of underlying event** (date picker, max=today)
- **Source** (select: Patient-supplied / Outside provider / Earlier undocumented / Clinician's notes / Other)
- **Source label (optional)** (text, e.g., "Dr. Smith referral letter")
- **Tie to active episode (optional)** (select among patient's episodes, with "None" default)

Paste tab: large textarea, char counter (max 200 KB).
Upload tab: file input (.wav / .mp3 / .m4a, max 200 MB), shows file size + name once selected.

Submit → POST → on success, modal closes, the new entry appears in the section. If audio mode, shows "Transcribing…" status with a refresh hint.

### Detail view (clicking → on a row opens a side sheet)

- Header: date, source, source label, added-by, added-at
- Status badge
- Audio player (if has-audio + READY)
- Transcript (diarized rendering if structured, else plain monospace)
- "Copy transcript" button

## Audit additions

Add to `src/lib/audit/actions.ts`:
- `EXTERNAL_CONTEXT_ADDED`
- `EXTERNAL_CONTEXT_VIEWED`
- `EXTERNAL_CONTEXT_TRANSCRIPTION_COMPLETED`
- `EXTERNAL_CONTEXT_TRANSCRIPTION_FAILED`

## Verification

- [ ] Migration applies clean against current main HEAD
- [ ] `npx prisma db seed` doesn't break (no seed changes needed)
- [ ] CI green (lint + typecheck + test + build)
- [ ] Browser flow: add paste-mode ExternalContext → appears in list → click → see full transcript
- [ ] Browser flow: add audio-mode → "Transcribing…" badge → background worker processes → status flips to READY
- [ ] Brief for a patient with both signed Notes AND ExternalContext shows both in the prior-context section with distinct provenance
- [ ] Audit log shows the 4 new action types when triggered

## Out of scope (v2 or later)

- Soft delete + restore
- ExternalContext from FHIR (different flow — Unit 21+ handles FHIR pull)
- Patient-portal-uploaded audio (different auth scope)
- ICD/CPT extraction from ExternalContext
- Quoting from ExternalContext inside the live note as "patient previously reported X" (would require a copy/paste UX, plus attribution)
- Multi-language transcription
- OCR of uploaded PDFs / images of paper referrals
