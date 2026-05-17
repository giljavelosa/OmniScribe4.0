# Build Plan

> The ordered list of every unit needed to ship OmniScribe v1, then the staged copilot / EHR / telehealth waves that follow. Read top-to-bottom — units are in build order. Dependencies are explicit.

## Conventions

- **Status**: `planned` (default — not started), `in-progress`, `complete`. Update `progress-tracker.md` AND this file when units transition.
- **Wave**: foundation → copilot+commercial → UX maturity → telehealth → FHIR → copilot maturity → platform.
- **Spec file**: present for units 01–08 (foundational). Units 09+ get spec'd just-in-time using the same 5-section template (Goal / Design / Implementation / Dependencies / Verify when done).

---

## Wave 0 — Foundation (units 01–05)

The clinical workflow that turns OmniScribe from "vapor" into "a real product." Get these right; everything else depends on them.

| # | Name | Builds | Depends on | Spec |
|---|---|---|---|---|
| 01 | **Foundation auth & tenancy** | Org / Site / Room / OrgUser / Seat / Invite / User / UserSession / PractitionerProfile + BAA fields on Organization; NextAuth v5 + MFA TOTP + password reset + admin-initiated MFA reset; `requireFeatureAccess` middleware; PHI scoping helpers (`phi-access.ts`); seed with `admin@demo.local` + `clinician@demo.local` + at least one PLATFORM_OWNER | — | [`01-foundation-auth-tenant.md`](01-foundation-auth-tenant.md) |
| 02 | **Patient & schedule core** | Patient + PatientAddress + PatientCoverage + PatientEmergencyContact + PatientGuarantor + PatientConsent + PatientCommunicationPreference; Encounter + Schedule (`VisitType`, `EncounterStatus`); Department + PatientDepartmentEnrollment + PatientDepartmentIntake; EpisodeOfCare + EpisodeGoal + GoalProgressEntry; multi-division model | 01 | [`02-patient-and-schedule.md`](02-patient-and-schedule.md) |
| 03 | **Capture & recording** | Browser AudioWorklet (PCM Int16 @ 16kHz mono); `/api/notes/[id]/realtime-key` ephemeral key mint; capture page (Desktop + Mobile layouts) with correct button polarity + single recording status source + AudioLevelBars + AlertDialog leave-confirm; upload + paste modes; refactored modular components (NO 2,000-line monolith) | 01, 02 | [`03-capture-recording.md`](03-capture-recording.md) |
| 04 | **Transcription pipeline** | `/api/notes/[id]/complete-stream`; S3 upload with lifecycle; transcription worker (Soniox finalize OR Soniox batch for uploaded); transcript cleaning + speaker labeling; voice-id worker fan-out; status transitions; SSE status stream `/api/notes/[id]/stream?include=status` | 03 | [`04-transcription-pipeline.md`](04-transcription-pipeline.md) |
| 05 | **Note generation & sign** | LLM abstraction (Bedrock Sonnet 4.5 + Haiku 4.5 fallback; PHI guard); division-aware master prompts (medical/BH/rehab); section-by-section generation with `inferenceLog._sectionStatus`; SSE section progress stream; review UI with editing + `<SectionProgressStrip>` + readiness panel; sign with MFA re-verify + `finalJson` freeze + `note-brief` enqueue + `post-sign-artifacts` enqueue (patient instructions + referral letters as `NoteArtifact` records) | 04 | [`05-note-generation-and-sign.md`](05-note-generation-and-sign.md) |

**End of Wave 0**: A clinician can record a 5-minute visit and have a SIGNED, immutable note 5 minutes later. The product is technically a working medical AI scribe.

---

## Wave 1 — Copilot foundation + commercial-ready (units 06–09)

Layer in the copilot identity and close commercial-readiness gates.

| # | Name | Builds | Depends on | Spec |
|---|---|---|---|---|
| 06 | **Prior-context brief** | `NoteBrief` schema (1:1 with signed Note); brief generator service (`BriefGenerator`; Bedrock Sonnet 4.5; Haiku fallback; temp 0; ~$0.05/brief); precompute on sign via `note-brief` worker; brief UI components (`BriefCard`, `BriefHeader`, `TrajectoryTable`, `FollowUpPreviewList`, `GoalsSnapshot`, `WatchList`, `BriefFooter`); `FollowUp` lifecycle (OPEN/MET/CARRIED/DROPPED/CLOSED_BY_DISCHARGE); `FollowupExtractor` service; sign-time sweep modal | 05 | [`06-prior-context-brief.md`](06-prior-context-brief.md) |
| 07 | **Encounter copilot — Watch v0** | Always-available `<CopilotBeacon>` (Sparkles, bottom-right) on prepare + capture + review surfaces; `<CopilotSheet>` with v0 placeholder; `<OpenFollowUpsCard>` and `<PlanForTodayCard>` consuming brief + FollowUp data; source pills on every fact (Rule 20); explicit-tap dismissal only; audit log every card render and beacon open | 06 | [`07-encounter-copilot-watch-v0.md`](07-encounter-copilot-watch-v0.md) |
| 08 | **Admin & compliance ready** | `Organization.baaExecutedAt / baaVersion / baaCountersignedBy / complianceProfile` schema (already in Unit 01); admin UI for BAA management; admin-initiated MFA reset (audited); admin-initiated password reset; Sites CRUD; Rooms CRUD; customer self-onboarding wizard (`/onboarding/[token]` — welcome → password → MFA → done); invite expiration enforcement (return 410 Gone); audit log enrichment (before/after state on sign, BAA acceptance, role changes, sensitive-tier changes) | 01 | [`08-admin-and-compliance-ready.md`](08-admin-and-compliance-ready.md) |
| 09 | **Owner console v1** | `/owner/orgs` cross-org list with BAA-status column; `/owner/orgs/new` provisioning form (BAA fields required); `/owner/orgs/[id]` org detail with BAA UI, seat allocation, subscription view, impersonation (audited); `/owner/users` cross-org user search; `/owner/audit` cross-org audit (PHI-free); `/owner/announcements` system announcements; `/owner/health` system health (DB/Redis/S3/Bedrock/Soniox latency + queue depths) | 01, 08 | (write spec on start; template from 01–08) |

**End of Wave 1**: First paying customer can be provisioned, onboarded, recorded, signed, paid. Minimum credible v1. ~9–12 weeks total elapsed time for a 2–4 engineer team.

---

## Wave 2 — UX maturity (units 10–14)

Polish the clinical surfaces. Bring the product from "works" to "trusted daily."

| # | Name | Builds | Depends on | Spec |
|---|---|---|---|---|
| 10 | **Section-regenerate UX maturity** | Final polish of `<SectionProgressStrip>` + `<SectionProgressCell>` + `<SectionRegenerateConfirmDialog>`; per-section diff view ("show me what changed"); failure-recovery UX with retry; SSE reconnect handling; observability around regeneration latency + failure rate | 05 | (write spec on start; see `references/section-progress-spec.md`) |
| 11 | **Episode of care maturity** | Recert cycles (90-day default, customizable); visit counters + auth limits; goal-progression UX (clinician marks a goal as Met / Modified / Discontinued); episode close + reopen workflows; per-episode division override surfaced cleanly | 02 | (write spec on start) |
| 12 | **Patient detail redesign** | `/patients/[id]` full implementation per [`references/patient-detail-spec.md`](../../references/patient-detail-spec.md): identity header (inline editable demographics), snapshot strip (division-keyed measure cards with trend arrows + source dots), visit history (2-line assessment per row), reference cards (active goals / watch / open follow-ups), recert/reopen `AlertDialog` replacing black-overlay pattern, `SnapshotOverride` table for clinician-edited measures (always reversible) | 06, 11 | (write spec on start; see [`references/patient-detail-ui-spec.md`](../../references/patient-detail-ui-spec.md)) |
| 13 | **Templates editor maturity** | Template authoring with live section preview (graduates from raw JSON editor); visibility (PERSONAL/TEAM/PUBLIC) UX; specialty/org defaults rule editor; copy/clone with version history; sensitivityDefault picker | 05 | (write spec on start) |
| 14 | **Review screen polish** | Flag review panel (compliance flags grouped by severity); readiness gates UI (required-section completeness); AI compliance suggestions with severity hierarchy; collapsible accordions with smooth animation; "diff against last regenerate" view; per-section Copy-to-clipboard for EHR-paste workflows | 10 | (write spec on start) |

---

## Wave 3 — Telehealth (units 15–18)

Per [`references/telehealth-architecture-spec.md`](../../references/telehealth-architecture-spec.md). Four sprints, Daily.co recommended. Audio integrates with existing transcription pipeline; **video is NOT an artifact of record** — the note is.

| # | Name | Builds | Depends on | Spec |
|---|---|---|---|---|
| 15 | **Telehealth infra + patient auth** | `TelehealthSession` table + status enum; magic-link generator (22-char token + DOB verify; 24h + 2h grace); patient waiting room (`/telehealth/waiting/[scheduleId]`); `/v/[magicToken]` identity verification page; Daily.co room create/destroy on session lifecycle; patient consent capture | 02 | (write spec on start; see `references/telehealth-architecture-spec.md` Phase 1) |
| 16 | **Telehealth audio integration** | Browser-side `MediaStreamTrackProcessor` audio tap; pipe WebRTC audio through existing Soniox real-time pipeline (same ephemeral key mint, same WS); diarization across two browser sources (clinician + patient) | 04, 15 | (Phase 2) |
| 17 | **Telehealth capture flow integration** | Live note generation during the call (same `ai-generation` queue); section progress over SSE while video plays; clinician handoff to `/review` when call ends; clinician view in `/telehealth/room/[scheduleId]` integrates capture controls + brief + setup | 05, 16 | (Phase 3) |
| 18 | **Telehealth polish** | Pre-call diagnostic (mic/cam/network); reconnection handling; voice-ID post-call match; call-quality metrics; rejoin-after-disconnect flow within the active window | 17 | (Phase 4) |

---

## Wave 4 — FHIR / EHR (units 19–24)

Per [`references/fhir-integration-spec.md`](../../references/fhir-integration-spec.md). Six phases (F1–F6). 3–6 months realistic. NextGen first, Epic + Cerner later. **v1 is read-only, provider-launched.**

| # | Name | Builds | Depends on | Spec |
|---|---|---|---|---|
| 19 | **F1 — SMART OAuth2 auth foundations** | SMART on FHIR OAuth2 flow; encrypted token storage; refresh handling; NextGen sandbox config; per-clinician vs per-org launch model (decided in open question 5) | 01 | (Wave 4 spec on start; see `references/fhir-integration-spec.md` F1) |
| 20 | **F2 — Patient identity matching** | Bidirectional Patient ↔ FHIR Patient links; identity confirmation UI (clinician confirms before linking); audit on every link/unlink | 02, 19 | (F2) |
| 21 | **F3 — Resource sync worker + cache** | `FhirCachedResource` table; `fhir-sync` BullMQ queue (rate-limited); refresh policy (on demand + 7d staleness); resource types: Patient, Condition, Medication, Observation, AllergyIntolerance, Procedure, DiagnosticReport, CarePlan, Goal | 20 | (F3) |
| 22 | **F4 — Brief generator FHIR integration** | Extend `BriefBuilderInput` with optional `<external_ehr_context>` block; map FHIR resources → brief fields; update prompt; provenance per field (which FHIR resource, when fetched) | 06, 21 | (F4) |
| 23 | **F5 — Provenance UI** | Source pills on brief fields (tap → FHIR drawer); staleness chips (>7d warning, >30d stale); drawer shows raw FHIR resource for auditor inspection | 22 | (F5) |
| 24 | **F6 — Multi-EHR adapter** | Generalize NextGen adapter to Epic + Cerner; per-org EHR config; multi-EHR org support (defer to later if low demand) | 23 | (F6) |

---

## Wave 5 — Copilot maturity (units 25–31)

Per [`references/encounter-copilot-spec.md`](../../references/encounter-copilot-spec.md) Phases 52–60. Each unit adds a copilot capability without changing the chat surface.

| # | Name | Builds | Depends on | Spec |
|---|---|---|---|---|
| 25 | **Watch v1 — FHIR-backed cards** | Meds card, labs card, vitals card, allergies card — all from `FhirCachedResource`; Rule 20 enforced (verifiedAt only); source pills mandatory | 07, 21 | (spec on start; see `references/encounter-copilot-spec.md` Phase 52) |
| 26 | **Watch v2 — live-transcript triggers** | Copilot listens to live transcript via subscription; surfaces relevant prior-context card when topic matches; card raised, not pre-rendered | 25 | (Phase 52) |
| 27 | **Ask mode v1 — agent loop** | `<CopilotSheet>` graduates from placeholder to full chat surface; multi-turn agent loop with tool calls; tools = `lookupSignedNote`, `lookupFollowUp`, `lookupEpisodeGoals`, `lookupPatientDemographics`; mandatory source pills; chat history per-session | 07 | (Phase 53) |
| 28 | **Ask mode v2 — FHIR tools** | Add tools: `lookupFhirCondition`, `lookupFhirMedication`, `lookupFhirObservation`, `lookupFhirAllergy`, `lookupFhirCarePlan`; rate-limit handling | 27, 21 | (Phase 53) |
| 29 | **Research mode** | Separate tool registry: `searchPMC`, `searchAttestedLiterature`; research-mode UI clearly distinct from chart mode; never co-mingled; per-message provenance | 27 | (Phase 54) |
| 30 | **Action tools — drafts** | `draftPatientMessage`, `proposeFollowUpCadence`, `suggestReferralLetterContent`; always require explicit clinician initiation + confirmation; never autonomous; audit on draft + confirm separately | 27 | (Phase 55) |
| 31 | **Clinical reasoning chains** | Multi-step agentic reasoning within Rule 20 + Rule 23 bounds; copilot shows chain of thought; clinician can pause/redirect; never makes a clinical recommendation in card form | 27, 29, 30 | (Phase 56–60) |

---

## Wave 6 — Platform + polish (units 32–37)

| # | Name | Builds | Depends on | Spec |
|---|---|---|---|---|
| 32 | **Owner console maturity** | Cross-org provisioning depth; BAA acceptance workflow; subscription overrides; impersonation with audit; transactions view; usage rollups | 09 | (spec on start) |
| 33 | **Ops console** | Platform staff dashboards; system announcements (already in Unit 09); deeper health monitoring; cross-org audit search | 09 | (spec on start) |
| 34 | **Audit log enrichment depth** | Before/after state capture on all important mutations (beyond what Unit 08 covers); per-org audit search + export; retention policies | 08 | (spec on start) |
| 35 | **Per-org LLM cost rollup** | Track token usage per org per day; expose in owner console; alert thresholds; cost-per-note metric | 32 | (spec on start) |
| 36 | **Mobile / PWA polish** | next-pwa offline UX; iPad-specific layout audit; touch-target audit; reduced-motion audit | 03 | (spec on start) |
| 37 | **Public signup + self-serve org creation** | Public landing → signup → org provisioning; account lockout fields on User; invite-token expiration enforcement; rate-limit; CAPTCHA | 08 | (spec on start; gated on open question 8) |

---

## Notes for the Implementing Team

- **Units 01–08 are spec'd in this folder.** Build them in order. Verify each before moving on. The eight foundational specs are where most of the documentation lift is — units 09+ are smaller-scope and the team writes the spec just-in-time.
- **Wave 1 = minimum credible v1.** Ship Wave 0 + Wave 1 before chasing any later wave. Don't parallelize across waves; do parallelize within a wave.
- **Wave 4 (FHIR) is the long pole.** Start F1 (Unit 19) as soon as runway allows — it doesn't block any scribe features but enables every downstream copilot intelligence.
- **Each new spec file** follows the methodology template (Goal / Design / Implementation / Dependencies / Verify when done). See [`01-foundation-auth-tenant.md`](01-foundation-auth-tenant.md) for the canonical shape.

## How to extend this build plan

When you complete a unit, mark it `complete` here (with date) AND update `context/progress-tracker.md`. When you decide a new unit is needed, append it with the next available number and a brief; write the full spec when you start it.
