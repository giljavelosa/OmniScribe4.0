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
  | 'ORG_USER_PROFILE_COMPLETED'
  | 'NOTE_VISIT_CONTEXT_CHANGED'
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
  // Unit 48 PR5 — emitted by the nudge act endpoint when the clinician
  // applies the proposed visit-type intent from an INTENT_PROPOSAL_MISSED
  // nudge. Reconstructs the chain: Cleo proposed → clinician initially
  // dismissed → safety-net nudge fired → clinician applied.
  | 'ENCOUNTER_INTENT_UPDATED'
  // ---- Unit 03: Capture & Recording ----
  | 'REALTIME_KEY_ISSUED'
  | 'RECORDING_STARTED'
  | 'RECORDING_PAUSED'
  | 'RECORDING_RESUMED'
  | 'RECORDING_FINALIZED'
  // Empty-transcript recovery (regression fix 2026-05-25): clinician
  // chose to discard a placeholder draft and start the recording over.
  // Audio segments are soft-deleted (rule 7) and the note transitions
  // back to PREPARING. Metadata captures the discarded segments so a
  // reviewer can verify nothing meaningful was lost.
  | 'RECORDING_RESET'
  | 'AUDIO_UPLOADED'
  | 'TRANSCRIPT_PASTED'
  // ---- Unit 04: Transcription Pipeline ----
  | 'NOTE_STATUS_TRANSITIONED'
  | 'NOTE_INTERRUPTED'
  | 'NOTE_RETRY_ENQUEUED'
  | 'TRANSCRIPTION_JOB_ENQUEUED'
  | 'TRANSCRIPT_FINALIZED'
  | 'VOICE_ID_MATCHED'
  | 'VOICE_ID_ENROLLED'
  | 'VOICE_PROFILE_CREATED'
  | 'VOICE_PROFILE_REVOKED'
  | 'VOICE_ID_SKIPPED'
  | 'VOICE_ID_FAILED'
  // ---- Sprint 0.7: dedicated visit viewer ----
  | 'NOTE_AUDIO_URL_GENERATED'
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
  // ---- Unit 31: Clinical reasoning chains ----
  // One row per "think" step the agent emitted between tool calls or
  // before the final answer. Bounded by MAX_THINK_STEPS so volume is
  // capped per ask. PHI-fenced: metadata is stepIndex + summaryLength
  // — the summary itself is NEVER logged (the model is instructed to
  // exclude PHI but the audit layer enforces it via metadata shape).
  | 'COPILOT_REASONING_STEP'
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
  | 'NOTE_STYLE_CHANGED'
  | 'SIGNING_PIN_SET'
  | 'SIGNING_PIN_ROTATED'
  | 'SIGNING_PIN_VERIFIED'
  | 'SIGNING_PIN_VERIFY_FAILED'
  | 'SIGNING_PIN_UNLOCK_HONORED'
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
  | 'SEAT_ASSIGNED'
  | 'SEAT_REVOKED'
  | 'STRIPE_SUBSCRIPTION_UPDATED'
  | 'STRIPE_SUBSCRIPTION_STUB'
  // ---- Subscriptions: Stripe checkout + webhook pipeline ----
  | 'STRIPE_CHECKOUT_STARTED'
  | 'STRIPE_SUBSCRIPTION_CANCELED'
  | 'STRIPE_PAYMENT_FAILED'
  | 'STRIPE_BILLING_PORTAL_OPENED'
  // ---- Unit 10: Section-regenerate UX maturity ----
  | 'SECTION_DIFF_VIEWED'
  | 'SECTION_REGEN_RETRY_BATCH'
  // ---- Unit 11: Episode-of-care maturity ----
  | 'EPISODE_CREATED'
  | 'EPISODE_RECERT_TRIGGERED'
  | 'EPISODE_RECERTIFIED'
  | 'EPISODE_DISCHARGED'
  | 'EPISODE_REOPENED'
  | 'EPISODE_UPDATED'
  | 'EPISODE_VISIT_COUNT_INCREMENTED'
  | 'EPISODE_VISIT_LIMIT_OVERRIDE'
  | 'EPISODE_SWEEP_RUN'
  // ---- Sprint 0.11: Case management ----
  | 'CASE_MANAGEMENT_CREATED'
  | 'CASE_MANAGEMENT_UPDATED'
  | 'CASE_MANAGEMENT_CLOSED'
  | 'GOAL_STATUS_CHANGED'
  | 'GOAL_PROGRESS_ENTRY_ADDED'
  // ---- Sprint 0.14: Miss Cleo's persistent memory + chart card ----
  //
  // CLEO_STATE_REBUILT fires when the cleo-state worker upserts a
  // CopilotPatientState row. Metadata: { stateId, patientId,
  // clinicianOrgUserId, generatorVersion, rebuildDurationMs,
  // patternCount, caseCount, factCount, personaVersion }. PHI-free.
  //
  // CLEO_CONVERSATION_OPENED fires on the first message in a brand-new
  // CopilotConversation row. Metadata: { conversationId, mode, patientId,
  // personaVersion }. patientId is null for RESEARCH-mode threads.
  //
  // CLEO_CONVERSATION_PURGED fires when "Reset this conversation" is hit.
  // Metadata: { conversationId, mode, patientId, messageCount, personaVersion }.
  // The CopilotPatientState row is NOT purged — only the chat thread (facts
  // distilled into state survive).
  | 'CLEO_STATE_REBUILT'
  | 'CLEO_CONVERSATION_OPENED'
  | 'CLEO_CONVERSATION_PURGED'
  // ---- Sprint 0.13: Miss Cleo's case-router agent ----
  //
  // CASE_ROUTER_PROPOSED fires once per CaseRouterRun row written by the
  // worker. Metadata: { caseRouterRunId, confidence, modelVersion, action,
  // alternativesCount, personaVersion: 'miss-cleo-v1' }. PHI-free —
  // structural counts + enums only; reasoning + ICD codes live on the
  // CaseRouterRun row, not in metadata.
  //
  // CASE_ROUTER_ACCEPTED + CASE_ROUTER_OVERRIDDEN fire from the accept
  // endpoint. ACCEPTED metadata: { caseRouterRunId, caseManagementId,
  // action, personaVersion }. OVERRIDDEN metadata: { caseRouterRunId,
  // proposedAction, chosenAction, caseManagementId, personaVersion }.
  // The pair (CaseRouterRun + audit) lets a regulator reconstruct *every*
  // routing decision — what the AI proposed (with reasoning + confidence)
  // and what the clinician chose.
  | 'CASE_ROUTER_PROPOSED'
  | 'CASE_ROUTER_ACCEPTED'
  | 'CASE_ROUTER_OVERRIDDEN'
  // ---- Sprint 0.15: FHIR Phase D₁ — Conditions in the case-router ----
  //
  // CASE_ROUTER_FHIR_CITED fires when the case-router worker shipped a
  // proposal that cited at least one verified FHIR Condition (i.e.
  // `proposalJson.fhirCitations.length > 0`). Metadata: {
  // caseRouterRunId, citationCount, fhirIds: string[],
  // personaVersion: 'miss-cleo-v1' }. PHI-free — fhirIds are EHR-side
  // identifiers, not HIPAA Safe Harbor PHI. The full citation payload
  // (recorder names, recordedDate, lastUpdated) lives on the
  // CaseRouterRun row.
  //
  // CASE_ROUTER_FHIR_UNAVAILABLE fires when the worker tried to read
  // FHIR Conditions but the read failed (cache stale / read error /
  // bounded-timeout). Auditor lens: distinguishes "the agent had FHIR
  // data and didn't cite it" from "the system degraded silently."
  // Metadata: { orgId, patientId, errorKind: 'no_cache' | 'timeout' |
  // 'cache_error', personaVersion }. The `not_linked` kind is NOT
  // audited — patients with no verified FHIR link are the baseline
  // state, not a degraded one.
  //
  // CASE_FHIR_LINKED fires from the accept endpoint when a clinician
  // confirms an `open-new-from-condition` proposal and the resulting
  // case is created with `mirrorsFhirConditionId` populated. Metadata:
  // { caseManagementId, caseRouterRunId, fhirConditionId,
  // personaVersion }. The pair (CaseRouterRun.proposalJson.fhirCitations
  // + this audit) gives an auditor a single coherent provenance chain
  // from "the EHR coded this diagnosis" → "Miss Cleo proposed it" →
  // "the clinician accepted" → "the OmniScribe case carries the
  // verified ICD."
  | 'CASE_ROUTER_FHIR_CITED'
  | 'CASE_ROUTER_FHIR_UNAVAILABLE'
  | 'CASE_FHIR_LINKED'
  // ---- Sprint 0.16: FHIR Phase D₂ — Case ↔ Condition reconciliation ----
  //
  // CASE_FHIR_DRIFT_DETECTED fires once per drift signal the worker
  // persists to `CaseFhirDriftLog`. The pure detector
  // (`detectDriftSignals`) emits one signal per drift kind on each
  // mirrored case; the worker writes one log row + one audit row per
  // signal. Metadata: { driftLogId, caseManagementId, fhirConditionId,
  // driftKind ('STATUS' | 'ICD'), personaVersion }. PHI-free —
  // fhirConditionId is an EHR-side identifier, not HIPAA Safe Harbor.
  // The full case + condition snapshot lives on the
  // CaseFhirDriftLog row.
  //
  // CASE_ROUTER_RECONCILE_PROPOSED fires once per case-router run that
  // ships a proposal with action='reconcile'. Metadata: {
  // caseRouterRunId, driftLogId, optionsCount, personaVersion }. Pairs
  // with CASE_ROUTER_PROPOSED (which always fires); the auditor can
  // distinguish "a routing decision shipped" from "Cleo flagged a
  // drift that needs reconciliation."
  //
  // CASE_FHIR_DRIFT_RESOLVED fires from the accept endpoint when a
  // clinician picks a resolution option for an open drift log. The
  // case mutation + the drift-log resolution + this audit row are
  // committed inside one transaction (rule 8 — never swallowed; a
  // throw rolls the entire reconciliation back). Metadata: {
  // driftLogId, caseManagementId, resolutionKind ('reopen-case' |
  // 'open-new-case' | 'close-case' | 'attach-as-is' |
  // 'update-case-icd'), personaVersion }.
  | 'CASE_FHIR_DRIFT_DETECTED'
  | 'CASE_ROUTER_RECONCILE_PROPOSED'
  | 'CASE_FHIR_DRIFT_RESOLVED'
  // ---- Sprint 0.17: FHIR Phase D₃ — Case → Condition write-back ----
  //
  // FHIR_WRITEBACK_PROPOSED fires from the accept endpoint when a
  // mutating action lands on a writeback-enabled org (decision 10).
  // Written INSIDE the case-mutation tx so a throw rolls the
  // proposal row + the case mutation + this audit row back together.
  // Metadata: { proposalId, caseManagementId, operation, triggerKind,
  // personaVersion }. PHI-free.
  //
  // FHIR_WRITEBACK_APPROVED fires when the clinician confirms the
  // inline "Write to EHR?" dialog (`POST /api/cases/[id]/writeback/
  // approve`). Idempotent — a repeat approve on an already-approved
  // proposal still emits a single APPROVED row from the first call.
  // Metadata: { proposalId, caseManagementId, personaVersion }.
  //
  // FHIR_WRITEBACK_SUCCEEDED fires from the worker after the FHIR
  // CREATE/PATCH returns 2xx. Metadata: { proposalId, operation,
  // resultFhirId, resultFhirVersion, personaVersion }. The FHIR
  // resource id is an EHR-side identifier (not Safe Harbor PHI).
  //
  // FHIR_WRITEBACK_FAILED fires from the worker when the FHIR client
  // returns { ok: false }. Metadata: { proposalId, operation,
  // failureKind ('TRANSIENT' | 'PERMANENT' | 'CONFLICT'), status,
  // failureCount, personaVersion }. failureMessage stays on the row,
  // not the audit log, to avoid leaking sanitized HTTP error bodies
  // into the auditor query lens.
  //
  // FHIR_WRITEBACK_CANCELLED fires when (a) clinician hits Cancel,
  // (b) admin disables the org toggle (batch-cancel), or (c) the
  // worker re-checks writebackEnabled at job pickup and finds it
  // false. Metadata: { proposalId, cancelReason ('clinician' |
  // 'org_disabled' | 'worker_recheck'), personaVersion }.
  | 'FHIR_WRITEBACK_PROPOSED'
  | 'FHIR_WRITEBACK_APPROVED'
  | 'FHIR_WRITEBACK_SUCCEEDED'
  | 'FHIR_WRITEBACK_FAILED'
  | 'FHIR_WRITEBACK_CANCELLED'
  // Admin-audit cohort — toggle lifecycle on the org-settings page.
  // ORG_EHR_WRITEBACK_ENABLED + _DISABLED carry the admin user id +
  // ehrSystem. _DISABLED also carries `cancelledProposalCount`
  // because the disable action batches all PROPOSED + APPROVED rows
  // into CANCELLED.
  | 'ORG_EHR_WRITEBACK_ENABLED'
  | 'ORG_EHR_WRITEBACK_DISABLED'
  // ---- Sprint 0.18: Cleo's proactive nudges ----
  //
  // CLEO_NUDGE_PROPOSED fires from the cleo-state worker per inserted
  // row when the nudge-generator emits a candidate. Outside any
  // swallowing try-catch (rule 8). Metadata: { nudgeId, kind,
  // priority, affordanceSlug, personaVersion }. PHI-free per
  // decision 9 — the rendered label string (which can contain PHQ-9
  // values etc.) is NEVER persisted in audit metadata; the label can
  // be reconstructed from `sourcePatternSnapshotJson` at replay time
  // if needed.
  //
  // CLEO_NUDGE_SHOWN fires from the NudgeCard component's first
  // mount (decision 5 — "was it actually seen" needs the render
  // lifecycle, not the server-side projection). Endpoint is
  // idempotent — second-call no-ops via the `shownAt IS NOT NULL`
  // guard. Metadata: { nudgeId, kind, priority, surface, personaVersion }.
  //
  // CLEO_NUDGE_DISMISSED fires per dismiss-route call (one-tap UX —
  // decision 6). Metadata: { nudgeId, kind, priority, surface,
  // personaVersion }.
  //
  // CLEO_NUDGE_SNOOZED fires per snooze-route call. Metadata:
  // { nudgeId, kind, priority, snoozeUntilIso, personaVersion }.
  //
  // CLEO_NUDGE_ACTED fires per act-route call. Metadata: { nudgeId,
  // kind, priority, affordanceSlug, personaVersion }. The
  // affordanceSlug is the categorical record of WHICH path the
  // clinician chose (decision 7 — generic 'open' regresses the
  // auditor lens).
  //
  // CLEO_NUDGE_EXPIRED fires from the read-time expiry sweep
  // (loadEligibleNudgesForSurface) when the underlying pattern is
  // gone from the latest `observedPatternsJson`. Batched per call.
  // Metadata: { nudgeId, kind, priority, personaVersion }.
  | 'CLEO_NUDGE_PROPOSED'
  | 'CLEO_NUDGE_SHOWN'
  | 'CLEO_NUDGE_DISMISSED'
  | 'CLEO_NUDGE_SNOOZED'
  | 'CLEO_NUDGE_ACTED'
  | 'CLEO_NUDGE_EXPIRED'
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
  | 'ORG_EHR_CONNECTION_REMOVED'
  // ---- Unit 32: Owner console maturity (Wave 6 / Phase 61+) ----
  // ORG_SUBSCRIPTION_UPDATED captures before/after on the subscription
  // tier + notes LENGTH (notes content excluded — sales context can
  // be sensitive). Two impersonation actions both written through
  // writePlatformAuditLog so they cross-anchor: appear in the platform
  // audit log AND the per-org Transactions view. BLOCKED_MUTATION
  // fires when a route refuses a mutation during an impersonation
  // session — auditor can quantify how often the read-only gate
  // actually fires (i.e. "did the owner try to write while
  // impersonating?").
  | 'ORG_SUBSCRIPTION_UPDATED'
  | 'IMPERSONATION_BEGAN'
  | 'IMPERSONATION_ENDED'
  | 'IMPERSONATION_BLOCKED_MUTATION'
  // ---- Unit 33: Ops console ----
  | 'OPS_DASHBOARD_VIEWED'
  | 'OPS_QUEUE_DEPTH_CHECKED'
  | 'OPS_AUDIT_SEARCHED'
  | 'OPS_AUDIT_EXPORTED'
  // ---- Unit 34: Audit log enrichment depth ----
  | 'AUDIT_RETENTION_UPDATED'
  | 'AUDIT_PURGE_RUN'
  // ---- Unit 35: Per-org LLM cost rollup ----
  | 'LLM_BUDGET_UPDATED'
  // ---- Unit 36: Mobile / PWA polish ----
  | 'PWA_INSTALL_PROMPTED'
  // ---- Unit 37: Public signup + self-serve org creation ----
  | 'ORG_SELF_PROVISIONED'
  | 'USER_LOCKED'
  | 'USER_UNLOCKED'
  | 'INVITE_EXPIRED_SWEPT'
  // ---- Polish (post-Wave 6) ----
  // ROLLUP_REFRESHED fires per-org per-rollup-type per cron run when
  // the background CLI warms the OrgUsageDaily + OrgLlmCostDaily
  // caches. Metadata: rollupType ('usage' | 'llm-cost') + windowDays
  // + rowsComputed + durationMs. PHI-free (just counts). Lets the
  // auditor see "did the daily refresh actually run for org X?" without
  // hitting the cache table directly.
  | 'ROLLUP_REFRESHED'
  // ---- External context upload (per-patient prior-visit context) ----
  // Spec: context/specs/external-context-upload.md
  //
  // EXTERNAL_CONTEXT_ADDED fires per row on POST. Metadata: dateOfRecord
  // (ISO date string), source (enum value), mode ('paste' | 'upload'),
  // hasEpisodeLink (boolean). PHI-fenced: the transcript / sourceLabel /
  // file bytes are NEVER in metadata — only structural counts + enums.
  //
  // EXTERNAL_CONTEXT_VIEWED fires on the GET-detail route. Metadata:
  // hasAudio (boolean), source (enum). Captures who-saw-what for the
  // auditor lens.
  //
  // EXTERNAL_CONTEXT_TRANSCRIPTION_COMPLETED + _FAILED fire from the
  // worker. Completed metadata: durationMs (worker wall time), wordCount
  // of cleaned transcript, source enum, stub (boolean — true when
  // Soniox was in stub mode). Failed metadata: errorClass + attempt.
  | 'EXTERNAL_CONTEXT_ADDED'
  | 'EXTERNAL_CONTEXT_VIEWED'
  | 'EXTERNAL_CONTEXT_TRANSCRIPTION_COMPLETED'
  | 'EXTERNAL_CONTEXT_TRANSCRIPTION_FAILED'
  // ---- Multi-site clinician enrollment ----
  // Spec: context/specs/clinician-site-enrollment.md
  //
  // CLINICIAN_SITES_UPDATED fires when an admin replaces a clinician's
  // site enrollment via POST /api/admin/users/[id]/sites. Metadata:
  // before (siteId[]), after (siteId[]), primary (siteId | null). PHI-
  // free — just structural identifiers.
  //
  // SCHEDULE_SITE_MISMATCH_WARNED reserved for the warn-and-proceed flow
  // (UI surfaces the warning, server still records the event so
  // compliance can review the rate of cross-coverage scheduling). Not
  // yet emitted by any route in v1 since the spec opted for hard 400 on
  // POST /api/encounters / schedules — but the action is reserved here
  // so the per-org policy toggle (warn vs block) doesn't require a
  // second migration.
  | 'CLINICIAN_SITES_UPDATED'
  | 'SCHEDULE_SITE_MISMATCH_WARNED'
  // ---- Late-entry charting ----
  // Spec: context/specs/late-entry-charting.md
  //
  // NOTE_LATE_ENTRY_CREATED fires once per note when POST /api/encounters
  // marks the note as a late entry (dateOfService < today by ≥ 24 h).
  // Metadata: { noteId, dateOfService (ISO date), lateEntryDaysGap (int) }.
  // PHI-free — clinician judgment + timing only, no clinical content.
  //
  // The actual sign-event audit is the existing NOTE_SIGNED action; its
  // metadata is extended (no new action) to carry { isLateEntry,
  // lateEntryDaysGap, dateOfService } so a reviewer can prove the
  // attestation copy switch fired without joining tables.
  | 'NOTE_LATE_ENTRY_CREATED'
  // ---- Stuck PENDING_ROUTER backfill ----
  //
  // Operational backfill that resolves CaseManagement rows stuck in
  // PENDING_ROUTER while at least one of their encounters carries a
  // SIGNED/TRANSFERRED note. Sprint 0.13 Decision 3 requires routing to
  // lock at review before sign — until that's enforced server-side, a few
  // signed notes slip through and disappear from the chart (CasesPanel
  // excludes PENDING_ROUTER; the "By case" view labels them "Routing in
  // progress"). The backfill promotes each stuck case to ACTIVE with the
  // same "Uncategorized care" placeholder Sprint 0.11's migration used
  // for orphaned encounters, so it surfaces with a "Needs coding" badge
  // for a clinician to recode via the existing EditCaseDialog flow.
  //
  // CASE_BACKFILLED_FROM_PENDING_ROUTER fires once per promoted case.
  // Metadata: { caseManagementId, sweepId, signedNoteCount, prevStatus:
  // 'PENDING_ROUTER', newStatus: 'ACTIVE' }. PHI-free.
  //
  // CASE_BACKFILL_SWEEP_RUN fires once per sweep invocation (mirrors
  // EPISODE_SWEEP_RUN). Metadata: { sweepId, scanned, backfilled,
  // errors, reachedCap, dryRun }. resourceId is the literal string
  // 'sweep' (same convention as the episodes sweep).
  | 'CASE_BACKFILLED_FROM_PENDING_ROUTER'
  | 'CASE_BACKFILL_SWEEP_RUN'
  // ---- Tier 2: home AI command-panel telemetry ----
  // AI_PANEL_QUERY fires once per submission to the home `<AiCommandPanel>`
  // (mobile or desktop variant). Metadata: { pattern, commandVerb,
  // queryLength, wordCount, surface }. The CLASSIFIER (src/lib/ai-command/
  // classify.ts) returns ONLY structural shape labels + a closed enum of
  // canonical command verbs — the user-typed text is NEVER persisted.
  // Lets the admin dashboard answer "what are clinicians actually trying
  // to do with the AI panel?" without parking PHI in the audit log.
  | 'AI_PANEL_QUERY';
