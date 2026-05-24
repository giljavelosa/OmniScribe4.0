# Build Plan

> The ordered list of every unit needed to ship OmniScribe v1, then the staged copilot / EHR / telehealth waves that follow. Read top-to-bottom — units are in build order. Dependencies are explicit.

## Conventions

- **Status**: `planned` (default — not started), `in-progress`, `complete`. Update `progress-tracker.md` AND this file when units transition.
- **Wave**: foundation → copilot foundation → UX maturity → telehealth → FHIR → copilot maturity → platform → billing & subscriptions → **copilot maturity port (Miss Cleo)**.
- **Wave index** (canonical category — unit numbers are build order, not wave number):

  | Wave | Theme | Units |
  |---|---|---|
  | 0 | Foundation (clinical scribe) | 01–05 |
  | 1 | Copilot foundation | 06–09 |
  | 2 | UX maturity | 10–14 |
  | 3 | Telehealth | 15–18 |
  | 4 | FHIR / EHR | 19–24 |
  | 5 | Copilot maturity (capabilities) | 25–31 |
  | 6 | Platform + polish | 32–37 |
  | **7** | **Billing & subscriptions** | **01§, 09§, 38–41** |
  | **8** | **Copilot maturity port (Miss Cleo)** | **42–47** |

  § = prerequisite shipped inside another wave; see Wave 7 table for the canonical billing home.
- **Spec file**: present for units 01–08 (foundational). Units 09+ get spec'd just-in-time using the same 5-section template (Goal / Design / Implementation / Dependencies / Verify when done).

---

## Wave 0 — Foundation (units 01–05)

The clinical workflow that turns OmniScribe from "vapor" into "a real product." Get these right; everything else depends on them.

| # | Name | Builds | Depends on | Spec |
|---|---|---|---|---|
| 01 | **Foundation auth & tenancy** | Org / Site / Room / OrgUser / **Seat (billing foundation — Wave 7 §01)** / Invite / User / UserSession / PractitionerProfile + BAA fields on Organization; NextAuth v5 + MFA TOTP + password reset + admin-initiated MFA reset; `requireFeatureAccess` middleware; PHI scoping helpers (`phi-access.ts`); seed with `admin@demo.local` + `clinician@demo.local` + at least one PLATFORM_OWNER | — | [`01-foundation-auth-tenant.md`](01-foundation-auth-tenant.md) |
| 02 | **Patient & schedule core** | Patient + PatientAddress + PatientCoverage + PatientEmergencyContact + PatientGuarantor + PatientConsent + PatientCommunicationPreference; Encounter + Schedule (`VisitType`, `EncounterStatus`); Department + PatientDepartmentEnrollment + PatientDepartmentIntake; EpisodeOfCare + EpisodeGoal + GoalProgressEntry; multi-division model | 01 | [`02-patient-and-schedule.md`](02-patient-and-schedule.md) |
| 03 | **Capture & recording** | Browser AudioWorklet (PCM Int16 @ 16kHz mono); `/api/notes/[id]/realtime-key` ephemeral key mint; capture page (Desktop + Mobile layouts) with correct button polarity + single recording status source + AudioLevelBars + AlertDialog leave-confirm; upload + paste modes; refactored modular components (NO 2,000-line monolith) | 01, 02 | [`03-capture-recording.md`](03-capture-recording.md) |
| 04 | **Transcription pipeline** | `/api/notes/[id]/complete-stream`; S3 upload with lifecycle; transcription worker (Soniox finalize OR Soniox batch for uploaded); transcript cleaning + speaker labeling; voice-id worker fan-out; status transitions; SSE status stream `/api/notes/[id]/stream?include=status` | 03 | [`04-transcription-pipeline.md`](04-transcription-pipeline.md) |
| 05 | **Note generation & sign** | LLM abstraction (Bedrock Sonnet 4.5 + Haiku 4.5 fallback; PHI guard); division-aware master prompts (medical/BH/rehab); section-by-section generation with `inferenceLog._sectionStatus`; SSE section progress stream; review UI with editing + `<SectionProgressStrip>` + readiness panel; sign with MFA re-verify + `finalJson` freeze + `note-brief` enqueue + `post-sign-artifacts` enqueue (patient instructions + referral letters as `NoteArtifact` records) | 04 | [`05-note-generation-and-sign.md`](05-note-generation-and-sign.md) |

**End of Wave 0**: A clinician can record a 5-minute visit and have a SIGNED, immutable note 5 minutes later. The product is technically a working medical AI scribe.

---

## Wave 1 — Copilot foundation (units 06–09)

Layer in the copilot identity and the owner console. **Billing & subscriptions live in Wave 7** — Unit 09 ships owner-console prerequisites only (seat surfaces + Stripe stub).

| # | Name | Builds | Depends on | Spec |
|---|---|---|---|---|
| 06 | **Prior-context brief** | `NoteBrief` schema (1:1 with signed Note); brief generator service (`BriefGenerator`; Bedrock Sonnet 4.5; Haiku fallback; temp 0; ~$0.05/brief); precompute on sign via `note-brief` worker; brief UI components (`BriefCard`, `BriefHeader`, `TrajectoryTable`, `FollowUpPreviewList`, `GoalsSnapshot`, `WatchList`, `BriefFooter`); `FollowUp` lifecycle (OPEN/MET/CARRIED/DROPPED/CLOSED_BY_DISCHARGE); `FollowupExtractor` service; sign-time sweep modal | 05 | [`06-prior-context-brief.md`](06-prior-context-brief.md) |
| 07 | **Encounter copilot — Watch v0** | Always-available `<CopilotBeacon>` (Sparkles, bottom-right) on prepare + capture + review surfaces; `<CopilotSheet>` with v0 placeholder; `<OpenFollowUpsCard>` and `<PlanForTodayCard>` consuming brief + FollowUp data; source pills on every fact (Rule 20); explicit-tap dismissal only; audit log every card render and beacon open | 06 | [`07-encounter-copilot-watch-v0.md`](07-encounter-copilot-watch-v0.md) |
| 08 | **Admin & compliance ready** | `Organization.baaExecutedAt / baaVersion / baaCountersignedBy / complianceProfile` schema (already in Unit 01); admin UI for BAA management; admin-initiated MFA reset (audited); admin-initiated password reset; Sites CRUD; Rooms CRUD; customer self-onboarding wizard (`/onboarding/[token]` — welcome → password → MFA → done); invite expiration enforcement (return 410 Gone); audit log enrichment (before/after state on sign, BAA acceptance, role changes, sensitive-tier changes) | 01 | [`08-admin-and-compliance-ready.md`](08-admin-and-compliance-ready.md) |
| 09 | **Owner console v1** | `/owner/orgs` cross-org list with BAA-status column; `/owner/orgs/new` provisioning form (BAA fields required); `/owner/orgs/[id]` org detail with BAA UI, **seat surfaces + Stripe stub (Wave 7 §09)**; `/owner/users` cross-org user search; `/owner/audit` cross-org audit (PHI-free); `/owner/announcements` system announcements; `/owner/health` system health (DB/Redis/S3/Bedrock/Soniox latency + queue depths). Impersonation deferred to Unit 32. | 01, 08 | [`09-owner-console-v1.md`](09-owner-console-v1.md) |

**End of Wave 1**: First paying customer can be provisioned, onboarded, recorded, and signed. Minimum credible clinical v1. Commercial billing completes in **Wave 7**. ~9–12 weeks total elapsed time for a 2–4 engineer team.

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

Per [`references/encounter-copilot-spec.md`](../../references/encounter-copilot-spec.md) Phases 52–60. Each unit adds a copilot capability without changing the chat surface. **UX/persona/streaming maturity continues in Wave 8 (Miss Cleo port).**

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
| 32 | **Owner console maturity** | Cross-org provisioning depth; BAA acceptance workflow; impersonation with audit; transactions view; usage rollups. **Subscription plan metadata → Wave 7 Unit 39.** | 09 | [`32-owner-console-maturity.md`](32-owner-console-maturity.md) |
| 33 | **Ops console** | Platform staff dashboards; system announcements (already in Unit 09); deeper health monitoring; cross-org audit search | 09 | (spec on start) |
| 34 | **Audit log enrichment depth** | Before/after state capture on all important mutations (beyond what Unit 08 covers); per-org audit search + export; retention policies | 08 | (spec on start) |
| 35 | **Per-org LLM cost rollup** | Track token usage per org per day; expose in owner console; alert thresholds; cost-per-note metric | 32 | (spec on start) |
| 36 | **Mobile / PWA polish** | next-pwa offline UX; iPad-specific layout audit; touch-target audit; reduced-motion audit | 03 | (spec on start) |
| 37 | **Public signup + self-serve org creation** | Public landing → signup → org provisioning; account lockout fields on User; invite-token expiration enforcement; rate-limit; CAPTCHA. **Commercial signup provisioning (SOLO seat) → Wave 7 Unit 40.** | 08 | [`37-public-signup.md`](37-public-signup.md) |

---

## Wave 7 — Billing & subscriptions (units 38–41)

> **Canonical wave for all billing, seats, Stripe, and subscription work.** Do not scatter billing scope across Waves 1 or 6 — reference this wave instead. Prerequisites from Units 01 and 09 are listed first; they shipped inside earlier waves before Wave 7 was named.

| # | Name | Builds | Depends on | Spec | Status |
|---|---|---|---|---|---|
| §01 | **Billing foundation — Seat model** | `Seat`, `SeatTier`, `OrgUser.seatId`, seed seats | — | [`01-foundation-auth-tenant.md`](01-foundation-auth-tenant.md) | complete (Wave 0) |
| §09 | **Owner billing surfaces — Stripe stub** | `/owner/orgs/[id]` seat card, `/admin/seats` v1, `src/services/billing/stripe.ts` stub, `STRIPE_SUBSCRIPTION_UPDATED` audit | §01 | [`09-owner-console-v1.md`](09-owner-console-v1.md) | complete (Wave 1) |
| 38 | **Stripe subscriptions — live pipeline** | Checkout, webhook `reconcileSeats`, Customer Portal, `SeatTransfer`, assign/revoke, `/admin/billing`, `checkClinicianSeat` gate | §01, §09 | [`38-stripe-subscriptions.md`](38-stripe-subscriptions.md) | complete |
| 39 | **Subscription plan governance** | `SubscriptionPlan` enum, owner overrides, `ORG_SUBSCRIPTION_UPDATED` audit, `/owner/orgs/[id]` subscription form | §09 | billing slice of [`32-owner-console-maturity.md`](32-owner-console-maturity.md) | complete (built as Unit 32) |
| 40 | **Self-serve commercial onboarding** | `/signup`, atomic org+SOLO seat, `ORG_SELF_PROVISIONED` audit; Stripe checkout during signup deferred | 08 | billing slice of [`37-public-signup.md`](37-public-signup.md) | complete (built as Unit 37) |
| 41 | **Usage-based billing & plan-tier flags** | `FEATURE_FLAG_USAGE_BASED_BILLING`, Stripe metered usage, plan-tier feature gates | 38, 39 | (write spec on start) | planned ⏸ |

**End of Wave 7**: Org can subscribe via Stripe, seats reconcile from webhook, admins assign seats, clinicians are gated, owner can set plan tier, and new orgs can self-provision with a trial SOLO seat. Usage-based billing lands in Unit 41.

**Not in Wave 7 (explicitly out of scope):** in-app clinical billing (CPT / claims). Stripe handles SaaS subscription only.

---

## Wave 8 — Copilot maturity port / Miss Cleo (units 42–47)

> **Canonical wave for copilot UX, persona, streaming, reasoning depth, and conversation persistence.** Wave 5 (Units 25–31) shipped the capability stack (Watch v1/v2, Ask, FHIR tools, research stub, drafts, basic think steps). Wave 8 is a **port from OmniScribeThree**, not greenfield — it graduates the copilot from functional to trusted daily-use: named persona, streaming responses, mature beacon UX, deep reasoning orchestration, real web research, and DB-backed chat history.

| # | Name | Builds | Depends on | Spec | Status |
|---|---|---|---|---|---|
| 42 | **Copilot persona — Miss Cleo** | `src/services/copilot/persona.ts` — display name, peer-colleague system voice, salutation/greeting helpers, anti-drift reminders; wired into `ASK_SYSTEM_PROMPT` + `RESEARCH_SYSTEM_PROMPT` + empty-state copy | 31 | [`42-copilot-persona-miss-cleo.md`](42-copilot-persona-miss-cleo.md) | planned ⏸ |
| 43 | **SSE streaming — Ask + Research** | Replace blocking POST responses with SSE token/action stream; `parseJsonSseBuffer()` for incremental JSON action parsing; streaming indicators in Chart + Research tabs | 42 | (write spec on start) | planned ⏸ |
| 44 | **Beacon UX maturity** | Draggable `<CopilotBeacon>`, mode-suggestion chips (Chart / Research), persisted collapsed/expanded + position in `localStorage` (PHI-free keys only) | 42 | (write spec on start) | planned ⏸ |
| 45 | **Reasoning engine depth** | Graduate Unit 31's inline `think` step to `planner.ts` → `synthesis.ts` → `reasoning/orchestrator.ts`; structured multi-step chains with pause/redirect hooks | 43 | (write spec on start) | planned ⏸ |
| 46 | **Deep research mode** | Real `web_search` + `fetch_url` tools (replace PMC stub); research consent gate; PHI rewrite before external query; copy-to-chart attestation flow | 29, 43 | (write spec on start) | planned ⏸ |
| 47 | **Conversation persistence + query routing** | `CopilotConversation` + message rows in DB; per-org conversation budget; clinical-variable anchoring; hard router (chart vs research vs action) | 45, 46 | (write spec on start) | planned ⏸ |

**End of Wave 8**: Clinicians interact with **Miss Cleo** — a named, streaming, draggable copilot with deep reasoning, real web research (with consent), and persistent per-patient chat history that survives Sheet close.

**Wave 5 vs Wave 8:** Wave 5 built *what the copilot can do*; Wave 8 builds *how it feels and scales*. Do not re-implement tools already in Units 27–31 — extend and port.

**Open decision (Unit 43):** Native Bedrock Converse tool-use vs keeping prompt-engineered JSON dispatch (Unit 27). Decide at Unit 43 spec time; default = keep JSON dispatch for minimal diff unless streaming requires Converse.

> **⏸ Gate:** Waves 7 and 8 are **paused** until [`polish-waves-0-6.md`](polish-waves-0-6.md) P0 + P1 items are complete.

---

## Wave 1 follow-on — Brief depth / visit-type intent (unit 48)

> **Extension of shipped Wave 1 Unit 06.** Not Wave 8 (Miss Cleo persona work) — does not require persona maturity to ship; the polish gate ahead of Wave 7/8 does not apply. Spec'd 2026-05-23 after clinician feedback that the brief is comprehensive about what *happened* but blind to what's about to *happen* (Initial Eval vs. Daily vs. Progress vs. Re-eval vs. Discharge).

| # | Name | Builds | Depends on | Spec | Status |
|---|---|---|---|---|---|
| 48 | **Pre-visit brief — visit-type intent + intent-aware spine** | `EncounterIntent` enum + `Encounter.intent` + `intentSource`; deterministic `IntentProposer` service + `/api/patients/[id]/proposed-intent`; intent chip in `<StartVisitDialog>`; `BriefGenerator` branches per `(division, intent)`; new intent-gated spine components `<GoalLedger>` / `<MedicalNecessityScaffold>` / `<RiskTrendSparkline>` / `<CareGapsList>` for four MVP pairs: `REHAB_PROGRESS_NOTE`, `REHAB_REEVAL`, `BH_TREATMENT_PLAN_REVIEW`, `MEDICAL_ANNUAL_WELLNESS` | 02, 06, 07 | [`48-pre-visit-brief-intent.md`](48-pre-visit-brief-intent.md) · taxonomy [`references/visit-type-taxonomy.md`](../../references/visit-type-taxonomy.md) · audit [`references/brief-chain-state-of-play.md`](../../references/brief-chain-state-of-play.md) | PR1 shipped (foundation: schema + proposer + endpoint); PR2+ pending |

**Sequencing:** Awaiting prioritization relative to Sprint 0 (login/MFA, in flight) and Sprint A (voice-ID, Daily.co real, provider checklist). Unit 48 is **not gated** by the polish doc — it can ship in parallel if a clinician-impact PR is justified (precedent: Unit 42 shipped out of order 2026-05-21 because the cockpit page needed it).

**Scope discipline:** v1 ships intent capture + four MVP intent-aware spines. Out of scope for v1: spines for the other 13 `(division, intent)` pairs, note-generator template defaulting by intent, compliance flags by intent, sign-time-sweep widening, post-sign artifact branching. Each is its own follow-on unit.

## Wave 1 follow-on — Case-Division Rule (unit 49)

> **Extension of shipped Wave 1 Unit 06 + Unit 48 PR1 (foundation now landed on main).** Not Wave 8 (Miss Cleo persona work) — the rule itself (column + filters + 403s + follow-up gate) ships unflagged; only the new Cleo UX surfaces sit behind `cleo.caseRule.v1`. The polish gate ahead of Wave 7/8 does not apply. Spec'd 2026-05-24 after user surfaced two stacked clinical realities: (a) clinicians of one division (e.g., PT — REHAB) can today accept cases opened by another division (e.g., PCP — MEDICAL) with nothing in the API or UI stopping them, and (b) shared ICDs (F41.1 GAD across MEDICAL+BH; M54.50 Lumbago across MEDICAL+REHAB) need parallel cases per division, not a single multi-division case.

| # | Name | Builds | Depends on | Spec | Status |
|---|---|---|---|---|---|
| 49 | **Case-Division Rule + Cleo as biller** | `CaseManagement.division` (stamp at creation, immutable) + `FollowUp.division` (inherits from origin note) + `Note.billerAdvisoryJson`; `assertCanContinueCase` helper + `CASE_DIVISION_BLOCKED` audit; case-router proposes parallel cases per division on shared ICDs (never cross-division attach); Miss Cleo three-moment: pre-visit nominator badge, pre-sign intent-fit chip (rule-20 safe), post-sign biller advisory card (`ADDENDUM` / `OPEN_NEW_NEXT_VISIT` / `MARK_CLEARED`); feature flag `cleo.caseRule.v1` gates UX surfaces only | 02, 06, 07, 48 | [`49-case-division-rule.md`](49-case-division-rule.md) | PR1 + PR2 shipped; §F/§G + PR3 pending |

**Sequencing:** Not gated by polish — clinician-impact / compliance-impact justifies parallel ship. Three-PR phasing keeps each merge under ~3% regression individually (PR1 base+parallel+nominator+chip, PR2 follow-up gate, PR3 biller advisory). **Hard order: PR2 before PR3** — Cleo's biller advisor reasons about follow-ups in scope; we don't want her reasoning across divisions before the filter exists.

**Scope discipline:** v1 ships the rule + parallel-case routing + three Cleo touchpoints. Out of scope for v1: cross-division case re-routing (forbidden under the rule — answer is "close + open new in target division," manual), admin UI for editing `IcdProfessionEligibility` rows (PR3 seeds only; CRUD UI is a follow-on), multi-division co-managed single-case schema with `permittedDivisions[]` (rejected at design time — dilutes the rule, complicates billing trail), Cleo-authored addendum text (clinician authors all clinical text — Cleo opens the draft only), push/email/SMS biller advisory notifications (in-app only), per-clinician biller-advisor tuning sliders. Each is its own follow-on consideration.

---

## Polish — Waves 0–6 (gate before Wave 7 & 8)

Units 01–37 shipped capability; stubs and deferred polish remain. **Do not start Wave 7 Unit 41 or Wave 8 Unit 42+ until the polish gate opens.**

Full checklist: [`polish-waves-0-6.md`](polish-waves-0-6.md) — organized by wave with P0/P1/P2 tiers and suggested sprints A–D.

---

## Notes for the Implementing Team

- **Units 01–08 are spec'd in this folder.** Build them in order. Verify each before moving on. The eight foundational specs are where most of the documentation lift is — units 09+ are smaller-scope and the team writes the spec just-in-time.
- **Polish gate — Waves 0–6 before Wave 7/8.** See [`polish-waves-0-6.md`](polish-waves-0-6.md). P0 = voice-ID, Daily.co real, provider wiring. P1 = touch targets, iPad, telehealth CTA, PWA icons, announcement banner, FHIR sweeper.
- **Wave 7 = billing & subscriptions** — all seat / Stripe / subscription work references Wave 7, not Wave 1 or Wave 6. **Paused until polish gate.**
- **Wave 8 = copilot maturity port (Miss Cleo)** — persona, streaming, beacon UX, reasoning depth, deep research, conversation persistence. **Paused until polish gate.**
- **Wave 1 = minimum credible clinical v1.** Ship Wave 0 + Wave 1 before chasing any later wave. Don't parallelize across waves; do parallelize within a wave.
- **Wave 4 (FHIR) is the long pole.** Start F1 (Unit 19) as soon as runway allows — it doesn't block any scribe features but enables every downstream copilot intelligence.
- **Each new spec file** follows the methodology template (Goal / Design / Implementation / Dependencies / Verify when done). See [`01-foundation-auth-tenant.md`](01-foundation-auth-tenant.md) for the canonical shape.

## How to extend this build plan

When you complete a unit, mark it `complete` here (with date) AND update `context/progress-tracker.md`. When you decide a new unit is needed, append it with the next available number and a brief; write the full spec when you start it.
