/**
 * Typed action union for AuditLog.action.
 * Append new actions as new units add behavior. Never rename — historical
 * AuditLog rows reference these strings.
 *
 * Unit 01 surface area:
 *   - Auth: USER_SIGNED_IN / _FAILED, MFA_VERIFIED / _FAILED, MFA_ENROLLED /
 *     _FAILED, PASSWORD_RESET_REQUESTED / _COMPLETED / _INITIATED_BY_ADMIN,
 *     MFA_RESET (admin), INVITE_SENT / _CONSUMED, USER_CREATED, USER_UPDATED,
 *     USER_DEACTIVATED
 *   - Owner: ORG_CREATED, ORG_BAA_UPDATED, PLATFORM_ORG_CREATED
 *   - Onboarding: ONBOARDING_COMPLETED
 */
export type AuditAction =
  | 'USER_SIGNED_IN'
  | 'USER_SIGNED_IN_FAILED'
  | 'MFA_VERIFIED'
  | 'MFA_VERIFY_FAILED'
  | 'MFA_ENROLLED'
  | 'MFA_ENROLL_FAILED'
  | 'MFA_DISABLED_BY_USER'
  | 'MFA_RESET'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'PASSWORD_RESET_INITIATED_BY_ADMIN'
  | 'INVITE_SENT'
  | 'INVITE_CONSUMED'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DEACTIVATED'
  | 'ORG_CREATED'
  | 'ORG_BAA_UPDATED'
  | 'PLATFORM_ORG_CREATED'
  | 'PLATFORM_BAA_UPDATED'
  | 'ONBOARDING_COMPLETED'
  // ---- Unit 02: Patient & Schedule core ----
  | 'PATIENT_CREATED'
  | 'PATIENT_VIEWED'
  | 'PATIENT_UPDATED'
  | 'PATIENT_DELETED'
  | 'PATIENT_SEARCHED'
  | 'PATIENT_ADDRESS_UPSERT'
  | 'PATIENT_COVERAGE_UPSERT'
  | 'PATIENT_EMERGENCY_CONTACT_UPSERT'
  | 'PATIENT_CONSENT_UPSERT'
  | 'DEPARTMENT_CREATED'
  | 'DEPARTMENT_UPDATED'
  | 'DEPARTMENT_DELETED'
  | 'PATIENT_ENROLLMENT_CHANGED'
  | 'PATIENT_INTAKE_SUBMITTED'
  | 'PATIENT_INTAKE_SENSITIVITY_CHANGED'
  | 'SCHEDULE_CREATED'
  | 'SCHEDULE_UPDATED'
  | 'SCHEDULE_CANCELLED'
  | 'SCHEDULE_STARTED'
  | 'ENCOUNTER_CREATED'
  // ---- Unit 03: Capture & Recording ----
  | 'REALTIME_KEY_ISSUED'
  | 'RECORDING_STARTED'
  | 'RECORDING_PAUSED'
  | 'RECORDING_RESUMED'
  | 'RECORDING_FINALIZED'
  | 'AUDIO_UPLOADED'
  | 'TRANSCRIPT_PASTED'
  // ---- Unit 04: Transcription Pipeline ----
  | 'NOTE_STATUS_TRANSITIONED'
  | 'NOTE_INTERRUPTED'
  | 'TRANSCRIPTION_JOB_ENQUEUED'
  | 'TRANSCRIPT_FINALIZED'
  | 'VOICE_ID_MATCHED'
  | 'VOICE_ID_SKIPPED'
  | 'VOICE_ID_FAILED'
  // ---- Unit 05: Note Generation & Sign ----
  | 'NOTE_GENERATION_STARTED'
  | 'NOTE_GENERATION_COMPLETED'
  | 'NOTE_GENERATION_FAILED'
  | 'SECTION_GENERATED'
  | 'SECTION_REGEN_ENQUEUED'
  | 'SECTION_REGENERATED'
  | 'SECTION_GENERATION_FAILED'
  | 'SECTION_EDITED'
  | 'NOTE_SIGN_OPENED'
  | 'NOTE_SIGNED'
  | 'NOTE_TEMPLATE_SELECTED'
  | 'NOTE_BRIEF_ENQUEUED'
  | 'POST_SIGN_ARTIFACT_ENQUEUED'
  | 'POST_SIGN_ARTIFACT_GENERATED'
  | 'POST_SIGN_ARTIFACT_GENERATION_FAILED'
  | 'POST_SIGN_ARTIFACT_SKIPPED'
  // ---- Unit 06: Prior-Context Brief + Follow-up lifecycle ----
  | 'BRIEF_GENERATED'
  | 'BRIEF_GENERATION_FAILED'
  | 'BRIEF_FALLBACK_HAIKU'
  | 'BRIEF_VIEWED'
  | 'FOLLOWUP_CREATED'
  | 'FOLLOWUP_STATUS_CHANGED'
  | 'FOLLOWUP_CLOSED'
  | 'FOLLOWUP_SWEEP_OPENED'
  | 'FOLLOWUP_SWEEP_SKIPPED'
  | 'FOLLOWUP_SWEEP_RESOLVED'
  // ---- Unit 07: Encounter Copilot Watch v0 ----
  | 'COPILOT_CARD_RENDERED'
  | 'COPILOT_CARD_DISMISSED'
  | 'COPILOT_BEACON_OPENED'
  | 'COPILOT_BEACON_CLOSED'
  // ---- Unit 26: Watch v2 live trigger ----
  // Fires once per cardType per capture session when a transcript mention
  // raises rows in the card for the first time. itemCount = number of
  // rows currently raised at first-fire moment.
  | 'COPILOT_CARD_RAISED'
  // ---- Unit 27: Ask mode v1 — agent loop ----
  // Server-side audit from /api/copilot/ask:
  //   COPILOT_ASK_QUERY — per incoming question. Metadata: question
  //     LENGTH only (PHI-fenced; the question text may carry PHI so we
  //     never log it).
  //   COPILOT_TOOL_CALL — per tool invocation in the agent loop.
  //     Metadata: tool name + result row count.
  //   COPILOT_ASK_ANSWERED — per finalized response. Metadata: source
  //     count + iteration count + stub flag.
  | 'COPILOT_ASK_QUERY'
  | 'COPILOT_TOOL_CALL'
  | 'COPILOT_ASK_ANSWERED'
  // ---- Unit 29: Research mode ----
  // Server-side audit from /api/copilot/research. Tool calls still
  // use COPILOT_TOOL_CALL (same shape); final answer reuses
  // COPILOT_ASK_ANSWERED with metadata.mode === 'research' so the
  // auditor lens can count chart-vs-research answers from one row
  // type. PHI-fenced: question LENGTH only (research questions can
  // still mention PHI if the clinician types it — better not logged).
  | 'COPILOT_RESEARCH_QUERY'
  // ---- Unit 30: Action tools — drafts ----
  // The agent SUGGESTS drafts; the clinician DECIDES. Both events are
  // audited so the auditor sees the full agent-vs-clinician judgment
  // chain. PHI-fenced throughout — metadata is draftKind + content
  // LENGTH + sideEffect/actionTaken, NEVER the draft text itself.
  //
  // PROPOSED fires per-tool-call from the agent loop (one row per
  // draft surfaced). CONFIRMED + DISCARDED fire on the clinician's
  // explicit decision (one row each).
  | 'COPILOT_DRAFT_PROPOSED'
  | 'COPILOT_DRAFT_CONFIRMED'
  | 'COPILOT_DRAFT_DISCARDED'
  // ---- Unit 08: Admin & Compliance Ready ----
  | 'SITE_CREATED'
  | 'SITE_UPDATED'
  | 'SITE_ARCHIVED'
  | 'SITE_UNARCHIVED'
  | 'ROOM_CREATED'
  | 'ROOM_UPDATED'
  | 'ROOM_ARCHIVED'
  | 'ROOM_UNARCHIVED'
  | 'ORG_SETTINGS_UPDATED'
  | 'USER_ROLE_CHANGED'
  | 'NOTE_SENSITIVITY_CHANGED'
  | 'AUDIT_LOG_VIEWED'
  | 'AUDIT_LOG_EXPORTED'
  | 'SITES_LIST_VIEWED'
  // ---- Unit 09: Owner Console v1 ----
  | 'PLATFORM_USERS_VIEWED'
  | 'PLATFORM_AUDIT_VIEWED'
  | 'PLATFORM_AUDIT_EXPORTED'
  | 'PLATFORM_HEALTH_CHECKED'
  | 'ANNOUNCEMENT_CREATED'
  | 'ANNOUNCEMENT_UPDATED'
  | 'ANNOUNCEMENT_DELETED'
  | 'SEAT_ALLOCATED'
  | 'SEAT_REVOKED'
  | 'STRIPE_SUBSCRIPTION_UPDATED'
  | 'STRIPE_SUBSCRIPTION_STUB'
  // ---- Unit 10: Section-regenerate UX maturity ----
  | 'SECTION_DIFF_VIEWED'
  | 'SECTION_REGEN_RETRY_BATCH'
  // ---- Unit 11: Episode-of-care maturity ----
  | 'EPISODE_RECERT_TRIGGERED'
  | 'EPISODE_RECERTIFIED'
  | 'EPISODE_DISCHARGED'
  | 'EPISODE_REOPENED'
  | 'EPISODE_UPDATED'
  | 'EPISODE_VISIT_COUNT_INCREMENTED'
  | 'EPISODE_VISIT_LIMIT_OVERRIDE'
  | 'EPISODE_SWEEP_RUN'
  | 'GOAL_STATUS_CHANGED'
  | 'GOAL_PROGRESS_ENTRY_ADDED'
  // ---- Unit 12: Patient detail redesign ----
  | 'SNAPSHOT_OVERRIDE_CREATED'
  | 'SNAPSHOT_OVERRIDE_SUPERSEDED'
  | 'PATIENT_DEMOGRAPHICS_EDITED'
  // ---- Unit 13: Templates editor maturity ----
  | 'TEMPLATE_CREATED'
  | 'TEMPLATE_UPDATED'
  | 'TEMPLATE_CLONED'
  | 'TEMPLATE_ARCHIVED'
  | 'TEMPLATE_UNARCHIVED'
  // ---- Unit 14: Review screen polish + AI compliance flags ----
  | 'FLAGS_ANALYZER_ENQUEUED'
  | 'FLAGS_ANALYZED'
  | 'FLAG_RESOLVED'
  | 'FLAG_DISMISSED'
  | 'SECTION_COPIED_TO_CLIPBOARD'
  // ---- Unit 15: Telehealth infra + patient auth ----
  | 'TELEHEALTH_SESSION_CREATED'
  | 'TELEHEALTH_MAGIC_LINK_FAILED'
  | 'TELEHEALTH_PATIENT_VERIFIED'
  | 'TELEHEALTH_CONSENT_CAPTURED'
  | 'TELEHEALTH_SESSION_STARTED'
  | 'TELEHEALTH_SESSION_ENDED'
  | 'TELEHEALTH_ROOM_CREATED'
  | 'TELEHEALTH_ROOM_DESTROYED'
  // ---- Unit 16: Telehealth audio integration ----
  // Logged by the Unit 17 room surface when the audio pipeline drains its
  // 30 s reconnect buffer after a WebSocket reopen. The pipeline library
  // itself has no DB writer; the surface emits on its behalf so the
  // auditor lens can see connectivity blips per session.
  | 'TELEHEALTH_AUDIO_RECONNECTED'
  // ---- Unit 18: Telehealth polish ----
  // Logged by the preflight surface when a clinician's pre-call diagnostic
  // fails one of (mic / network / browser_compat). Metadata captures the
  // check name + a short PHI-free reason; gives ops visibility into the
  // common setup failures so the support playbook can address them.
  | 'TELEHEALTH_PRECALL_CHECK_FAILED'
  // ---- Unit 19: FHIR / SMART OAuth2 auth foundations (Wave 4 / F1) ----
  // Five actions covering the SMART provider-launched OAuth handshake +
  // token lifecycle. All PHI-free — patient identifiers from the launch
  // context are EHR-side, not HIPAA Safe Harbor PHI.
  | 'FHIR_LAUNCH_INITIATED'
  | 'FHIR_AUTH_GRANTED'
  | 'FHIR_AUTH_FAILED'
  | 'FHIR_TOKEN_REFRESHED'
  | 'FHIR_DISCONNECTED'
  // ---- Unit 20: FHIR / Patient identity matching (Wave 4 / F2) ----
  // Search + link lifecycle. PHI fence: FHIR_PATIENT_SEARCH metadata
  // carries field NAMES (which fields the clinician queried by), never
  // the values. LINK actions carry fhirPatientId which is the EHR-side
  // identifier (not HIPAA Safe Harbor PHI).
  | 'FHIR_PATIENT_SEARCH'
  | 'FHIR_PATIENT_LINK_CREATED'
  | 'FHIR_PATIENT_LINK_VERIFIED'
  | 'FHIR_PATIENT_LINK_REMOVED'
  // ---- Unit 21: FHIR / Resource sync + cache (Wave 4 / F3) ----
  // SYNC_TRIGGERED + SYNC_COMPLETED bracket a clinician-initiated sync;
  // RESOURCE_CACHED fires per resource type that wrote ≥1 row (suppressed
  // when count === 0 to keep audit row volume sane). All PHI-free —
  // fhirPatientId + fhirResourceId are EHR-side identifiers, counts are
  // aggregates.
  | 'FHIR_SYNC_TRIGGERED'
  | 'FHIR_SYNC_COMPLETED'
  | 'FHIR_RESOURCE_CACHED'
  // ---- Unit 23: FHIR / Provenance UI (Wave 4 / F5) ----
  // Fired once per drawer-open from the BriefCard's EhrSourcePill.
  // PHI-free — the resource id is an EHR-side identifier.
  | 'FHIR_RESOURCE_VIEWED'
  // ---- Unit 24: FHIR / Multi-EHR adapter (Wave 4 / F6) ----
  // Reserved for the future per-org EHR connection management UI. F6
  // ships the adapter seam + OrgEhrConnection schema; the emitters
  // land when a customer demands a second EHR vendor.
  | 'ORG_EHR_CONNECTION_CREATED'
  | 'ORG_EHR_CONNECTION_REMOVED';
