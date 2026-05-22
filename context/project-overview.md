# OmniScribe — Project Overview

## What it is, in one paragraph

OmniScribe is a HIPAA-grade medical AI scribe with an integrated agentic clinical copilot, built for Medical, Rehabilitation, and Behavioral Health clinicians. It listens to clinical encounters in real time (in-person or telehealth), produces a structured, division-appropriate clinical note for the clinician to review and sign, and surfaces just-in-time clinical context during the visit — a 30-second pre-visit brief, open follow-ups from prior visits, FHIR-backed patient data, and an always-available copilot the clinician can ask grounded questions. It replaces ~15–25 minutes of EHR scouring + after-hours charting per returning patient with a 30-second pre-visit read and a near-real-time draft note that survives Medicare audit, three-lens compliance review (Clinician / Medicare Compliance Officer / Insurance Auditor), and the clinician's own clinical judgment.

Read [`journeys/02-typical-visit.md`](../journeys/02-typical-visit.md) for the heart of the product in action.

## Who uses it

Three primary personas. Each maps to a `Division`:

- **Medical clinicians** (MD/DO, NP, PA) — primary care, family medicine, internal medicine, specialty clinics. Division `MEDICAL`.
- **Rehabilitation clinicians** (PT, OT, SLP) — outpatient rehab clinics, hospital-based therapy. Division `REHAB`.
- **Behavioral Health clinicians** (psychiatrists, psychologists, LCSWs, counselors) — outpatient BH, IOP, integrated-care BH. Division `BEHAVIORAL_HEALTH`. Compliance profile defaults to `BH_42CFR2`.

Plus two operator personas:

- **Org admin** (`OrgRole.ORG_ADMIN` for the org's owner, `OrgRole.SITE_ADMIN` for site-scoped admins) — manages sites, rooms, users, seats, templates, billing.
- **Platform owner** (your team) — provisions customer orgs, manages BAA, allocates seats, supports.

## Goals

Measurable, verifiable, fixed for v1:

1. **Encounter → signed note in ≤ 5 minutes of clinician time** per typical 15-minute visit (review + light edit + sign). Excludes LLM wall-clock generation time, which is largely concurrent with the encounter.
2. **30-second pre-visit chart read** — a structured prior-context brief that a clinician can scan in under 30 seconds and walk into the room with what they need to know.
3. **Zero PHI in audit metadata, 100% of PHI access logged** — every read/write/print/export of patient or note data lands in `AuditLog` with PHI-free metadata. Verifiable by code review and audit-log inspection.
4. **≥ 95% diarization accuracy on 2-speaker encounters in quiet rooms** — measured per-utterance, clinician-vs-patient assignment correct under Soniox speaker diarization + TitaNet voice-ID.
5. **Three-lens passing-rate of 100% on shipped features** — every merged PR passes Clinician / Medicare Compliance Officer / Insurance Auditor lenses.
6. **Single Redis fleet, single BullMQ worker fleet per environment** — quota-safe and recovery-safe.
7. **Signed-note `finalJson` immutability — 100%** — no code path mutates a signed note's `finalJson`; addenda are distinct records.
8. **Copilot answers are source-attested** — every fact a copilot card or chat answer surfaces traces to a signed note, clinician-confirmed follow-up, or verified FHIR resource. No drafts. No inferences beyond source.

## The core user flow (in one screen-by-screen line)

`/login` → `/mfa-challenge` → `/home` (pick patient) → `/prepare/[noteId]` (read brief, confirm setup) → `/capture/[noteId]` (record, mid-visit start drafting) → `/processing/[noteId]` (transient) → `/review/[noteId]` (edit + regenerate sections + close follow-ups) → `/sign/[noteId]` (MFA re-verify, sign) → `/home` (next patient).

Detail in [`journeys/02-typical-visit.md`](../journeys/02-typical-visit.md). Variants in journeys 03–06.

## Features

### Pillar 1 — Capture & Transcription

- **Live recording (LIVE mode)** — browser MediaRecorder + AudioWorklet emitting PCM Int16 LE @ 16 kHz mono; WebSocket directly to Soniox using a 60-second ephemeral key.
- **Speaker diarization** — Soniox real-time `enable_speaker_diarization: true`; `audio_format: "pcm_s16le"`. Diarization is required, not optional.
- **Voice-ID enrollment** — clinicians opt in to record a 30–60 s sample at `/profile/voice`; sample becomes a TitaNet 192-dim embedding stored as pgvector. Explicit BIPA consent versioning required. Post-call voice-id worker matches transcript speakers to enrolled profiles.
- **Upload mode (UPLOADED)** — clinician uploads a pre-recorded audio file (any source); same downstream pipeline (Soniox batch + diarization).
- **Paste mode (PASTED)** — clinician pastes existing text (e.g., dictation); skips transcription, goes straight to note generation.
- **Audio retention** — S3 storage with lifecycle (90 d → Glacier Instant → 365 d → Deep Archive → 2555 d / 7 years HIPAA → expire). Audio files are NEVER hard-deleted; soft-delete on `AudioSegment` only.
- **Pre-call telehealth checks** — mic / camera / network quality / browser support — before joining the patient.

### Pillar 2 — Note Generation

- **Division-aware master prompts** — `note-medical-prompt.ts`, `note-behavioral-health-prompt.ts`, `note-rehab-master-prompt.ts`. Each produces structured JSON keyed to the chosen template's section schema.
- **Section-level regenerate** — clinician can regenerate any single section without losing edits in other sections. Same BullMQ queue as full generation (rule 18), discriminated by `job.data.type`. Edited sections prompt for confirmation before overwrite.
- **Templates** — `NoteTemplate` library with CMS-default presets, org-custom templates, visibility (`PERSONAL` / `TEAM` / `PUBLIC`), division-scoped, specialty-tagged.
- **Note styles** — `NARRATIVE` / `HYBRID` / `HYBRID_BULLET` / `STRUCTURED`. Per-user default; per-note override.
- **Section progress UI** — real-time strip showing `empty / generating / populated / edited / failed` per section, driven by SSE events from `Note.inferenceLog._sectionStatus`.
- **Post-sign artifacts** — patient instructions, referral letters, generated by separate LLM calls after sign. Rendered as distinct `NoteArtifact` records, NOT edits to the immutable `finalJson`.
- **Backfilled notes** — `Note.backfilledAt` + `backfillReason` fields capture retroactive documentation; flagged for compliance review.

### Pillar 3 — Agentic Clinical Copilot

Two modes (per [`references/encounter-copilot-spec.md`](../references/encounter-copilot-spec.md)). **Wave 5** (Units 25–31) shipped capabilities; **Wave 8** (Units 42–47) ports Miss Cleo persona, streaming, and persistence — see [`context/specs/00-build-plan.md`](specs/00-build-plan.md).

- **Watch (proactive)** — context cards surfaced pre-encounter and during capture, without the clinician asking:
  - **v0**: open follow-ups from prior visit, "plan said for today" cards
  - **v1**: FHIR-backed cards — meds, labs, vitals, allergies (after FHIR Wave 4)
  - **v2**: live-transcript triggers — copilot raises a card when transcript mentions a topic with relevant prior context
- **Ask (reactive)** — always-available beacon (Sparkles icon, bottom-right) → chat sheet:
  - **v0**: beacon-only placeholder (sheet is empty)
  - **v1**: multi-turn agent loop with tool calls; tools = signed-note lookup, follow-up lookup, FHIR resource lookup, episode-goals lookup
  - **v2**: research mode (separate tool registry; PubMed Central + clinician-attested literature)
  - **v3**: action tools (draft patient message, propose follow-up cadence, suggest referral content) — always require explicit clinician initiation + confirmation

**Copilot invariants** (Rules 20 + 23, non-negotiable):
- Reads only `Note.status ∈ {SIGNED, TRANSFERRED}`, clinician-confirmed `FollowUp` rows, and verified `FhirCachedResource`. Never drafts. Never inferences beyond source.
- Surfaces DATA only — never a clinical recommendation in card form. Action tools require explicit clinician initiation + confirmation.
- Every tool call logged in `AuditLog` with PHI-free metadata.

Read [`journeys/05-copilot-ask-mode.md`](../journeys/05-copilot-ask-mode.md) for an Ask-mode example.

### Cross-cutting features

- **Patient management** — demographics (name, MRN, DOB, sex SAAB), insurance coverage, addresses, emergency contacts, guarantors, consents, communication preferences. Division-scoped, site-scoped.
- **Episode of care** — `EpisodeOfCare` + `EpisodeGoal` (STG/LTG, baseline/target/current, status) + `GoalProgressEntry` (per-visit progression trail). The data model supports all three divisions; the dedicated Episodes UI tab is **scoped to REHAB patients only** for now (clinically: recert cycles, visit authorization, and STG/LTG goals are Medicare therapy plan-of-care constructs). Medical and BH episodes continue to feed AI prompts, the prior-context brief, and the Safety Band — they are not surfaced in a tab until a future wave.
- **Follow-up lifecycle** — `FollowUp` rows extracted from plan sections at sign-time. Statuses: `OPEN` / `MET` / `CARRIED` / `DROPPED` / `CLOSED_BY_DISCHARGE`. Sign-time sweep modal forces a decision on every open item before allowing sign.
- **Patient detail surface** — identity header (inline editable), division-keyed snapshot strip with trend arrows + source dots (rehab: pain/ROM/strength/gait/outcome-tool; medical: vitals; BH: PHQ-9/GAD-7), visit history with 2-line assessment per row, reference cards (active goals / watch / open follow-ups).
- **Schedule** — appointment calendar with visit type (`IN_PERSON` / `TELEHEALTH`), duration, status. Encounter auto-created on schedule start.
- **Org / Site / Room admin** — multi-site organizations, room registry, department model (org-wide, optionally per site), division assignment per org with per-episode override.
- **Templates admin** — preset CMS templates + custom templates; section schema editor; specialty/division defaults; visibility tiers.
- **Voice profile admin** — enrollment, BIPA consent versioning, soft-delete + 30-day hard-delete grace.
- **Audit & compliance** — `AuditLog` (org/user/patient/note scope) + `PlatformAuditLog` (cross-org owner scope). Append-only. PHI-free metadata. Reconstructable state on important mutations (sign, BAA acceptance, MFA reset, sensitive-tier change).
- **Billing & seats** — Stripe integration, seat tiers (`SOLO` / `TEAM` / `ENTERPRISE`), per-user seat assignment, expirations, transfers. **Canonical wave: Wave 7** (units §01, §09, 38–41 in [`context/specs/00-build-plan.md`](specs/00-build-plan.md)).
- **Telehealth** — Daily.co video room, magic-link patient join with DOB verification, browser-side audio tap integrating with the same transcription pipeline. Audio processed + audio discarded after note signing; the *note* is the artifact of record, NOT the video.
- **EHR / FHIR integration** (Wave 4) — SMART-on-FHIR OAuth2, cached resource reads via worker, brief-generator enrichment, provenance UI with source pills + staleness chips. NextGen first, then Epic + Cerner. v1 is provider-launched, **read-only** — no write-back.
- **Owner & Ops consoles** — platform-owner cross-org visibility, BAA management, ops audit + announcements + system health.

## In Scope (v1 — first paying customer)

- Sign-in, MFA TOTP, password reset, MFA reset (admin-initiated, audited).
- Multi-tenant org/site/room with BAA fields on `Organization` (BH compliance profile = `BH_42CFR2`).
- Patient + Encounter + Schedule + Episode of Care + Goal + Follow-up models.
- Live + Upload + Paste capture modes; Soniox real-time transcription with diarization; voice-ID enrollment + matching.
- Division-aware note generation (Medical, Rehab, BH) via Bedrock Claude Sonnet 4.5; section-level regenerate; section progress UI; sign workflow with attestation + finalJson immutability.
- Prior-context brief precomputed on sign; UI on prepare + capture + sign-sweep; follow-up lifecycle.
- Patient detail division-keyed snapshot.
- Audit logging end-to-end; three-lens evaluation as a merge gate.
- Encounter copilot Watch v0 (open-follow-ups + plan-for-today cards) + beacon placeholder (Ask mode placeholder shows "coming soon").
- Admin: users, seats, billing, templates, voice profiles, announcements, audit, org settings; Sites + Rooms CRUD; MFA + password reset surfaces; customer self-onboarding wizard.
- Owner console: org provisioning + BAA tracking; usage; subscriptions; templates; health; audit.

## Out of Scope (v1)

- **EHR write-back / order entry** — FHIR is read-only in v1. Deferred.
- **CDS Hooks** — clinical decision support hooks; explicitly out (would conflict with Rule 23).
- **US Core formal certification** — targeted, not required.
- **Patient-mediated FHIR launch** — v1 is provider-launched only.
- **Multi-EHR per single org** — v1 assumes one org → one EHR; multi-EHR adapter is later wave.
- **Native mobile app** — PWA only (`next-pwa` configured); native iOS/Android deferred.
- **Video as artifact of record** — only audio is processed; audio is retained per S3 lifecycle; video is discarded after the call.
- **Real-time co-editing of notes** — single-clinician edits only; no multi-cursor.
- **Patient portal / patient-facing app** — v1 is clinician-facing only; patient touchpoints limited to magic-link telehealth.
- **In-app clinical billing** — Stripe handles subscription billing; CPT capture / claim generation deferred.
- **WebAuthn / hardware-key MFA** — TOTP only in v1.
- **Public signup / self-serve org creation** — v1 onboarding is invite-only via platform-owner provisioning.
- **Copilot action tools that auto-mutate clinical records** — every action requires clinician initiation + confirmation; no autonomous writes.
- **Cross-patient copilot queries** — copilot is patient-scoped when invoked from a clinical surface.

## Success Criteria (v1 ship)

Verifiable when all of the following are true on production with a real customer:

1. **Onboarding** — a platform owner can provision a new Organization with BAA fields, invite a first ORG_ADMIN, and that admin can accept the invite, set a password, and enroll TOTP MFA without leaving the product. (Journey 07 + 01)
2. **Auth resilience** — a clinician can complete password reset and MFA reset via in-product workflows; admin-initiated MFA reset is audited.
3. **End-to-end recording → signed note** — a signed-in clinician can pick a scheduled patient, record a live 5-minute encounter, see live diarized transcript + section progress strip, transition to `/review`, edit one section + regenerate another, sweep open follow-ups, and sign the note in ≤ 5 minutes of clinician interaction time. (Journey 02)
4. **`finalJson` immutability verified** — automated test asserts that no code path mutates `Note.finalJson` after `Note.status === SIGNED`.
5. **Prior-context brief works on a returning patient** — for a patient with ≥ 1 prior signed note, opening `/prepare/[noteId]` renders a structured brief in < 1 second; brief content traces 100% to source notes. (Journey 03)
6. **Copilot Watch v0** — open-follow-ups + plan-for-today cards render on `/prepare` and `/capture` for any returning patient, with source pills on every fact.
7. **Audit completeness** — for any patient, the platform-owner audit view shows every PHI access by every staff/clinician/owner in the last 30 days, with no PHI in the metadata column.
8. **Single-fleet worker correctness** — one BullMQ worker fleet per Redis per environment.
9. **PHI provider allowlist enforced** — `assertProviderAllowedForPHI` blocks any non-attested LLM provider at runtime; only Bedrock + self-hosted vLLM may receive PHI; `SONIOX_BAA_ON_FILE=true` enforced in non-dev.
10. **Three-lens evaluation on every merged PR** — PR template requires Clinician / Medicare Compliance Officer / Insurance Auditor review notes.

## Compliance Posture

- **HIPAA** — BAA required from every Subprocessor (AWS, Soniox); enforced operationally + via `SONIOX_BAA_ON_FILE=true` runtime check; PHI never in audit metadata; reads + writes audited; 7-year default retention on `AuditLog` + audio.
- **BIPA (voice biometric)** — explicit consent versioning required before TitaNet enrollment; soft-delete + 30-day grace; clinician can revoke + re-enroll.
- **42 CFR Part 2** — `NoteSensitivityLevel.BEHAVIORAL_HEALTH` (and equivalent intake fields) gated to restricted access roles; sensitivity tier propagates with the data; BH orgs default to `complianceProfile: BH_42CFR2`.
- **Three-lens evaluation** — every feature evaluated through Clinician / Medicare Compliance Officer / Insurance Auditor before merge. Documented in PR.
- **Rule-20 attested-source rule** — copilot surfaces + answers reference only SIGNED/TRANSFERRED notes, clinician-confirmed `FollowUp` rows, and verified `FhirCachedResource`. Never drafts. Never inferences beyond source.

## Strategic Anchors

From [`references/strategic/four-pillars-commercial-charter.md`](../references/strategic/four-pillars-commercial-charter.md), the four commercial pillars:

1. **Trust** — provenance on every fact, immutable signed records, audit-first design, BAA-only data path.
2. **Diagnosis Support** — copilot surfaces clinically-relevant context; never recommends; supports the clinician's reasoning.
3. **Workflow Integration** — fits into the clinician's existing day; bidirectional EHR (FHIR) read for v1, write-back later.
4. **Clinician Autonomy** — clinician owns every decision; AI proposes, clinician disposes; nothing leaves the system without clinician sign.

## What to read next

- For the experience: [`journeys/02-typical-visit.md`](../journeys/02-typical-visit.md) (the heart) and then journeys 03 (brief), 04 (regenerate), 05 (Ask copilot), 06 (telehealth), 07 (admin onboarding), 08 (templates).
- For the architecture: [`context/architecture.md`](architecture.md).
- For the visual language: [`context/ui-context.md`](ui-context.md).
- For the build sequence: [`context/specs/00-build-plan.md`](specs/00-build-plan.md).
- For copilot depth: [`references/encounter-copilot-spec.md`](../references/encounter-copilot-spec.md).
- For FHIR depth: [`references/fhir-integration-spec.md`](../references/fhir-integration-spec.md).
- For telehealth depth: [`references/telehealth-architecture-spec.md`](../references/telehealth-architecture-spec.md).
