# Glossary

| Term | Definition |
|---|---|
| **OmniScribe** | The product. A HIPAA-grade medical AI scribe + agentic clinical copilot for Medical / Rehab / Behavioral Health clinicians. |
| **PHI** | Protected Health Information. Anything identifying a patient + clinical context. Triggers HIPAA + BAA. |
| **HIPAA** | Health Insurance Portability and Accountability Act (US). The privacy + security framework for medical data. |
| **BAA** | Business Associate Agreement. Contract between OmniScribe and any subprocessor (AWS, Soniox) that touches PHI. Required by HIPAA. |
| **BIPA** | Illinois Biometric Information Privacy Act. Triggers consent + retention rules on voice embeddings (and other biometrics). |
| **42 CFR Part 2** | Federal regulation governing substance-use-disorder records. Tighter than HIPAA. Behavioral Health notes default to this sensitivity. |
| **NPI** | National Provider Identifier. Unique 10-digit ID for US healthcare providers. Captured on `PractitionerProfile`. |
| **SOAP** | Subjective / Objective / Assessment / Plan. The standard medical note structure. |
| **STG / LTG** | Short-Term Goal / Long-Term Goal. Rehab episode goals. Captured on `EpisodeGoal`. |
| **VAS** | Visual Analog Scale (0–10 pain rating). Common in rehab notes. |
| **AROM / PROM** | Active / Passive Range of Motion. Rehab measure. |
| **MMT** | Manual Muscle Test (0/5–5/5). Rehab measure. |
| **HEP** | Home Exercise Program. Patient-facing instructions after a rehab visit. |
| **PHQ-9 / GAD-7** | Patient Health Questionnaire (depression) / Generalized Anxiety Disorder scale. Behavioral Health screening instruments. |
| **CPT code** | Current Procedural Terminology code. Used for billing what was done in a visit. |
| **CDS Hooks** | Clinical Decision Support Hooks — protocol for surfacing recommendations to a clinician in an EHR workflow. **Out of scope for v1** (OmniScribe cards don't recommend). |
| **EHR / EMR** | Electronic Health Record / Electronic Medical Record system (NextGen, Epic, Cerner, etc.). |
| **FHIR** | Fast Healthcare Interoperability Resources, version R4. HL7 standard for EHR data exchange. |
| **SMART on FHIR** | OAuth2-based launch protocol for FHIR apps. v1 OmniScribe is provider-launched, read-only. |
| **US Core** | The US FHIR Implementation Guide profile. Target for v1, not formally certified. |
| **MAC** | Medicare Administrative Contractor. The auditor for Medicare claims. Three-lens "Medicare Compliance Officer" lens references this. |
| **Right of Amendment** | HIPAA right for patients to request changes to their PHI. OmniScribe supports via addenda (signed notes are immutable). |
| **Signing PIN** | Per-user 4-digit PIN (bcrypt-hashed at `User.signingPinHash`) that gates note signing for a grace window. The protection at the moment of attestation; replaces what MFA TOTP did before Sprint 0.20. |
| **BullMQ** | Node.js queue library on Redis. OmniScribe runs 5 queues (`transcription`, `ai-generation`, `note-finalize`, `voice-id`, `note-brief`). |
| **OKLCH** | Perceptual color space (Lightness / Chroma / Hue). All design tokens use OKLCH for cross-mode consistency. |
| **pgvector** | PostgreSQL extension for vector similarity search. Used for voice-embedding cosine similarity. |
| **TitaNet** | NVIDIA voice-embedding model (192-dim x-vectors). Used for speaker identification. |
| **Diarization** | "Who spoke when" — assigning utterances to speakers in audio. Soniox does this in real time. |
| **x-vector / embedding** | A 192-dim float vector that represents a speaker's voice for matching. |
| **Soniox** | The real-time speech-to-text provider used for transcription. BAA-covered. |
| **Bedrock** | AWS-hosted LLM service. Provides Claude Sonnet 4.5 and Haiku 4.5 under AWS BAA. |
| **Rule-20 attested source** | A source the copilot is allowed to read: signed/transferred notes, clinician-confirmed FollowUp rows, verified FHIR resources. No drafts. No inferences beyond source. |
| **Three-lens evaluation** | Clinician / Medicare Compliance Officer / Insurance Auditor — every feature passes all three before merging. |
| **3-tap test** | A clinician should be able to complete any common action in ≤ 3 taps. Hard gate on clinical surfaces. |
| **CaptureMode** | `LIVE` / `UPLOADED` / `PASTED` — how a note's source content was captured. Durable on the Note. |
| **NoteStatus** | `PREPARING` / `RECORDING` / `PAUSED` / `TRANSCRIBING` / `DRAFTING` / `DRAFT` / `REVIEWING` / `SIGNED` / `TRANSFERRED` / `INTERRUPTED` / `PENDING_REVIEW`. Append-only enum. |
| **finalJson** | The signed note's content. Immutable after `Note.status === SIGNED`. |
| **draftJson** | The in-progress note content. Editable until sign. |
| **Division** | `MEDICAL` / `REHAB` / `BEHAVIORAL_HEALTH` / `MULTI`. Drives prompt selection, snapshot rows, template visibility, sensitivity defaults. |
| **Sensitivity level** | `STANDARD_CLINICAL` / `BEHAVIORAL_HEALTH` / `BILLING_ONLY` / `ADMINISTRATIVE`. Gates which roles can read the note. BH notes default to `BEHAVIORAL_HEALTH`. |
| **OrgRole** | `SUPER_ADMIN` / `ORG_ADMIN` / `SITE_ADMIN` / `CLINICIAN` / `VIEWER`. Determines feature access. |
| **PlatformRole** | `PLATFORM_OWNER` / `NONE`. Determines cross-org owner-console access. |
| **Section progress strip** | The horizontal row of section status cells (`empty / generating / populated / edited / failed`) shown on capture + review surfaces. |
| **Prior-context brief** | Structured 30-second pre-visit read precomputed at sign-time. Lives on `NoteBrief` (1:1 with signed notes). Drives copilot Watch cards + the prepare surface. |
| **Watch (copilot mode)** | The proactive mode — cards surface context without the clinician asking. v0 = open-follow-ups + plan-for-today. |
| **Ask (copilot mode)** | The reactive mode — clinician opens a chat sheet and asks. v1 = multi-turn agent loop with tool calls. |
| **Beacon** | The always-available chat-trigger button (Sparkles icon, bottom-right). Opens the Ask sheet. |
| **Follow-up sweep** | The sign-time modal that forces a decision on every still-open `FollowUp` from a prior visit before final sign. |
| **Provenance / source pill** | Tappable badge on every copilot fact ("from Progress Note · 2026-04-22"). One tap = source note + section. |
| **Episode of care** | Longitudinal container for ongoing care (rehab + chronic). Holds goals, visit counters, recert cycles. |
| **Recert** | Recertification. A scheduled re-evaluation that re-establishes medical necessity for ongoing care (default 90 days for rehab). |
| **Department** | A clinical department within an org (e.g., PT, OT, SLP, Cardiology, Behavioral Health). Org-wide or site-scoped. |
| **Seat** | A subscription seat (`SOLO` / `TEAM` / `ENTERPRISE` tier). Assigned to a user. Time-limited; renewable. |
| **Voice profile** | A clinician's enrolled voice embedding for speaker ID. BIPA consent required. Soft-delete + 30-day grace period. |
| **Magic-link** | A single-use URL that authenticates a patient into a telehealth waiting room. Token + DOB verification. |
