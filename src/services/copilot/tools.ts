import { z } from 'zod';
import type { PatientUploadStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { assertOrgScoped } from '@/lib/phi-access';
import { isStale } from '@/lib/fhir/staleness';
import type { FinalJsonShape } from '@/lib/notes/build-artifact-prompt';
import type {
  SimplifiedAllergyIntolerance,
  SimplifiedCondition,
  SimplifiedMedicationRequest,
  SimplifiedMedicationStatement,
  SimplifiedObservation,
} from '@/services/fhir/adapters';
import {
  runCodingAnalysis,
  runDraftAddendum,
  runDraftAfterVisitSummary,
  runDraftDischargeSummary,
  runDraftGapAnalysis,
  runDraftGoalUpdate,
  runDraftOrderSet,
  runDraftPatientMessage,
  runDraftPriorAuthLetter,
  runDraftReferralFeedbackLetter,
  runDraftSchoolWorkLetter,
  runDraftTeamMessage,
  runPathwayComparison,
  runProposeFollowUpCadence,
  runSuggestReferralLetterContent,
} from './draft-tools';

/**
 * Ask-mode tools — Unit 27.
 *
 * Four read-only lookup tools the agent loop can call. Each is a pure
 * function over `(orgId, args) → result`; Prisma queries org-scoped at
 * the boundary via `assertOrgScoped` so a hallucinated id from a
 * different org gets a 403 (translated to a tool error the agent
 * surfaces to the model on the next turn).
 *
 * Rule 20 enforced inline: `lookupSignedNote` filters status IN
 * (SIGNED, TRANSFERRED) so a draft note's contents NEVER leak into a
 * model answer. The other three tools read tables (FollowUp,
 * EpisodeGoal, Patient) whose write paths already gate on attested
 * data — see the worker + sign-route audits.
 */

export type AskToolName =
  | 'lookupSignedNote'
  // List signed/transferred notes for a patient. Returns id + signedAt +
  // division + template + clinician + case linkage per note — NO content
  // (use lookupSignedNote with the id when the model wants the body).
  // Bounded by limit (default 25); optional division filter for
  // cross-division counts ("how many rehab notes does she have?").
  // Rule 20 fence: status IN (SIGNED, TRANSFERRED) only — draft notes
  // are NEVER surfaced.
  | 'listSignedNotes'
  | 'lookupFollowUp'
  | 'lookupEpisodeGoals'
  // Phase 1A — patient-scoped fan-out across all of a patient's
  // episodes. Use this when a visit has no episodeOfCare (ad-hoc /
  // one-off visits) or when the clinician asks about goals across
  // multiple concurrent episodes.
  | 'lookupPatientGoals'
  | 'lookupPatientDemographics'
  // Tier 1 — daily-driver gap fillers (sprint 0.x).
  //
  // lookupLatestMeasures — answers "what was her last BP?" / "what's
  //   her current ROM?" in one call. Sources from NoteBrief.objective
  //   Measures (extracted by the brief generator with Phase-13b
  //   measureKey registry) + SnapshotOverride (manual entries).
  // lookupPatientCases — answers "why is she here?" / "what cases?".
  //   Returns CaseManagement rows + per-case activity + open follow-up
  //   counts. Cheap; powers chart-orientation questions.
  // lookupPatientBrief — answers "catch me up". Returns the latest
  //   NoteBrief.content (chief concern, trajectory, plan, watch).
  // lookupCleoPatterns — answers "what have you noticed?". Reads this
  //   clinician's own CopilotPatientState.observedPatternsJson
  //   (sleep-mentioned-unaddressed, recert-due, goal-stalled, etc.).
  // lookupPatientEpisodes — enumerates active/recent rehab episodes.
  //   Fixes the "lookupEpisodeGoals needs an episodeId" awkwardness.
  | 'lookupLatestMeasures'
  | 'lookupPatientCases'
  | 'lookupPatientBrief'
  | 'lookupCleoPatterns'
  | 'lookupPatientEpisodes'
  // Unit 28 — FHIR-backed lookups against verified PatientFhirIdentity
  | 'lookupFhirCondition'
  | 'lookupFhirMedication'
  | 'lookupFhirObservation'
  | 'lookupFhirAllergy'
  | 'lookupFhirCarePlan'
  // Tier 3 FHIR expansion (sprint 0.x — scaffold). Mirrors existing
  // FHIR tool shape; all gated by assertFhirReadable + same per-session
  // budget. Lands the most common EHR reads clinicians ask Cleo:
  //   "did the lipid panel come back?" (DiagnosticReport)
  //   "what surgeries has she had?" (Procedure)
  //   "is she up to date on her shots?" (Immunization)
  | 'lookupFhirDiagnosticReport'
  | 'lookupFhirProcedure'
  | 'lookupFhirImmunization'
  // Tier 5 clinician-scoped reads (sprint 0.x — scaffold). Use
  // ctx.clinicianOrgUserId so Cleo answers "what notes do I owe?",
  // "what's on my schedule today?", "who do I still need to follow up
  // with?" — across all the clinician's patients, not just the one in
  // chart context.
  | 'lookupMyOpenDrafts'
  | 'lookupMySchedule'
  | 'lookupMyFollowUps'
  | 'summarizeMyDay'
  // Tier 5 patient-scoped reads (sprint 0.x — scaffold).
  | 'lookupUpcomingSchedule'
  | 'lookupPriorConversation'
  // Tier 3 — in-visit gap analysis (sprint 0.x — scaffold).
  // Compares the current draftJson sections to the transcriptClean and
  // returns a list of "said in the visit but not captured in the
  // draft" findings + a "missing-required-element" list. Pure read
  // tool (NOT a draft) — returns structured findings the model cites
  // in its answer.
  | 'analyzeDraftGapAgainstTranscript'
  // Tier 6 — coding + billing intelligence (sprint 0.x — scaffold).
  //
  // suggestCptCodes — sub-LLM analyzes a SIGNED/TRANSFERRED (or DRAFT
  //   when source-grounded) note + suggests E/M codes (99213/99214/etc.)
  //   based on the documented elements. Returns analysis; clinician
  //   decides + enters codes in the EHR. Rule 24-safe: observation
  //   only, never "you should bill X".
  // suggestIcdSpecificity — sub-LLM flags unspecified ICD codes that
  //   would map to a more specific one given the documentation
  //   (E11.9 → E11.65 when neuropathy is documented).
  // lookupBillabilityElements — deterministic checklist + sub-LLM
  //   enrichment of which CMS-required elements (HPI/ROS/PE/MDM
  //   complexity) are PRESENT vs MISSING in the note.
  // lookupCodingHistory — pure read: codes used historically for
  //   this patient (from CaseManagement + EpisodeOfCare ICD fields).
  | 'suggestCptCodes'
  | 'suggestIcdSpecificity'
  | 'lookupBillabilityElements'
  | 'lookupCodingHistory'
  // Tier 7 — patient-facing written outputs (sprint 0.x — scaffold).
  // All drafts; sub-LLM in draft-tools.ts. Each returns a DraftCard.
  | 'draftAfterVisitSummary'
  | 'draftSchoolWorkLetter'
  | 'draftPriorAuthLetter'
  | 'draftDischargeSummary'
  | 'draftReferralFeedbackLetter'
  // Tier 8 — voice / recording awareness (sprint 0.x — scaffold).
  // The unique-to-a-scribe-product capability: Cleo can know what's
  // being recorded right now + reach into the last N seconds of
  // transcript without re-asking the clinician.
  | 'lookupRecordingStatus'
  | 'lookupRecentTranscript'
  // Tier 9 — compliance + audit helper (sprint 0.x — scaffold).
  // Reads AuditLog (PHI-free metadata only). For the compliance-officer
  // lens + the "did consent get captured?" answer.
  | 'auditPhiAccessForPatient'
  | 'lookupRequiredFormStatus'
  | 'lookupCompletenessFlags'
  // Tier 10 — cross-patient analytics / "panel intelligence" (sprint 0.x).
  // All scoped to ctx.clinicianOrgUserId so a clinician sees only HER
  // panel. Rule 20 fenced — reads only signed notes / cases / episodes.
  | 'lookupMyPatientsWithCondition'
  | 'lookupMyOverdueRecerts'
  | 'lookupMyOpenFollowUpsByPatient'
  | 'summarizeMyWeekDone'
  // Tier 11 — learning + calibration (sprint 0.x — scaffold).
  // Reads COPILOT_DRAFT_CONFIRMED / DISCARDED audit history so Cleo
  // can self-report her own accept rate + flag her own weak spots.
  | 'lookupMyAcceptRate'
  | 'lookupCommonClinicianEdits'
  // ===== Sprint 0.19 — Tier 12: Care Pathway library =====
  //
  // lookupAvailablePathways({division?}) — enumerates the org's
  //   adopted pathways. Cleo opens with this when the clinician asks
  //   "what pathways do we have for HTN?" or "what protocols do we follow?".
  // lookupCarePathway({pathwayId | primaryIcd}) — returns the full
  //   pathway + ordered steps + required documentation elements per
  //   step. Cleo uses this to teach OR to compare against a draft.
  // compareDocumentationToPathway({noteId, pathwayId?}) — sub-LLM
  //   reads the note + matches sections against the pathway's
  //   requiredElementsJson; returns per-step PRESENT/PARTIAL/MISSING
  //   findings. Rule 24-safe: observation only.
  | 'lookupAvailablePathways'
  | 'lookupCarePathway'
  | 'compareDocumentationToPathway'
  // ===== Sprint 0.19 — Tier 13: Multimedia intake =====
  //
  // lookupPatientUploads({patientId, kind?, includeExtracted?}) —
  //   enumerates non-deleted PatientUpload rows for this patient.
  //   Default returns only metadata; pass includeExtracted to also
  //   surface the extractedJson + ocrText.
  // lookupUploadFindings({uploadId}) — returns the EXTRACTED state +
  //   structured findings for one upload. Fails closed when the row
  //   is still extracting or extraction failed.
  | 'lookupPatientUploads'
  | 'lookupUploadFindings'
  // ===== Sprint 0.19 — Tier 14: Internal team coordination =====
  //
  // lookupCareTeam({patientId}) — returns the set of clinicians who
  //   have touched this patient (authored signed notes, owned cases,
  //   resolved follow-ups). Powers "who should I notify?".
  // lookupTeamMessages({patientId?, direction?: 'inbox'|'sent', limit?})
  //   — reads InternalPatientMessage rows for the viewing clinician.
  // draftTeamMessage({patientId, recipientOrgUserId, topic, contextHref?})
  //   — sub-LLM produces a short message body grounded in the patient's
  //   latest signed note. Returns a draft the clinician reviews +
  //   sends. NO autonomous send (rule 24).
  | 'lookupCareTeam'
  | 'lookupTeamMessages'
  | 'draftTeamMessage'
  // Unit 30 — Action tools (drafts). Chart-mode only; each runs a
  // sub-LLM call to produce a draft the clinician reviews + accepts /
  // edits / discards. NO autonomous effects.
  | 'draftPatientMessage'
  | 'proposeFollowUpCadence'
  | 'suggestReferralLetterContent'
  // Tier 4 drafts (sprint 0.x — scaffold).
  | 'draftAddendum'
  | 'draftGoalUpdate'
  | 'draftOrderSet';

export type AskSource = {
  /** 'fhir' added in Unit 28; 'literature' added in Unit 29; 'llm-intrinsic'
   *  added in Phase 1B for the research-mode LLM-knowledge fallback —
   *  rendered as a yellow chip + accompanied by a yellow "LLM knowledge"
   *  badge above the bubble so the clinician sees the trust signal twice.
   *  Chart mode never produces an llm-intrinsic source (fail-closed via
   *  the agent's wrong_mode_fallback gate). */
  kind: 'note' | 'follow-up' | 'goal' | 'patient' | 'fhir' | 'literature' | 'llm-intrinsic';
  id: string;
  label: string;
};

/**
 * Unit 30 — Draft type union. Produced by the 3 action tools; rides
 * alongside the assistant message in the chat surface as a DraftCard
 * with Accept / Edit / Discard. No autonomous side effects — confirm
 * + discard are explicit clinician actions auditied separately from
 * the agent's PROPOSED audit.
 */
export type DraftKind =
  | 'patient-message'
  | 'followup-cadence'
  | 'referral-letter'
  // Tier 4 drafts (sprint 0.x — scaffold).
  // addendum — post-sign supplementary text. Never modifies the signed
  //   note's finalJson (rule 3); persistence path lands as a sibling
  //   NoteArtifact when the clinician accepts.
  // goal-update — proposes a measure/status update on a single
  //   EpisodeGoal. Persistence path writes a GoalProgressEntry on
  //   accept.
  // order-set — suggests a standard order set (labs / imaging /
  //   referrals / handouts) tied to a condition. v1 returns free-text
  //   suggestions; no FHIR write-back.
  | 'addendum'
  | 'goal-update'
  | 'order-set'
  // Tier 7 drafts (sprint 0.x — scaffold). Patient-facing + payer-facing
  // written outputs. All persist as NoteArtifact-style siblings (UI
  // wire-up TODO).
  | 'after-visit-summary'
  | 'school-work-letter'
  | 'prior-auth-letter'
  | 'discharge-summary'
  | 'referral-feedback-letter'
  // Sprint 0.19 — Tier 14 internal team message draft.
  | 'team-message';

export type Draft = {
  /** Client-generated UUID-ish, stable across edits within a session. */
  draftId: string;
  kind: DraftKind;
  /** Editable text — the clinician's final-version-after-edits is what
   *  the confirm endpoint persists / copies. */
  content: string;
  /** Kind-specific structured fields the DraftCard renders alongside
   *  the editable text. PHI-fenced at the audit layer (metadata never
   *  includes meta contents). */
  meta: Record<string, unknown>;
};

// =====================================================================
// Per-tool arg schemas — Zod parses unknown JSON from the model.
// =====================================================================

const lookupSignedNoteArgs = z.object({
  noteId: z.string().min(1).max(64),
});

const listSignedNotesArgs = z.object({
  patientId: z.string().min(1).max(64),
  /** Optional filter: MEDICAL / REHAB / BEHAVIORAL_HEALTH / MULTI.
   *  Lets the model answer "how many rehab notes does this patient have?"
   *  without scanning every note. */
  division: z.enum(['MEDICAL', 'REHAB', 'BEHAVIORAL_HEALTH', 'MULTI']).optional(),
  /** Capped at 50 to keep prompt tokens bounded; default 25 is plenty
   *  for "give me a count" and most "what's the latest" questions. */
  limit: z.number().int().min(1).max(50).optional(),
});

// Tier 1 arg schemas.

const lookupLatestMeasuresArgs = z.object({
  patientId: z.string().min(1).max(64),
  /** Optional measureKey filter (Phase-13b registry: 'bp', 'pain-nrs',
   *  'rom-primary', 'gait-speed', 'phq9-total', etc.). When omitted,
   *  returns every measure surfaced in the patient's most recent brief
   *  + any active manual override. */
  measureKey: z.string().min(1).max(40).optional(),
});

const lookupPatientCasesArgs = z.object({
  patientId: z.string().min(1).max(64),
  /** Filter by case status. Defaults to ACTIVE (the common "what are
   *  we managing right now?" question). Pass 'CLOSED' for history. */
  status: z.enum(['ACTIVE', 'CLOSED', 'CANCELLED', 'PENDING_ROUTER']).optional(),
});

const lookupPatientBriefArgs = z.object({
  patientId: z.string().min(1).max(64),
  /** Optional — when set, returns the most recent brief that was scoped
   *  to that episode (rehab arc focus). When omitted, returns the most
   *  recent brief for the patient regardless of scope. */
  episodeId: z.string().min(1).max(64).optional(),
});

const lookupCleoPatternsArgs = z.object({
  patientId: z.string().min(1).max(64),
});

const lookupPatientEpisodesArgs = z.object({
  patientId: z.string().min(1).max(64),
  /** Filter by EpisodeStatus. Defaults to ACTIVE + RECERT_DUE (the
   *  "live" episodes a clinician cares about). Pass 'DISCHARGED' for
   *  closed arcs. */
  status: z.enum(['ACTIVE', 'RECERT_DUE', 'DISCHARGED', 'CANCELLED']).optional(),
});

// Tier 3 — gap analysis (sub-LLM compares draftJson to transcriptClean).
const analyzeDraftGapArgs = z.object({
  noteId: z.string().min(1).max(64),
});

// Tier 3 — FHIR expansion (same arg shape as existing FHIR tools).
const lookupFhirDiagnosticReportArgs = z.object({
  patientId: z.string().min(1).max(64),
  /** Optional LOINC / category filter the model can pass. */
  category: z.string().min(1).max(40).optional(),
});
const lookupFhirProcedureArgs = z.object({
  patientId: z.string().min(1).max(64),
  status: z.string().min(1).max(40).optional(),
});
const lookupFhirImmunizationArgs = z.object({
  patientId: z.string().min(1).max(64),
});

// Tier 5 — clinician-scoped reads.
const lookupMyOpenDraftsArgs = z.object({
  /** Cap on rows returned. Bounded so even a busy provider with 30
   *  open drafts doesn't blow the prompt budget. */
  limit: z.number().int().min(1).max(50).optional(),
});
const lookupMyScheduleArgs = z.object({
  /** ISO date (YYYY-MM-DD). Defaults to today. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const lookupMyFollowUpsArgs = z.object({
  status: z.enum(['OPEN', 'MET', 'CARRIED', 'DROPPED', 'CLOSED_BY_DISCHARGE']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
const summarizeMyDayArgs = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

// Tier 5 — patient-scoped reads.
const lookupUpcomingScheduleArgs = z.object({
  patientId: z.string().min(1).max(64),
  /** Look-ahead horizon in days (default 30). */
  horizonDays: z.number().int().min(1).max(180).optional(),
});
const lookupPriorConversationArgs = z.object({
  patientId: z.string().min(1).max(64),
  /** Recent message turns to return (default 30, cap 100). */
  limit: z.number().int().min(1).max(100).optional(),
});

// Tier 4 — draft tool arg schemas.
const draftAddendumArgs = z.object({
  /** A SIGNED or TRANSFERRED note that the addendum extends. */
  noteId: z.string().min(1).max(64),
  /** What the addendum should cover. Free-text. */
  topic: z.string().min(1).max(200),
});
const draftGoalUpdateArgs = z.object({
  episodeId: z.string().min(1).max(64),
  goalId: z.string().min(1).max(64),
  /** New measure value (e.g. "118° flexion"). Free-text — the goal
   *  protocol decides parsing. */
  newMeasureValue: z.string().min(1).max(120).optional(),
  /** Optional status transition. */
  newStatus: z.enum(['ACTIVE', 'MET', 'NOT_MET', 'MODIFIED', 'DISCONTINUED', 'PARTIALLY_MET']).optional(),
  /** Free-text rationale the model attaches as delta note. */
  rationale: z.string().min(1).max(200).optional(),
});
const draftOrderSetArgs = z.object({
  patientId: z.string().min(1).max(64),
  /** Condition / chief complaint to anchor the order set
   *  (e.g. "HTN follow-up", "annual wellness", "low-back pain"). */
  condition: z.string().min(1).max(120),
});

// ----------- Tier 6 — coding + billing --------------------------------
const suggestCptCodesArgs = z.object({
  noteId: z.string().min(1).max(64),
  /** Optional payer hint biases the suggestion ('medicare', 'medicaid',
   *  'commercial') — different E/M scoring rules apply. v1 forwards as
   *  a hint to the sub-LLM; no payer-specific rule engine yet. */
  payerType: z.string().min(1).max(40).optional(),
});
const suggestIcdSpecificityArgs = z.object({
  noteId: z.string().min(1).max(64),
});
const lookupBillabilityElementsArgs = z.object({
  noteId: z.string().min(1).max(64),
});
const lookupCodingHistoryArgs = z.object({
  patientId: z.string().min(1).max(64),
  /** Optional ICD filter — "how often have we coded E11.9 for her?". */
  icd: z.string().min(1).max(16).optional(),
});

// ----------- Tier 7 — patient-facing letter drafts --------------------
const draftAfterVisitSummaryArgs = z.object({
  noteId: z.string().min(1).max(64),
});
const draftSchoolWorkLetterArgs = z.object({
  patientId: z.string().min(1).max(64),
  /** Free-text restrictions ("no PE 2 weeks", "limited lifting > 10 lb"). */
  restrictions: z.string().min(1).max(400),
  /** Duration of restriction in days. */
  durationDays: z.number().int().min(1).max(365),
  /** Audience: 'school' (notes class) or 'work' (notes employer). */
  audience: z.enum(['school', 'work']),
});
const draftPriorAuthLetterArgs = z.object({
  patientId: z.string().min(1).max(64),
  /** What the auth is for ("MRI lumbar spine", "tirzepatide 5mg weekly"). */
  treatment: z.string().min(1).max(200),
  /** The clinical reason / condition (free-text). */
  condition: z.string().min(1).max(200),
});
const draftDischargeSummaryArgs = z.object({
  episodeId: z.string().min(1).max(64),
});
const draftReferralFeedbackLetterArgs = z.object({
  noteId: z.string().min(1).max(64),
  /** The original referring clinician / clinic name. */
  recipient: z.string().min(1).max(120),
});

// ----------- Tier 8 — voice / recording awareness ---------------------
const lookupRecordingStatusArgs = z.object({
  noteId: z.string().min(1).max(64),
});
const lookupRecentTranscriptArgs = z.object({
  noteId: z.string().min(1).max(64),
  /** How many seconds back from now to surface. Bounded so the agent
   *  prompt stays cheap. Default 120 s; max 600 s (10 min). */
  lastSeconds: z.number().int().min(5).max(600).optional(),
});

// ----------- Tier 9 — compliance + audit helper -----------------------
const auditPhiAccessForPatientArgs = z.object({
  patientId: z.string().min(1).max(64),
  /** ISO date floor; defaults to 30 days ago. */
  fromIso: z.string().datetime().optional(),
  /** ISO date ceiling; defaults to now. */
  toIso: z.string().datetime().optional(),
  /** Cap on rows returned. Bounded for prompt size. */
  limit: z.number().int().min(1).max(100).optional(),
});
const lookupRequiredFormStatusArgs = z.object({
  patientId: z.string().min(1).max(64),
});
const lookupCompletenessFlagsArgs = z.object({
  noteId: z.string().min(1).max(64),
});

// ----------- Tier 10 — cross-patient analytics ------------------------
const lookupMyPatientsWithConditionArgs = z.object({
  /** ICD-10 code to filter case-managements by. Loose prefix match. */
  icd: z.string().min(1).max(16),
  /** Optional case status filter. Defaults to ACTIVE. */
  status: z.enum(['ACTIVE', 'CLOSED', 'CANCELLED', 'PENDING_ROUTER']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
const lookupMyOverdueRecertsArgs = z.object({
  /** Look-ahead horizon in days (default 14). Episodes with recertDueAt
   *  earlier than now+horizonDays fire. */
  horizonDays: z.number().int().min(1).max(90).optional(),
});
const lookupMyOpenFollowUpsByPatientArgs = z.object({
  limit: z.number().int().min(1).max(50).optional(),
});
const summarizeMyWeekDoneArgs = z.object({
  /** ISO date (YYYY-MM-DD). Defaults to today. The week is the 7 days
   *  ending on this date. */
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

// ----------- Tier 11 — learning + calibration -------------------------
const lookupMyAcceptRateArgs = z.object({
  /** How far back to compute the rate over (days). Default 30. */
  windowDays: z.number().int().min(1).max(180).optional(),
  /** Optional filter by DraftKind for finer granularity. */
  kind: z
    .enum([
      'patient-message',
      'followup-cadence',
      'referral-letter',
      'addendum',
      'goal-update',
      'order-set',
      'after-visit-summary',
      'school-work-letter',
      'prior-auth-letter',
      'discharge-summary',
      'referral-feedback-letter',
    ])
    .optional(),
});
const lookupCommonClinicianEditsArgs = z.object({
  /** Cap on edit-events returned for analysis. */
  limit: z.number().int().min(1).max(50).optional(),
});

// ----------- Tier 12 — Care Pathway library ---------------------------
const lookupAvailablePathwaysArgs = z.object({
  division: z.enum(['MEDICAL', 'REHAB', 'BEHAVIORAL_HEALTH', 'MULTI']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
const lookupCarePathwayArgs = z
  .object({
    pathwayId: z.string().min(1).max(64).optional(),
    /** Loose-prefix ICD-10 match (e.g. 'E11' matches all T2DM sub-codes). */
    primaryIcd: z.string().min(1).max(16).optional(),
  })
  .refine((v) => !!v.pathwayId || !!v.primaryIcd, {
    message: 'pathwayId_or_primaryIcd_required',
  });
const compareDocumentationToPathwayArgs = z
  .object({
    noteId: z.string().min(1).max(64),
    pathwayId: z.string().min(1).max(64).optional(),
    /** When pathwayId is omitted, the route resolves the patient's
     *  active CaseManagement primary ICD and looks up the matching
     *  pathway. */
  })
  .refine((v) => !!v.noteId, { message: 'noteId_required' });

// ----------- Tier 13 — Multimedia intake ------------------------------
const lookupPatientUploadsArgs = z.object({
  patientId: z.string().min(1).max(64),
  kind: z
    .enum(['MED_LIST', 'LAB_REPORT', 'IMAGING_REPORT', 'INSURANCE_CARD', 'ID_CARD', 'OUTSIDE_RECORDS', 'OTHER'])
    .optional(),
  /** When true, the response payload also includes ocrText + extractedJson.
   *  Defaults to false to keep prompt-size predictable. */
  includeExtracted: z.boolean().optional(),
  /** Rule 20 — defaults to 'attested_only' so Cleo never surfaces raw OCR
   *  the clinician hasn't sanctioned. Opt-ins:
   *    - 'reviewable' includes EXTRACTED + MANUAL_ONLY (the awaiting-
   *      review cohort) for triage-style questions ("anything still
   *      sitting in my inbox to accept?").
   *    - 'all' includes REJECTED + processing + failed states for
   *      pipeline introspection only. */
  statusFilter: z.enum(['attested_only', 'reviewable', 'all']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
const lookupUploadFindingsArgs = z.object({
  uploadId: z.string().min(1).max(64),
});

// ----------- Tier 14 — Internal team coordination ---------------------
const lookupCareTeamArgs = z.object({
  patientId: z.string().min(1).max(64),
});
const lookupTeamMessagesArgs = z.object({
  patientId: z.string().min(1).max(64).optional(),
  direction: z.enum(['inbox', 'sent']).optional(),
  status: z.enum(['SENT', 'READ', 'ARCHIVED']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
const draftTeamMessageArgs = z.object({
  patientId: z.string().min(1).max(64),
  recipientOrgUserId: z.string().min(1).max(64),
  topic: z.string().min(1).max(120),
  /** Optional: deep-link to anchor the conversation back to a specific
   *  context. Validated same-origin + same-orgId on send. */
  contextHref: z.string().min(1).max(500).optional(),
  /** Optional: free-text starter the clinician already has in mind.
   *  The sub-LLM uses it as a hint + grounds against the latest signed
   *  note. */
  bodyHint: z.string().min(1).max(400).optional(),
  urgency: z.enum(['LOW', 'NORMAL', 'URGENT']).optional(),
});

const lookupFollowUpArgs = z.object({
  patientId: z.string().min(1).max(64),
  status: z.enum(['OPEN', 'MET', 'CARRIED', 'DROPPED', 'CLOSED_BY_DISCHARGE']).optional(),
});

const lookupEpisodeGoalsArgs = z.object({
  episodeId: z.string().min(1).max(64),
});

const lookupPatientGoalsArgs = z.object({
  patientId: z.string().min(1).max(64),
});

const lookupPatientDemographicsArgs = z.object({
  patientId: z.string().min(1).max(64),
});

// Unit 28 — FHIR tool arg schemas. patientId comes from agent context;
// the agent should always pass it. Optional filters surface common
// model-facing refinements (active conditions, active meds, specific
// LOINC code).

const lookupFhirConditionArgs = z.object({
  patientId: z.string().min(1).max(64),
  clinicalStatus: z.string().min(1).max(40).optional(),
});

const lookupFhirMedicationArgs = z.object({
  patientId: z.string().min(1).max(64),
  status: z.string().min(1).max(40).optional(),
});

const lookupFhirObservationArgs = z.object({
  patientId: z.string().min(1).max(64),
  code: z.string().min(1).max(40).optional(),
});

const lookupFhirAllergyArgs = z.object({
  patientId: z.string().min(1).max(64),
});

const lookupFhirCarePlanArgs = z.object({
  patientId: z.string().min(1).max(64),
});

// Unit 30 — draft tool arg schemas. All chart-mode; topic/specialty/
// reason/basis are model-supplied free-text that gets piped into the
// sub-LLM prompt.

const draftPatientMessageArgs = z.object({
  patientId: z.string().min(1).max(64),
  topic: z.string().min(1).max(200),
});

const proposeFollowUpCadenceArgs = z.object({
  patientId: z.string().min(1).max(64),
  basis: z.string().min(1).max(200),
});

const suggestReferralLetterContentArgs = z.object({
  patientId: z.string().min(1).max(64),
  specialty: z.string().min(1).max(80),
  reason: z.string().min(1).max(200),
});

// =====================================================================
// Tool runner — dispatches by name, parses + executes
// =====================================================================

const EHR_SYSTEM = 'nextgen';
const FHIR_PER_TOOL_CAP = 20;
export const MAX_FHIR_ROWS_PER_SESSION = 100;

export type ToolContext = {
  orgId: string;
  /** Unit 28 — per-session FHIR row budget. Mutated by ref so each
   *  FHIR tool can increment after a successful fetch. Initialized
   *  to { count: 0 } by `runAgent`. */
  fhirRowsConsumed?: { count: number };
  /** Sprint 0.x — set by `runAgent` so `lookupCleoPatterns` (and any
   *  future per-clinician memory tool) can look up the right state
   *  row. Optional so research-mode + bare tests keep working. */
  clinicianOrgUserId?: string | null;
};

/** Pre-flight for every FHIR tool: org-scope the patient + require a
 *  'verified' PatientFhirIdentity + check the rate-limit budget.
 *  Returns the link row on success so the tool can use its noteId or
 *  patient id without an extra round-trip. */
async function assertFhirReadable(
  patientId: string,
  ctx: ToolContext,
): Promise<{ ok: true } | ToolResult> {
  if ((ctx.fhirRowsConsumed?.count ?? 0) >= MAX_FHIR_ROWS_PER_SESSION) {
    return { ok: false, error: 'fhir_rate_limit_exceeded' };
  }
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true, orgId: true },
  });
  if (!patient) return { ok: false, error: 'patient_not_found' };
  assertOrgScoped(patient.orgId, ctx.orgId);
  const link = await prisma.patientFhirIdentity.findFirst({
    where: { patientId, ehrSystem: EHR_SYSTEM, matchConfidence: 'verified' },
  });
  if (!link) return { ok: false, error: 'verified_link_required' };
  return { ok: true };
}

function chargeFhirBudget(ctx: ToolContext, rowCount: number): void {
  if (ctx.fhirRowsConsumed) ctx.fhirRowsConsumed.count += rowCount;
}

/** Load fresh (non-stale) FhirCachedResource rows for a (patient,
 *  resourceType) tuple. Stale rows (>7d, Unit 21 isStale) are
 *  excluded — same staleness rule the brief enrichment honors. */
async function loadFreshFhirRows(patientId: string, resourceType: string) {
  const rows = await prisma.fhirCachedResource.findMany({
    where: { patientId, ehrSystem: EHR_SYSTEM, resourceType },
    orderBy: { fetchedAt: 'desc' },
  });
  const now = new Date();
  return rows.filter((r) => !isStale(r.fetchedAt, now));
}

export type ToolResult =
  | { ok: true; data: unknown; rowCount: number }
  | { ok: false; error: string };

/**
 * Tier 6/9 helper — collapses the structured FinalJsonShape into a
 * flat `{ section: string; content: string }[]` blob the coding/
 * billability sub-LLM operates on. Reads finalJson (signed notes) or
 * draftJson (active drafts in /review) interchangeably. Returns null
 * when neither side has content.
 */
function extractSectionsBlob(note: {
  finalJson: unknown;
  draftJson: unknown;
  status: string;
}): Array<{ section: string; content: string }> | null {
  const source = (note.finalJson ?? note.draftJson) as FinalJsonShape | null;
  if (!source?.sections?.length) return null;
  const flat = source.sections
    .map((s) => ({
      section: s.label ?? s.id ?? 'section',
      content: typeof s.content === 'string' ? s.content.trim() : '',
    }))
    .filter((s) => s.content.length > 0);
  return flat.length ? flat : null;
}

export async function runTool(
  name: string,
  argsRaw: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'lookupSignedNote': {
        const args = lookupSignedNoteArgs.parse(argsRaw);
        const note = await prisma.note.findUnique({
          where: { id: args.noteId },
          select: {
            id: true,
            orgId: true,
            status: true,
            signedAt: true,
            finalJson: true,
            clinicianOrgUserId: true,
          },
        });
        if (!note) return { ok: false, error: 'note_not_found' };
        assertOrgScoped(note.orgId, ctx.orgId);
        if (note.status !== 'SIGNED' && note.status !== 'TRANSFERRED') {
          return { ok: false, error: 'note_not_attested' };
        }
        const finalJson = note.finalJson as unknown as FinalJsonShape | null;
        return {
          ok: true,
          rowCount: finalJson?.sections.length ?? 0,
          data: {
            noteId: note.id,
            signedAt: note.signedAt?.toISOString() ?? null,
            sections: finalJson?.sections.map((s) => ({
              label: s.label,
              content: s.content,
            })) ?? [],
          },
        };
      }

      case 'listSignedNotes': {
        // Enumerate signed/transferred notes for a patient so the model
        // can answer "how many rehab notes does she have?" + "what's
        // the latest signed visit?" without needing a specific noteId
        // up front. Returns lightweight projection only (id + signedAt
        // + division + template + clinician + case linkage) — NEVER
        // section bodies. The model must call `lookupSignedNote` with
        // an id from this list if it wants the actual content.
        //
        // Rule 20 fence: status IN (SIGNED, TRANSFERRED) only — drafts
        // never inform Cleo. Org-scoped at the query layer.
        const args = listSignedNotesArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: { id: true, orgId: true },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);

        const limit = args.limit ?? 25;
        const rows = await prisma.note.findMany({
          where: {
            patientId: args.patientId,
            orgId: ctx.orgId,
            status: { in: ['SIGNED', 'TRANSFERRED'] },
            ...(args.division ? { division: args.division } : {}),
          },
          orderBy: { signedAt: 'desc' },
          take: limit,
          select: {
            id: true,
            signedAt: true,
            division: true,
            clinicianOrgUserId: true,
            template: { select: { name: true } },
            encounter: {
              select: {
                caseManagementId: true,
                episodeOfCareId: true,
              },
            },
          },
        });

        // Optional second query to surface the per-division counts when
        // the model asked unfiltered — answers "how many of each?" in
        // one tool call without a second turn. Cheap groupBy; bounded
        // by the same patient scope.
        const totals = args.division
          ? null
          : await prisma.note.groupBy({
              by: ['division'],
              where: {
                patientId: args.patientId,
                orgId: ctx.orgId,
                status: { in: ['SIGNED', 'TRANSFERRED'] },
              },
              _count: { _all: true },
            });

        return {
          ok: true,
          rowCount: rows.length,
          data: {
            notes: rows.map((n) => ({
              noteId: n.id,
              signedAt: n.signedAt?.toISOString() ?? null,
              division: n.division,
              templateName: n.template?.name ?? null,
              clinicianOrgUserId: n.clinicianOrgUserId,
              caseManagementId: n.encounter?.caseManagementId ?? null,
              episodeOfCareId: n.encounter?.episodeOfCareId ?? null,
            })),
            ...(totals
              ? {
                  totalsByDivision: totals.reduce<Record<string, number>>(
                    (acc, t) => {
                      acc[t.division] = t._count._all;
                      return acc;
                    },
                    {},
                  ),
                }
              : {}),
            limit,
            truncated: rows.length === limit,
          },
        };
      }

      case 'lookupFollowUp': {
        const args = lookupFollowUpArgs.parse(argsRaw);
        const rows = await prisma.followUp.findMany({
          where: {
            orgId: ctx.orgId,
            patientId: args.patientId,
            ...(args.status ? { status: args.status } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            originNote: { select: { id: true, signedAt: true } },
          },
        });
        return {
          ok: true,
          rowCount: rows.length,
          data: rows.map((fu) => ({
            id: fu.id,
            text: fu.text,
            status: fu.status,
            originNoteId: fu.originNoteId,
            createdAt: fu.createdAt.toISOString(),
          })),
        };
      }

      case 'lookupEpisodeGoals': {
        const args = lookupEpisodeGoalsArgs.parse(argsRaw);
        const episode = await prisma.episodeOfCare.findUnique({
          where: { id: args.episodeId },
          select: { id: true, orgId: true },
        });
        if (!episode) return { ok: false, error: 'episode_not_found' };
        assertOrgScoped(episode.orgId, ctx.orgId);
        const goals = await prisma.episodeGoal.findMany({
          where: {
            episodeId: args.episodeId,
            status: { in: ['ACTIVE', 'PARTIALLY_MET'] },
          },
          orderBy: { createdAt: 'asc' },
        });
        return {
          ok: true,
          rowCount: goals.length,
          data: goals.map((g) => ({
            id: g.id,
            text: g.goalText,
            status: g.status,
            type: g.goalType,
            currentMeasure: g.currentMeasure,
            targetMeasure: g.targetMeasure,
          })),
        };
      }

      // Phase 1A — patient-scoped goal fan-out. Solves the ad-hoc-visit
      // case where note.encounter.episodeOfCareId === null, so the
      // model has no episodeId to pass to lookupEpisodeGoals and
      // otherwise exhausts its iteration budget retrying.
      case 'lookupPatientGoals': {
        const args = lookupPatientGoalsArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: { id: true, orgId: true },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);
        const episodes = await prisma.episodeOfCare.findMany({
          where: { patientId: args.patientId, orgId: ctx.orgId },
          select: { id: true, diagnosis: true },
        });
        if (episodes.length === 0) {
          return { ok: true, rowCount: 0, data: { goals: [] } };
        }
        const episodeById = new Map(episodes.map((e) => [e.id, e]));
        const goals = await prisma.episodeGoal.findMany({
          where: {
            episodeId: { in: episodes.map((e) => e.id) },
            status: { in: ['ACTIVE', 'PARTIALLY_MET'] },
          },
          orderBy: { createdAt: 'asc' },
          take: 20,
        });
        return {
          ok: true,
          rowCount: goals.length,
          data: {
            goals: goals.map((g) => ({
              id: g.id,
              text: g.goalText,
              status: g.status,
              type: g.goalType,
              currentMeasure: g.currentMeasure,
              targetMeasure: g.targetMeasure,
              episodeId: g.episodeId,
              episodeDiagnosis: episodeById.get(g.episodeId)?.diagnosis ?? null,
            })),
          },
        };
      }

      case 'lookupPatientDemographics': {
        const args = lookupPatientDemographicsArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: {
            id: true,
            orgId: true,
            firstName: true,
            lastName: true,
            dob: true,
            sex: true,
            mrn: true,
            preferredLanguage: true,
          },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);
        return {
          ok: true,
          rowCount: 1,
          data: {
            id: patient.id,
            firstName: patient.firstName,
            lastName: patient.lastName,
            dob: patient.dob.toISOString().slice(0, 10),
            sex: patient.sex,
            mrn: patient.mrn,
            preferredLanguage: patient.preferredLanguage,
          },
        };
      }

      // ===== Tier 1 — daily-driver gap fillers ========================

      case 'lookupLatestMeasures': {
        // "What was her last BP?" / "What's her current ROM?" — answered
        // in ONE call. Two sources, merged with manual overrides winning:
        //   1. NoteBrief.objectiveMeasures from the most-recent brief
        //      (extracted by the brief generator with Phase-13b measureKey
        //      registry: bp / pain-nrs / rom-primary / gait-speed / etc.).
        //   2. SnapshotOverride rows (manual clinician entries that
        //      override the extracted value — recorded via the snapshot
        //      strip's edit affordance).
        // Returns one entry per measureKey, sorted by recordedAt desc.
        // Rule 20: extracted values come from a signed Note via NoteBrief;
        // manual overrides are clinician-attested rows.
        const args = lookupLatestMeasuresArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: { id: true, orgId: true },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);

        const brief = await prisma.noteBrief.findFirst({
          where: { patientId: args.patientId, orgId: ctx.orgId },
          orderBy: { generatedAt: 'desc' },
          select: {
            noteId: true,
            generatedAt: true,
            content: true,
          },
        });
        const overrides = await prisma.snapshotOverride.findMany({
          where: {
            patientId: args.patientId,
            orgId: ctx.orgId,
            supersededAt: null,
          },
          select: {
            id: true,
            measureKey: true,
            valueJson: true,
            unit: true,
            recordedAt: true,
            enteredByOrgUserId: true,
          },
          orderBy: { recordedAt: 'desc' },
        });

        type MeasureEntry = {
          measureKey: string | null;
          measure: string;
          unit: string | null;
          value: string;
          trend: string | null;
          recordedAt: string;
          source: 'extracted' | 'manual';
          sourceNoteId?: string;
          sourceOverrideId?: string;
        };
        const byKey = new Map<string, MeasureEntry>();

        // Layer 1: extracted measures from the latest brief.
        const briefContent = brief?.content as
          | {
              objectiveMeasures?: Array<{
                measure: string;
                lastValue: string;
                unit: string | null;
                trend?: string;
                sourceNoteId: string;
                measureKey?: string | null;
              }>;
            }
          | null;
        const briefDateIso = brief?.generatedAt.toISOString() ?? null;
        for (const m of briefContent?.objectiveMeasures ?? []) {
          const key = m.measureKey ?? `__legacy:${m.measure.toLowerCase()}`;
          byKey.set(key, {
            measureKey: m.measureKey ?? null,
            measure: m.measure,
            unit: m.unit,
            value: m.lastValue,
            trend: m.trend ?? null,
            recordedAt: briefDateIso ?? new Date().toISOString(),
            source: 'extracted',
            sourceNoteId: m.sourceNoteId,
          });
        }

        // Layer 2: manual overrides win (clinician-attested + newer).
        for (const o of overrides) {
          const valueRendered =
            typeof o.valueJson === 'string'
              ? o.valueJson
              : JSON.stringify(o.valueJson);
          byKey.set(o.measureKey, {
            measureKey: o.measureKey,
            measure: o.measureKey,
            unit: o.unit,
            value: valueRendered,
            trend: null,
            recordedAt: o.recordedAt.toISOString(),
            source: 'manual',
            sourceOverrideId: o.id,
          });
        }

        let entries = Array.from(byKey.values());
        if (args.measureKey) {
          entries = entries.filter(
            (e) =>
              e.measureKey === args.measureKey ||
              e.measure.toLowerCase() === args.measureKey!.toLowerCase(),
          );
        }
        entries.sort(
          (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
        );

        return {
          ok: true,
          rowCount: entries.length,
          data: {
            measures: entries,
            briefId: brief ? brief.noteId : null,
            briefGeneratedAt: briefDateIso,
          },
        };
      }

      case 'lookupPatientCases': {
        // "Why is she here?" / "What problems are we managing?" — the
        // most common chart-orientation question. Returns CaseManagement
        // rows with primary/secondary ICD + status + a per-case projection
        // of active episodes, total signed visits, and open follow-up
        // count. Cheap; powers the "give me the lay of the land" answer.
        const args = lookupPatientCasesArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: { id: true, orgId: true },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);

        const cases = await prisma.caseManagement.findMany({
          where: {
            patientId: args.patientId,
            orgId: ctx.orgId,
            ...(args.status ? { status: args.status } : { status: 'ACTIVE' }),
          },
          orderBy: { openedAt: 'desc' },
          select: {
            id: true,
            primaryIcd: true,
            primaryIcdLabel: true,
            secondaryIcd: true,
            secondaryIcdLabel: true,
            status: true,
            openedAt: true,
            closedAt: true,
            description: true,
            episodes: {
              where: { status: { in: ['ACTIVE', 'RECERT_DUE'] } },
              select: {
                id: true,
                division: true,
                diagnosis: true,
                status: true,
                recertDueAt: true,
              },
            },
            encounters: {
              select: {
                id: true,
                notes: {
                  where: { status: { in: ['SIGNED', 'TRANSFERRED'] } },
                  select: { id: true, signedAt: true },
                },
              },
            },
          },
        });

        const followUps = await prisma.followUp.findMany({
          where: {
            patientId: args.patientId,
            orgId: ctx.orgId,
            status: 'OPEN',
          },
          select: { id: true, episodeId: true },
        });
        const openFuByEpisode = new Map<string, number>();
        for (const fu of followUps) {
          if (!fu.episodeId) continue;
          openFuByEpisode.set(
            fu.episodeId,
            (openFuByEpisode.get(fu.episodeId) ?? 0) + 1,
          );
        }

        const projection = cases.map((c) => {
          const allNotes = c.encounters.flatMap((e) => e.notes);
          const signedNoteCount = allNotes.length;
          const lastActivityAt = allNotes.reduce<Date | null>((best, n) => {
            if (!n.signedAt) return best;
            return !best || n.signedAt > best ? n.signedAt : best;
          }, null);
          const openFuCount = c.episodes.reduce(
            (sum, ep) => sum + (openFuByEpisode.get(ep.id) ?? 0),
            0,
          );
          return {
            caseManagementId: c.id,
            primaryIcd: c.primaryIcd,
            primaryIcdLabel: c.primaryIcdLabel,
            secondaryIcd: c.secondaryIcd,
            secondaryIcdLabel: c.secondaryIcdLabel,
            status: c.status,
            description: c.description,
            openedAt: c.openedAt.toISOString(),
            closedAt: c.closedAt?.toISOString() ?? null,
            signedNoteCount,
            lastActivityAt: lastActivityAt?.toISOString() ?? null,
            activeEpisodes: c.episodes.map((ep) => ({
              episodeOfCareId: ep.id,
              division: ep.division,
              diagnosis: ep.diagnosis,
              status: ep.status,
              recertDueAt: ep.recertDueAt?.toISOString() ?? null,
            })),
            openFollowUpCount: openFuCount,
          };
        });

        return {
          ok: true,
          rowCount: projection.length,
          data: { cases: projection },
        };
      }

      case 'lookupPatientBrief': {
        // "Catch me up on this patient" — returns the latest NoteBrief
        // content for this patient (or, when episodeId is set, the
        // latest one scoped to that episode). The brief carries chief
        // concern, prior assessment, trajectory, objective measures,
        // interventions, home program, carry-forward plan, top goals,
        // and the "watch" block (recent med changes, results, red flags).
        // Rule 20: NoteBrief rows are only written by the note-brief
        // worker, which only runs on SIGNED notes.
        const args = lookupPatientBriefArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: { id: true, orgId: true },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);

        const brief = await prisma.noteBrief.findFirst({
          where: {
            patientId: args.patientId,
            orgId: ctx.orgId,
            ...(args.episodeId ? { episodeId: args.episodeId } : {}),
          },
          orderBy: { generatedAt: 'desc' },
          select: {
            id: true,
            noteId: true,
            generatedAt: true,
            generatorVersion: true,
            episodeId: true,
            content: true,
          },
        });
        if (!brief) {
          return {
            ok: true,
            rowCount: 0,
            data: { brief: null, message: 'No brief on file yet.' },
          };
        }

        return {
          ok: true,
          rowCount: 1,
          data: {
            briefId: brief.id,
            sourceNoteId: brief.noteId,
            generatedAt: brief.generatedAt.toISOString(),
            generatorVersion: brief.generatorVersion,
            episodeId: brief.episodeId,
            content: brief.content,
          },
        };
      }

      case 'lookupCleoPatterns': {
        // "What have you noticed?" — Cleo reads HER OWN per-clinician
        // observed-patterns memory. Powers introspective answers like
        // "her sleep has come up in 3 visits but never made it into a
        // plan" or "her LTG flexion goal has been stalled for 5 weeks".
        // Memory is per (patient × clinician) — no cross-clinician
        // leakage. ctx.clinicianOrgUserId is set by runAgent's
        // toolCtx construction.
        const args = lookupCleoPatternsArgs.parse(argsRaw);
        if (!ctx.clinicianOrgUserId) {
          return { ok: false, error: 'clinician_context_required' };
        }
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: { id: true, orgId: true },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);

        const state = await prisma.copilotPatientState.findUnique({
          where: {
            orgId_patientId_clinicianOrgUserId: {
              orgId: ctx.orgId,
              patientId: args.patientId,
              clinicianOrgUserId: ctx.clinicianOrgUserId,
            },
          },
          select: {
            id: true,
            observedPatternsJson: true,
            lastRebuiltAt: true,
            generatorVersion: true,
          },
        });
        if (!state) {
          return {
            ok: true,
            rowCount: 0,
            data: {
              patterns: [],
              message: 'No memory state built yet for this patient.',
            },
          };
        }
        const patternsBlob = state.observedPatternsJson as
          | { patterns?: Array<Record<string, unknown>> }
          | null;
        const patterns = Array.isArray(patternsBlob?.patterns)
          ? patternsBlob.patterns
          : [];

        return {
          ok: true,
          rowCount: patterns.length,
          data: {
            stateId: state.id,
            lastRebuiltAt: state.lastRebuiltAt.toISOString(),
            generatorVersion: state.generatorVersion,
            patterns,
          },
        };
      }

      case 'lookupPatientEpisodes': {
        // "What active episodes does this patient have?" — enumerates
        // EpisodeOfCare rows so the model can ask follow-up questions
        // (e.g. lookupEpisodeGoals) with a real episodeId. Defaults to
        // ACTIVE + RECERT_DUE because that's the live-care answer.
        const args = lookupPatientEpisodesArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: { id: true, orgId: true },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);

        const statusFilter: { status: { in: ('ACTIVE' | 'RECERT_DUE' | 'DISCHARGED' | 'CANCELLED')[] } } = args.status
          ? { status: { in: [args.status] } }
          : { status: { in: ['ACTIVE', 'RECERT_DUE'] } };

        const episodes = await prisma.episodeOfCare.findMany({
          where: {
            patientId: args.patientId,
            orgId: ctx.orgId,
            ...statusFilter,
          },
          orderBy: { startedAt: 'desc' },
          select: {
            id: true,
            division: true,
            diagnosis: true,
            bodyPart: true,
            status: true,
            startedAt: true,
            endedAt: true,
            recertDueAt: true,
            visitsAuthorized: true,
            visitsCompleted: true,
            caseManagementId: true,
            departmentId: true,
          },
        });

        return {
          ok: true,
          rowCount: episodes.length,
          data: {
            episodes: episodes.map((ep) => ({
              episodeOfCareId: ep.id,
              division: ep.division,
              diagnosis: ep.diagnosis,
              bodyPart: ep.bodyPart,
              status: ep.status,
              startedAt: ep.startedAt.toISOString(),
              endedAt: ep.endedAt?.toISOString() ?? null,
              recertDueAt: ep.recertDueAt?.toISOString() ?? null,
              visitsAuthorized: ep.visitsAuthorized,
              visitsCompleted: ep.visitsCompleted,
              caseManagementId: ep.caseManagementId,
              departmentId: ep.departmentId,
            })),
          },
        };
      }

      // ===== Unit 28 — FHIR tools =====================================

      case 'lookupFhirCondition': {
        const args = lookupFhirConditionArgs.parse(argsRaw);
        const guard = await assertFhirReadable(args.patientId, ctx);
        if ('error' in guard) return guard;
        const rows = await loadFreshFhirRows(args.patientId, 'Condition');
        const conditions = rows
          .map((r) => {
            const simp = (r.resource as { simplified?: SimplifiedCondition }).simplified ?? null;
            return { row: r, simp };
          })
          .filter(({ simp }) => {
            if (!simp || !simp.display) return false;
            const wantStatus = args.clinicalStatus ?? 'active';
            return simp.clinicalStatus === wantStatus;
          })
          .slice(0, FHIR_PER_TOOL_CAP)
          .map(({ row, simp }) => ({
            fhirResourceId: row.fhirResourceId,
            display: simp!.display!,
            code: simp!.code,
            clinicalStatus: simp!.clinicalStatus,
            onsetDate: simp!.onsetDate,
            fetchedAt: row.fetchedAt.toISOString(),
          }));
        chargeFhirBudget(ctx, conditions.length);
        return { ok: true, rowCount: conditions.length, data: { conditions } };
      }

      case 'lookupFhirMedication': {
        const args = lookupFhirMedicationArgs.parse(argsRaw);
        const guard = await assertFhirReadable(args.patientId, ctx);
        if ('error' in guard) return guard;
        const statementRows = await loadFreshFhirRows(args.patientId, 'MedicationStatement');
        const requestRows = await loadFreshFhirRows(args.patientId, 'MedicationRequest');
        const wantStatus = args.status ?? 'active';
        const pool: Array<{
          fhirResourceId: string;
          display: string;
          status: string;
          sourceType: 'MedicationStatement' | 'MedicationRequest';
          fetchedAt: string;
        }> = [];
        for (const r of statementRows) {
          const s = (r.resource as { simplified?: SimplifiedMedicationStatement }).simplified ?? null;
          if (s?.display && (wantStatus === 'any' || s.status === wantStatus)) {
            pool.push({
              fhirResourceId: r.fhirResourceId,
              display: s.display,
              status: s.status ?? 'unknown',
              sourceType: 'MedicationStatement',
              fetchedAt: r.fetchedAt.toISOString(),
            });
          }
        }
        for (const r of requestRows) {
          const s = (r.resource as { simplified?: SimplifiedMedicationRequest }).simplified ?? null;
          if (s?.display && (wantStatus === 'any' || s.status === wantStatus)) {
            pool.push({
              fhirResourceId: r.fhirResourceId,
              display: s.display,
              status: s.status ?? 'unknown',
              sourceType: 'MedicationRequest',
              fetchedAt: r.fetchedAt.toISOString(),
            });
          }
        }
        const medications = pool.slice(0, FHIR_PER_TOOL_CAP);
        chargeFhirBudget(ctx, medications.length);
        return { ok: true, rowCount: medications.length, data: { medications } };
      }

      case 'lookupFhirObservation': {
        const args = lookupFhirObservationArgs.parse(argsRaw);
        const guard = await assertFhirReadable(args.patientId, ctx);
        if ('error' in guard) return guard;
        const rows = await loadFreshFhirRows(args.patientId, 'Observation');
        const observations = rows
          .map((r) => ({
            row: r,
            simp: (r.resource as { simplified?: SimplifiedObservation }).simplified ?? null,
          }))
          .filter(({ simp }) => simp?.value != null && (simp.display || simp.code))
          .filter(({ simp }) => (args.code ? simp!.code === args.code : true))
          .slice(0, FHIR_PER_TOOL_CAP)
          .map(({ row, simp }) => ({
            fhirResourceId: row.fhirResourceId,
            display: simp!.display ?? simp!.code ?? 'observation',
            code: simp!.code,
            value: simp!.value!,
            unit: simp!.unit,
            effectiveDate: simp!.effectiveDate,
            fetchedAt: row.fetchedAt.toISOString(),
          }));
        chargeFhirBudget(ctx, observations.length);
        return { ok: true, rowCount: observations.length, data: { observations } };
      }

      case 'lookupFhirAllergy': {
        const args = lookupFhirAllergyArgs.parse(argsRaw);
        const guard = await assertFhirReadable(args.patientId, ctx);
        if ('error' in guard) return guard;
        const rows = await loadFreshFhirRows(args.patientId, 'AllergyIntolerance');
        const allergies = rows
          .map((r) => ({
            row: r,
            simp: (r.resource as { simplified?: SimplifiedAllergyIntolerance }).simplified ?? null,
          }))
          .filter(({ simp }) => simp?.display)
          .slice(0, FHIR_PER_TOOL_CAP)
          .map(({ row, simp }) => ({
            fhirResourceId: row.fhirResourceId,
            display: simp!.display!,
            category: simp!.category,
            criticality: simp!.criticality,
            fetchedAt: row.fetchedAt.toISOString(),
          }));
        chargeFhirBudget(ctx, allergies.length);
        return { ok: true, rowCount: allergies.length, data: { allergies } };
      }

      case 'lookupFhirCarePlan': {
        // CarePlan adapter ships in Wave 4.5; v1 returns the raw FHIR
        // resource directly so the model can read whatever the EHR
        // returned (cache will be empty until the adapter+sync land).
        const args = lookupFhirCarePlanArgs.parse(argsRaw);
        const guard = await assertFhirReadable(args.patientId, ctx);
        if ('error' in guard) return guard;
        const rows = await loadFreshFhirRows(args.patientId, 'CarePlan');
        const carePlans = rows.slice(0, FHIR_PER_TOOL_CAP).map((r) => ({
          fhirResourceId: r.fhirResourceId,
          raw: (r.resource as { raw?: unknown }).raw ?? r.resource,
          fetchedAt: r.fetchedAt.toISOString(),
        }));
        chargeFhirBudget(ctx, carePlans.length);
        return { ok: true, rowCount: carePlans.length, data: { carePlans } };
      }

      // ===== Tier 3 — FHIR expansion ==================================

      case 'lookupFhirDiagnosticReport': {
        // "Did the lipid panel come back?" — wraps DiagnosticReport. v1
        // returns the raw FHIR resource since there's no simplified
        // adapter yet (mirrors lookupFhirCarePlan).
        const args = lookupFhirDiagnosticReportArgs.parse(argsRaw);
        const guard = await assertFhirReadable(args.patientId, ctx);
        if ('error' in guard) return guard;
        const rows = await loadFreshFhirRows(args.patientId, 'DiagnosticReport');
        const reports = rows
          .filter((r) => {
            if (!args.category) return true;
            const raw = r.resource as { raw?: { category?: Array<{ text?: string; coding?: Array<{ code?: string }> }> } };
            const cats = raw.raw?.category ?? [];
            return cats.some(
              (c) => c.text === args.category || (c.coding ?? []).some((x) => x.code === args.category),
            );
          })
          .slice(0, FHIR_PER_TOOL_CAP)
          .map((r) => {
            const raw = (r.resource as { raw?: Record<string, unknown> }).raw ?? (r.resource as Record<string, unknown>);
            const r2 = raw as {
              code?: { text?: string; coding?: Array<{ code?: string; display?: string }> };
              status?: string;
              effectiveDateTime?: string;
              conclusion?: string;
            };
            return {
              fhirResourceId: r.fhirResourceId,
              display: r2.code?.text ?? r2.code?.coding?.[0]?.display ?? 'diagnostic report',
              code: r2.code?.coding?.[0]?.code ?? null,
              status: r2.status ?? null,
              effectiveDate: r2.effectiveDateTime ?? null,
              conclusion: r2.conclusion ?? null,
              fetchedAt: r.fetchedAt.toISOString(),
            };
          });
        chargeFhirBudget(ctx, reports.length);
        return { ok: true, rowCount: reports.length, data: { diagnosticReports: reports } };
      }

      case 'lookupFhirProcedure': {
        // "What surgeries / procedures has she had?" — wraps Procedure.
        const args = lookupFhirProcedureArgs.parse(argsRaw);
        const guard = await assertFhirReadable(args.patientId, ctx);
        if ('error' in guard) return guard;
        const rows = await loadFreshFhirRows(args.patientId, 'Procedure');
        const procedures = rows
          .map((r) => {
            const raw = (r.resource as { raw?: Record<string, unknown> }).raw ?? (r.resource as Record<string, unknown>);
            const r2 = raw as {
              code?: { text?: string; coding?: Array<{ code?: string; display?: string }> };
              status?: string;
              performedDateTime?: string;
              performedPeriod?: { start?: string };
            };
            return {
              fhirResourceId: r.fhirResourceId,
              display: r2.code?.text ?? r2.code?.coding?.[0]?.display ?? 'procedure',
              code: r2.code?.coding?.[0]?.code ?? null,
              status: r2.status ?? null,
              performedDate: r2.performedDateTime ?? r2.performedPeriod?.start ?? null,
              fetchedAt: r.fetchedAt.toISOString(),
            };
          })
          .filter((p) => !args.status || p.status === args.status)
          .slice(0, FHIR_PER_TOOL_CAP);
        chargeFhirBudget(ctx, procedures.length);
        return { ok: true, rowCount: procedures.length, data: { procedures } };
      }

      case 'lookupFhirImmunization': {
        // "Is she up to date on her shots?" — wraps Immunization.
        const args = lookupFhirImmunizationArgs.parse(argsRaw);
        const guard = await assertFhirReadable(args.patientId, ctx);
        if ('error' in guard) return guard;
        const rows = await loadFreshFhirRows(args.patientId, 'Immunization');
        const immunizations = rows
          .slice(0, FHIR_PER_TOOL_CAP)
          .map((r) => {
            const raw = (r.resource as { raw?: Record<string, unknown> }).raw ?? (r.resource as Record<string, unknown>);
            const r2 = raw as {
              vaccineCode?: { text?: string; coding?: Array<{ code?: string; display?: string }> };
              status?: string;
              occurrenceDateTime?: string;
            };
            return {
              fhirResourceId: r.fhirResourceId,
              display: r2.vaccineCode?.text ?? r2.vaccineCode?.coding?.[0]?.display ?? 'immunization',
              code: r2.vaccineCode?.coding?.[0]?.code ?? null,
              status: r2.status ?? null,
              occurrenceDate: r2.occurrenceDateTime ?? null,
              fetchedAt: r.fetchedAt.toISOString(),
            };
          });
        chargeFhirBudget(ctx, immunizations.length);
        return { ok: true, rowCount: immunizations.length, data: { immunizations } };
      }

      // ===== Tier 5 — clinician-scoped reads ==========================

      case 'lookupMyOpenDrafts': {
        // "What notes do I still owe?" — Notes where I'm the
        // clinicianOrgUserId + status is NOT signed/transferred.
        if (!ctx.clinicianOrgUserId) {
          return { ok: false, error: 'clinician_context_required' };
        }
        const args = lookupMyOpenDraftsArgs.parse(argsRaw);
        const limit = args.limit ?? 20;
        const rows = await prisma.note.findMany({
          where: {
            orgId: ctx.orgId,
            clinicianOrgUserId: ctx.clinicianOrgUserId,
            status: {
              in: ['PREPARING', 'RECORDING', 'PAUSED', 'TRANSCRIBING', 'DRAFTING', 'INTERRUPTED', 'DRAFT', 'REVIEWING', 'PENDING_REVIEW'],
            },
          },
          orderBy: { updatedAt: 'desc' },
          take: limit,
          select: {
            id: true,
            status: true,
            updatedAt: true,
            division: true,
            template: { select: { name: true } },
            patient: { select: { id: true, firstName: true, lastName: true } },
          },
        });
        return {
          ok: true,
          rowCount: rows.length,
          data: {
            drafts: rows.map((n) => ({
              noteId: n.id,
              status: n.status,
              updatedAt: n.updatedAt.toISOString(),
              division: n.division,
              templateName: n.template?.name ?? null,
              patientId: n.patient.id,
              patientDisplay: `${n.patient.firstName} ${n.patient.lastName[0]}.`,
            })),
          },
        };
      }

      case 'lookupMySchedule': {
        // "What's on my schedule today?" — Schedule rows for me on a
        // given day (defaults to today, local-day buckets server-side).
        if (!ctx.clinicianOrgUserId) {
          return { ok: false, error: 'clinician_context_required' };
        }
        const args = lookupMyScheduleArgs.parse(argsRaw);
        const target = args.date ? new Date(`${args.date}T00:00:00`) : new Date();
        const dayStart = new Date(target);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
        const rows = await prisma.schedule.findMany({
          where: {
            orgId: ctx.orgId,
            clinicianOrgUserId: ctx.clinicianOrgUserId,
            scheduledStart: { gte: dayStart, lt: dayEnd },
          },
          orderBy: { scheduledStart: 'asc' },
          select: {
            id: true,
            scheduledStart: true,
            scheduledEnd: true,
            visitType: true,
            status: true,
            patient: { select: { id: true, firstName: true, lastName: true } },
            encounter: { select: { id: true, notes: { select: { id: true, status: true } } } },
          },
        });
        return {
          ok: true,
          rowCount: rows.length,
          data: {
            date: dayStart.toISOString().slice(0, 10),
            schedule: rows.map((s) => ({
              scheduleId: s.id,
              scheduledStart: s.scheduledStart.toISOString(),
              scheduledEnd: s.scheduledEnd.toISOString(),
              visitType: s.visitType,
              status: s.status,
              patientId: s.patient.id,
              patientDisplay: `${s.patient.firstName} ${s.patient.lastName[0]}.`,
              encounterId: s.encounter?.id ?? null,
              noteCount: s.encounter?.notes.length ?? 0,
            })),
          },
        };
      }

      case 'lookupMyFollowUps': {
        // "Who do I still need to follow up with?" — FollowUp rows
        // attributed to me via originNote.clinicianOrgUserId. Excludes
        // closed ones unless explicitly requested.
        if (!ctx.clinicianOrgUserId) {
          return { ok: false, error: 'clinician_context_required' };
        }
        const args = lookupMyFollowUpsArgs.parse(argsRaw);
        const limit = args.limit ?? 20;
        const rows = await prisma.followUp.findMany({
          where: {
            orgId: ctx.orgId,
            originNote: { clinicianOrgUserId: ctx.clinicianOrgUserId },
            status: args.status ?? 'OPEN',
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: {
            id: true,
            text: true,
            status: true,
            createdAt: true,
            patientId: true,
            patient: { select: { firstName: true, lastName: true } },
            originNoteId: true,
            originNote: { select: { signedAt: true } },
          },
        });
        return {
          ok: true,
          rowCount: rows.length,
          data: {
            followUps: rows.map((fu) => ({
              followUpId: fu.id,
              text: fu.text,
              status: fu.status,
              createdAt: fu.createdAt.toISOString(),
              patientId: fu.patientId,
              patientDisplay: `${fu.patient.firstName} ${fu.patient.lastName[0]}.`,
              originNoteId: fu.originNoteId,
              originSignedAt: fu.originNote?.signedAt?.toISOString() ?? null,
            })),
          },
        };
      }

      case 'summarizeMyDay': {
        // "Give me the lay of the land today" — composite of schedule
        // count + open drafts count + open follow-ups count. Pure DB;
        // the model produces the natural-language summary from the
        // structured payload (rule 24-safe: data only, no
        // recommendation).
        if (!ctx.clinicianOrgUserId) {
          return { ok: false, error: 'clinician_context_required' };
        }
        const args = summarizeMyDayArgs.parse(argsRaw);
        const target = args.date ? new Date(`${args.date}T00:00:00`) : new Date();
        const dayStart = new Date(target);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
        const [scheduledCount, completedSchedules, openDraftCount, openFollowUpCount] = await Promise.all([
          prisma.schedule.count({
            where: {
              orgId: ctx.orgId,
              clinicianOrgUserId: ctx.clinicianOrgUserId,
              scheduledStart: { gte: dayStart, lt: dayEnd },
            },
          }),
          prisma.schedule.count({
            where: {
              orgId: ctx.orgId,
              clinicianOrgUserId: ctx.clinicianOrgUserId,
              scheduledStart: { gte: dayStart, lt: dayEnd },
              status: 'COMPLETED',
            },
          }),
          prisma.note.count({
            where: {
              orgId: ctx.orgId,
              clinicianOrgUserId: ctx.clinicianOrgUserId,
              status: {
                in: ['DRAFT', 'REVIEWING', 'PENDING_REVIEW', 'INTERRUPTED'],
              },
            },
          }),
          prisma.followUp.count({
            where: {
              orgId: ctx.orgId,
              originNote: { clinicianOrgUserId: ctx.clinicianOrgUserId },
              status: 'OPEN',
            },
          }),
        ]);
        return {
          ok: true,
          rowCount: 1,
          data: {
            date: dayStart.toISOString().slice(0, 10),
            scheduledCount,
            completedSchedules,
            remainingSchedules: scheduledCount - completedSchedules,
            openDraftCount,
            openFollowUpCount,
          },
        };
      }

      // ===== Tier 5 — patient-scoped reads =============================

      case 'lookupUpcomingSchedule': {
        // "When is she back?" — future Schedule rows for this patient
        // bounded by horizonDays (default 30).
        const args = lookupUpcomingScheduleArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: { id: true, orgId: true },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);
        const horizonDays = args.horizonDays ?? 30;
        const now = new Date();
        const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
        const rows = await prisma.schedule.findMany({
          where: {
            orgId: ctx.orgId,
            patientId: args.patientId,
            scheduledStart: { gte: now, lte: horizon },
            status: { in: ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN'] },
          },
          orderBy: { scheduledStart: 'asc' },
          take: 20,
          select: {
            id: true,
            scheduledStart: true,
            visitType: true,
            status: true,
            clinicianOrgUserId: true,
          },
        });
        return {
          ok: true,
          rowCount: rows.length,
          data: {
            horizonDays,
            visits: rows.map((s) => ({
              scheduleId: s.id,
              scheduledStart: s.scheduledStart.toISOString(),
              visitType: s.visitType,
              status: s.status,
              clinicianOrgUserId: s.clinicianOrgUserId,
            })),
          },
        };
      }

      case 'lookupPriorConversation': {
        // "Didn't we discuss this last week?" — Cleo's own chat memory
        // beyond the active thread. Returns recent messages from this
        // (patient × clinician × CHART) conversation. Per-clinician
        // scope is hard-fenced: ctx.clinicianOrgUserId is required.
        if (!ctx.clinicianOrgUserId) {
          return { ok: false, error: 'clinician_context_required' };
        }
        const args = lookupPriorConversationArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: { id: true, orgId: true },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);
        const limit = args.limit ?? 30;
        const conversation = await prisma.copilotConversation.findUnique({
          where: {
            orgId_patientId_clinicianOrgUserId_mode: {
              orgId: ctx.orgId,
              patientId: args.patientId,
              clinicianOrgUserId: ctx.clinicianOrgUserId,
              mode: 'CHART',
            },
          },
          select: { id: true, startedAt: true, lastActivityAt: true },
        });
        if (!conversation) {
          return {
            ok: true,
            rowCount: 0,
            data: { conversation: null, messages: [] },
          };
        }
        const messages = await prisma.copilotMessage.findMany({
          where: { conversationId: conversation.id },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: {
            id: true,
            role: true,
            content: true,
            sourcesJson: true,
            createdAt: true,
          },
        });
        return {
          ok: true,
          rowCount: messages.length,
          data: {
            conversation: {
              id: conversation.id,
              startedAt: conversation.startedAt.toISOString(),
              lastActivityAt: conversation.lastActivityAt.toISOString(),
            },
            // Reverse to chronological order — the agent prefers
            // oldest→newest when reasoning about thread evolution.
            messages: messages
              .reverse()
              .map((m) => ({
                messageId: m.id,
                role: m.role,
                content: m.content,
                sources: m.sourcesJson,
                createdAt: m.createdAt.toISOString(),
              })),
          },
        };
      }

      // ===== Tier 3 — in-visit gap analysis ============================

      case 'analyzeDraftGapAgainstTranscript': {
        // Compares the current draftJson sections to transcriptClean
        // and surfaces what was said in the visit but NOT captured in
        // the draft. Delegates to a sub-LLM in draft-tools.ts so the
        // analysis is structured + Zod-shaped + auditor-friendly.
        // Rule 24 stance: returns OBSERVATIONS, not recommendations.
        const args = analyzeDraftGapArgs.parse(argsRaw);
        const note = await prisma.note.findUnique({
          where: { id: args.noteId },
          select: {
            id: true,
            orgId: true,
            draftJson: true,
            finalJson: true,
            transcriptClean: true,
            status: true,
          },
        });
        if (!note) return { ok: false, error: 'note_not_found' };
        assertOrgScoped(note.orgId, ctx.orgId);
        // Use draftJson if present; for SIGNED notes the draft is gone
        // (canonicalize'd) so fall back to finalJson sections.
        const draftSections =
          (note.draftJson as Record<string, { content: string }> | null) ??
          (() => {
            const fj = note.finalJson as { sections?: Array<{ id: string; content: string }> } | null;
            if (!fj?.sections) return null;
            const map: Record<string, { content: string }> = {};
            for (const s of fj.sections) map[s.id] = { content: s.content };
            return map;
          })() ??
          {};
        const transcript = note.transcriptClean as { plaintext?: string } | null;
        const transcriptText = (transcript?.plaintext ?? '').slice(0, 12_000);
        if (!transcriptText) {
          return {
            ok: true,
            rowCount: 0,
            data: {
              gaps: [],
              message: 'No transcript on file — gap analysis requires a transcript.',
            },
          };
        }
        const draftBlob = Object.entries(draftSections)
          .map(([id, s]) => `## ${id}\n${s.content ?? ''}`)
          .join('\n\n');
        return runDraftGapAnalysis(
          { noteId: args.noteId, draftBlob, transcriptText },
          { orgId: ctx.orgId },
        );
      }

      // ===== Unit 30 — Draft tools (chart-mode only) =================

      case 'draftPatientMessage': {
        const args = draftPatientMessageArgs.parse(argsRaw);
        return runDraftPatientMessage(args, { orgId: ctx.orgId });
      }

      case 'proposeFollowUpCadence': {
        const args = proposeFollowUpCadenceArgs.parse(argsRaw);
        return runProposeFollowUpCadence(args, { orgId: ctx.orgId });
      }

      case 'suggestReferralLetterContent': {
        const args = suggestReferralLetterContentArgs.parse(argsRaw);
        return runSuggestReferralLetterContent(args, { orgId: ctx.orgId });
      }

      // ===== Tier 4 — Draft tools (sprint 0.x — scaffold) =============

      case 'draftAddendum': {
        const args = draftAddendumArgs.parse(argsRaw);
        return runDraftAddendum(args, { orgId: ctx.orgId });
      }

      case 'draftGoalUpdate': {
        const args = draftGoalUpdateArgs.parse(argsRaw);
        return runDraftGoalUpdate(args, { orgId: ctx.orgId });
      }

      case 'draftOrderSet': {
        const args = draftOrderSetArgs.parse(argsRaw);
        return runDraftOrderSet(args, { orgId: ctx.orgId });
      }

      // ===== Tier 6 — coding + billing intelligence ===================

      case 'suggestCptCodes': {
        // Sub-LLM analyzes the note's documented elements + suggests
        // E/M codes. Returns analysis findings (NOT a draft) the agent
        // cites in its answer. Rule 24-safe: observation only, never
        // "you should bill X".
        const args = suggestCptCodesArgs.parse(argsRaw);
        const note = await prisma.note.findUnique({
          where: { id: args.noteId },
          select: { id: true, orgId: true, division: true, finalJson: true, draftJson: true, status: true },
        });
        if (!note) return { ok: false, error: 'note_not_found' };
        assertOrgScoped(note.orgId, ctx.orgId);
        const sections = extractSectionsBlob(note);
        if (!sections) {
          return { ok: false, error: 'no_note_content' };
        }
        return runCodingAnalysis(
          {
            kind: 'cpt',
            noteId: args.noteId,
            division: note.division,
            sectionsBlob: sections,
            payerType: args.payerType ?? 'commercial',
          },
          { orgId: ctx.orgId },
        );
      }

      case 'suggestIcdSpecificity': {
        const args = suggestIcdSpecificityArgs.parse(argsRaw);
        const note = await prisma.note.findUnique({
          where: { id: args.noteId },
          select: { id: true, orgId: true, division: true, finalJson: true, draftJson: true, status: true, encounter: { select: { caseManagement: { select: { primaryIcd: true, primaryIcdLabel: true, secondaryIcd: true, secondaryIcdLabel: true } } } } },
        });
        if (!note) return { ok: false, error: 'note_not_found' };
        assertOrgScoped(note.orgId, ctx.orgId);
        const sections = extractSectionsBlob(note);
        if (!sections) return { ok: false, error: 'no_note_content' };
        const cm = note.encounter?.caseManagement;
        const currentIcds = [
          cm?.primaryIcd ? { code: cm.primaryIcd, label: cm.primaryIcdLabel } : null,
          cm?.secondaryIcd ? { code: cm.secondaryIcd, label: cm.secondaryIcdLabel ?? '' } : null,
        ].filter((x): x is { code: string; label: string } => !!x);
        return runCodingAnalysis(
          {
            kind: 'icd-specificity',
            noteId: args.noteId,
            division: note.division,
            sectionsBlob: sections,
            currentIcds,
          },
          { orgId: ctx.orgId },
        );
      }

      case 'lookupBillabilityElements': {
        const args = lookupBillabilityElementsArgs.parse(argsRaw);
        const note = await prisma.note.findUnique({
          where: { id: args.noteId },
          select: { id: true, orgId: true, division: true, finalJson: true, draftJson: true, status: true },
        });
        if (!note) return { ok: false, error: 'note_not_found' };
        assertOrgScoped(note.orgId, ctx.orgId);
        const sections = extractSectionsBlob(note);
        if (!sections) return { ok: false, error: 'no_note_content' };
        return runCodingAnalysis(
          {
            kind: 'billability',
            noteId: args.noteId,
            division: note.division,
            sectionsBlob: sections,
          },
          { orgId: ctx.orgId },
        );
      }

      case 'lookupCodingHistory': {
        // Pure DB read: ICD codes used historically for this patient
        // (CaseManagement primary/secondary + EpisodeOfCare primary).
        // No LLM call.
        const args = lookupCodingHistoryArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: { id: true, orgId: true },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);
        const cases = await prisma.caseManagement.findMany({
          where: {
            patientId: args.patientId,
            orgId: ctx.orgId,
            ...(args.icd
              ? {
                  OR: [
                    { primaryIcd: { startsWith: args.icd } },
                    { secondaryIcd: { startsWith: args.icd } },
                  ],
                }
              : {}),
          },
          select: {
            id: true,
            primaryIcd: true,
            primaryIcdLabel: true,
            secondaryIcd: true,
            secondaryIcdLabel: true,
            status: true,
            openedAt: true,
          },
        });
        const episodes = await prisma.episodeOfCare.findMany({
          where: {
            patientId: args.patientId,
            orgId: ctx.orgId,
            ...(args.icd ? { primaryIcd: { startsWith: args.icd } } : {}),
          },
          select: {
            id: true,
            primaryIcd: true,
            primaryIcdLabel: true,
            secondaryIcd: true,
            secondaryIcdLabel: true,
            status: true,
            startedAt: true,
          },
        });
        const byIcd = new Map<string, { code: string; label: string; useCount: number; firstSeen: string; lastSeen: string }>();
        for (const c of cases) {
          for (const pair of [
            [c.primaryIcd, c.primaryIcdLabel],
            [c.secondaryIcd, c.secondaryIcdLabel],
          ] as [string | null, string | null][]) {
            if (!pair[0]) continue;
            const k = pair[0];
            const dateIso = c.openedAt.toISOString();
            const existing = byIcd.get(k);
            if (existing) {
              existing.useCount += 1;
              if (dateIso < existing.firstSeen) existing.firstSeen = dateIso;
              if (dateIso > existing.lastSeen) existing.lastSeen = dateIso;
            } else {
              byIcd.set(k, { code: k, label: pair[1] ?? '', useCount: 1, firstSeen: dateIso, lastSeen: dateIso });
            }
          }
        }
        for (const e of episodes) {
          if (!e.primaryIcd) continue;
          const dateIso = e.startedAt.toISOString();
          const existing = byIcd.get(e.primaryIcd);
          if (existing) {
            existing.useCount += 1;
            if (dateIso < existing.firstSeen) existing.firstSeen = dateIso;
            if (dateIso > existing.lastSeen) existing.lastSeen = dateIso;
          } else {
            byIcd.set(e.primaryIcd, { code: e.primaryIcd, label: e.primaryIcdLabel ?? '', useCount: 1, firstSeen: dateIso, lastSeen: dateIso });
          }
        }
        const codes = Array.from(byIcd.values()).sort((a, b) => b.useCount - a.useCount);
        return {
          ok: true,
          rowCount: codes.length,
          data: { codes, caseCount: cases.length, episodeCount: episodes.length },
        };
      }

      // ===== Tier 7 — patient-facing letters (drafts) =================

      case 'draftAfterVisitSummary': {
        const args = draftAfterVisitSummaryArgs.parse(argsRaw);
        return runDraftAfterVisitSummary(args, { orgId: ctx.orgId });
      }

      case 'draftSchoolWorkLetter': {
        const args = draftSchoolWorkLetterArgs.parse(argsRaw);
        return runDraftSchoolWorkLetter(args, { orgId: ctx.orgId });
      }

      case 'draftPriorAuthLetter': {
        const args = draftPriorAuthLetterArgs.parse(argsRaw);
        return runDraftPriorAuthLetter(args, { orgId: ctx.orgId });
      }

      case 'draftDischargeSummary': {
        const args = draftDischargeSummaryArgs.parse(argsRaw);
        return runDraftDischargeSummary(args, { orgId: ctx.orgId });
      }

      case 'draftReferralFeedbackLetter': {
        const args = draftReferralFeedbackLetterArgs.parse(argsRaw);
        return runDraftReferralFeedbackLetter(args, { orgId: ctx.orgId });
      }

      // ===== Tier 8 — voice / recording awareness =====================

      case 'lookupRecordingStatus': {
        // "Is this visit being recorded right now?" — reads Note.status
        // + the most recent AudioSegment. No PHI in the result — only
        // structural state.
        const args = lookupRecordingStatusArgs.parse(argsRaw);
        const note = await prisma.note.findUnique({
          where: { id: args.noteId },
          select: {
            id: true,
            orgId: true,
            status: true,
            captureMode: true,
            updatedAt: true,
            audioSegments: {
              select: { id: true, durationMs: true, createdAt: true, isDeleted: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            transcriptClean: true,
          },
        });
        if (!note) return { ok: false, error: 'note_not_found' };
        assertOrgScoped(note.orgId, ctx.orgId);
        const tc = note.transcriptClean as { wordCount?: number; durationMs?: number } | null;
        const segment = note.audioSegments[0];
        return {
          ok: true,
          rowCount: 1,
          data: {
            noteId: note.id,
            status: note.status,
            captureMode: note.captureMode,
            isRecording: note.status === 'RECORDING',
            isPaused: note.status === 'PAUSED',
            audioSegmentCount: note.audioSegments.length,
            lastAudioSegmentDurationMs: segment?.durationMs ?? null,
            transcriptWordCount: tc?.wordCount ?? null,
            transcriptDurationMs: tc?.durationMs ?? null,
          },
        };
      }

      case 'lookupRecentTranscript': {
        // "What did the patient just say?" — surfaces the last
        // lastSeconds of transcriptClean. Rule 20 exception: in-visit
        // mode reads in-progress transcript (not yet attested), which
        // is a deliberate carve-out for the recording-aware skin. Use
        // ONLY for in-visit Q&A; never cite from this in a signed-note
        // context.
        const args = lookupRecentTranscriptArgs.parse(argsRaw);
        const note = await prisma.note.findUnique({
          where: { id: args.noteId },
          select: {
            id: true,
            orgId: true,
            status: true,
            transcriptClean: true,
            audioSegments: {
              select: { durationMs: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });
        if (!note) return { ok: false, error: 'note_not_found' };
        assertOrgScoped(note.orgId, ctx.orgId);
        const lastSeconds = args.lastSeconds ?? 120;
        const tc = note.transcriptClean as {
          structured?: Array<{ text: string; speaker: string; startMs?: number; endMs?: number }>;
          durationMs?: number;
        } | null;
        if (!tc?.structured?.length) {
          return {
            ok: true,
            rowCount: 0,
            data: { segments: [], message: 'No transcript available yet.' },
          };
        }
        const lastMs = tc.durationMs ?? tc.structured[tc.structured.length - 1]?.endMs ?? 0;
        const cutoffMs = Math.max(0, lastMs - lastSeconds * 1000);
        const segments = tc.structured
          .filter((s) => (s.endMs ?? s.startMs ?? 0) >= cutoffMs)
          .map((s) => ({
            speaker: s.speaker,
            text: s.text,
            startMs: s.startMs ?? null,
            endMs: s.endMs ?? null,
          }));
        return {
          ok: true,
          rowCount: segments.length,
          data: {
            segments,
            lastSeconds,
            recordingDurationMs: lastMs,
            noteStatus: note.status,
          },
        };
      }

      // ===== Tier 9 — compliance + audit helper =======================

      case 'auditPhiAccessForPatient': {
        // Reads AuditLog rows that anchor to this patient (resourceType =
        // 'Note' / 'Patient' / 'CaseManagement' / 'EpisodeOfCare'). PHI-
        // free shape because AuditLog.metadata is enforced PHI-free at
        // write time. Returns who, what action, when.
        const args = auditPhiAccessForPatientArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: { id: true, orgId: true },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);
        const fromIso = args.fromIso ? new Date(args.fromIso) : new Date(Date.now() - 30 * 86_400_000);
        const toIso = args.toIso ? new Date(args.toIso) : new Date();
        const limit = args.limit ?? 50;
        // Read patient's notes + cases + episodes for ID joins.
        const [notes, cases, episodes] = await Promise.all([
          prisma.note.findMany({ where: { patientId: args.patientId, orgId: ctx.orgId }, select: { id: true } }),
          prisma.caseManagement.findMany({ where: { patientId: args.patientId, orgId: ctx.orgId }, select: { id: true } }),
          prisma.episodeOfCare.findMany({ where: { patientId: args.patientId, orgId: ctx.orgId }, select: { id: true } }),
        ]);
        const noteIds = notes.map((n) => n.id);
        const caseIds = cases.map((c) => c.id);
        const episodeIds = episodes.map((e) => e.id);
        const rows = await prisma.auditLog.findMany({
          where: {
            orgId: ctx.orgId,
            createdAt: { gte: fromIso, lte: toIso },
            OR: [
              { resourceType: 'Patient', resourceId: args.patientId },
              { resourceType: 'Note', resourceId: { in: noteIds } },
              { resourceType: 'CaseManagement', resourceId: { in: caseIds } },
              { resourceType: 'EpisodeOfCare', resourceId: { in: episodeIds } },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: {
            id: true,
            action: true,
            resourceType: true,
            resourceId: true,
            userId: true,
            actingUserId: true,
            createdAt: true,
          },
        });
        return {
          ok: true,
          rowCount: rows.length,
          data: {
            from: fromIso.toISOString(),
            to: toIso.toISOString(),
            accesses: rows.map((r) => ({
              auditId: r.id,
              action: r.action,
              resourceType: r.resourceType,
              resourceId: r.resourceId,
              userId: r.userId,
              actingUserId: r.actingUserId,
              at: r.createdAt.toISOString(),
            })),
          },
        };
      }

      case 'lookupRequiredFormStatus': {
        // "Has consent been captured? Voice-ID? BAA?" — reads
        // PatientConsent rows + cross-checks the patient's
        // VoiceProfile + the org's BAA fields. Pure read; PHI-free.
        const args = lookupRequiredFormStatusArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: {
            id: true,
            orgId: true,
            consents: {
              select: { consentType: true, status: true, acceptedAt: true, declinedAt: true, version: true },
              orderBy: { acceptedAt: 'desc' },
            },
            organization: {
              select: {
                baaExecutedAt: true,
                baaVersion: true,
                complianceProfile: true,
              },
            },
          },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);
        const required = ['recording', 'telehealth', 'voice-id'];
        const consentsByType = new Map(patient.consents.map((c) => [c.consentType, c]));
        const statuses = required.map((t) => {
          const c = consentsByType.get(t);
          return {
            consentType: t,
            status: c?.status ?? 'NOT_RECORDED',
            acceptedAt: c?.acceptedAt?.toISOString() ?? null,
            declinedAt: c?.declinedAt?.toISOString() ?? null,
            version: c?.version ?? null,
          };
        });
        return {
          ok: true,
          rowCount: 1,
          data: {
            consents: statuses,
            org: {
              baaExecutedAt: patient.organization.baaExecutedAt?.toISOString() ?? null,
              baaVersion: patient.organization.baaVersion,
              complianceProfile: patient.organization.complianceProfile,
            },
          },
        };
      }

      case 'lookupCompletenessFlags': {
        // Deterministic + sub-LLM-enriched checklist of CMS/org
        // required elements for the note's division (HPI / ROS / PE /
        // MDM / Assessment / Plan / etc.). Delegates to the same sub-
        // LLM analysis runner as the coding tools.
        const args = lookupCompletenessFlagsArgs.parse(argsRaw);
        const note = await prisma.note.findUnique({
          where: { id: args.noteId },
          select: { id: true, orgId: true, division: true, finalJson: true, draftJson: true, status: true },
        });
        if (!note) return { ok: false, error: 'note_not_found' };
        assertOrgScoped(note.orgId, ctx.orgId);
        const sections = extractSectionsBlob(note);
        if (!sections) return { ok: false, error: 'no_note_content' };
        return runCodingAnalysis(
          {
            kind: 'completeness',
            noteId: args.noteId,
            division: note.division,
            sectionsBlob: sections,
          },
          { orgId: ctx.orgId },
        );
      }

      // ===== Tier 10 — cross-patient analytics ========================

      case 'lookupMyPatientsWithCondition': {
        // "Show me my T2DM patients" — patients I've authored signed
        // notes for whose CaseManagement primary/secondary ICD matches
        // the given code (prefix match, so 'E11' catches all T2DM
        // sub-codes).
        if (!ctx.clinicianOrgUserId) {
          return { ok: false, error: 'clinician_context_required' };
        }
        const args = lookupMyPatientsWithConditionArgs.parse(argsRaw);
        const limit = args.limit ?? 25;
        // Find patient IDs I've authored signed notes for.
        const authoredNotes = await prisma.note.findMany({
          where: {
            orgId: ctx.orgId,
            clinicianOrgUserId: ctx.clinicianOrgUserId,
            status: { in: ['SIGNED', 'TRANSFERRED'] },
          },
          select: { patientId: true },
          distinct: ['patientId'],
        });
        const myPatientIds = Array.from(new Set(authoredNotes.map((n) => n.patientId)));
        if (myPatientIds.length === 0) {
          return { ok: true, rowCount: 0, data: { patients: [] } };
        }
        const matched = await prisma.caseManagement.findMany({
          where: {
            orgId: ctx.orgId,
            patientId: { in: myPatientIds },
            status: args.status ?? 'ACTIVE',
            OR: [
              { primaryIcd: { startsWith: args.icd } },
              { secondaryIcd: { startsWith: args.icd } },
            ],
          },
          take: limit,
          select: {
            id: true,
            patientId: true,
            primaryIcd: true,
            primaryIcdLabel: true,
            secondaryIcd: true,
            status: true,
            patient: { select: { firstName: true, lastName: true } },
          },
        });
        return {
          ok: true,
          rowCount: matched.length,
          data: {
            patients: matched.map((m) => ({
              patientId: m.patientId,
              patientDisplay: `${m.patient.firstName} ${m.patient.lastName[0]}.`,
              caseManagementId: m.id,
              primaryIcd: m.primaryIcd,
              primaryIcdLabel: m.primaryIcdLabel,
              secondaryIcd: m.secondaryIcd,
              caseStatus: m.status,
            })),
          },
        };
      }

      case 'lookupMyOverdueRecerts': {
        // "Whose rehab recerts are coming up?" — REHAB episodes for
        // patients whose CaseManagement.openedBy or related notes are
        // mine. We use authored-notes scope (same as the condition
        // lookup) so the count matches "my panel".
        if (!ctx.clinicianOrgUserId) {
          return { ok: false, error: 'clinician_context_required' };
        }
        const args = lookupMyOverdueRecertsArgs.parse(argsRaw);
        const horizonDays = args.horizonDays ?? 14;
        const now = new Date();
        const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
        const authoredNotes = await prisma.note.findMany({
          where: {
            orgId: ctx.orgId,
            clinicianOrgUserId: ctx.clinicianOrgUserId,
            status: { in: ['SIGNED', 'TRANSFERRED'] },
          },
          select: { patientId: true },
          distinct: ['patientId'],
        });
        const myPatientIds = Array.from(new Set(authoredNotes.map((n) => n.patientId)));
        if (myPatientIds.length === 0) {
          return { ok: true, rowCount: 0, data: { recerts: [] } };
        }
        const episodes = await prisma.episodeOfCare.findMany({
          where: {
            orgId: ctx.orgId,
            patientId: { in: myPatientIds },
            status: { in: ['ACTIVE', 'RECERT_DUE'] },
            recertDueAt: { lte: horizon },
          },
          orderBy: { recertDueAt: 'asc' },
          take: 50,
          select: {
            id: true,
            diagnosis: true,
            recertDueAt: true,
            patientId: true,
            patient: { select: { firstName: true, lastName: true } },
            visitsAuthorized: true,
            visitsCompleted: true,
          },
        });
        return {
          ok: true,
          rowCount: episodes.length,
          data: {
            horizonDays,
            recerts: episodes.map((e) => ({
              episodeOfCareId: e.id,
              patientId: e.patientId,
              patientDisplay: `${e.patient.firstName} ${e.patient.lastName[0]}.`,
              diagnosis: e.diagnosis,
              recertDueAt: e.recertDueAt?.toISOString() ?? null,
              visitsAuthorized: e.visitsAuthorized,
              visitsCompleted: e.visitsCompleted,
              daysUntilDue: e.recertDueAt
                ? Math.max(0, Math.floor((e.recertDueAt.getTime() - now.getTime()) / 86_400_000))
                : null,
            })),
          },
        };
      }

      case 'lookupMyOpenFollowUpsByPatient': {
        // Same FollowUp source as lookupMyFollowUps, but grouped by
        // patient. Lets Cleo answer "who do I have the most open with?"
        if (!ctx.clinicianOrgUserId) {
          return { ok: false, error: 'clinician_context_required' };
        }
        const args = lookupMyOpenFollowUpsByPatientArgs.parse(argsRaw);
        const limit = args.limit ?? 25;
        const rows = await prisma.followUp.findMany({
          where: {
            orgId: ctx.orgId,
            originNote: { clinicianOrgUserId: ctx.clinicianOrgUserId },
            status: 'OPEN',
          },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: {
            id: true,
            text: true,
            patientId: true,
            patient: { select: { firstName: true, lastName: true } },
            createdAt: true,
          },
        });
        const byPatient = new Map<string, { patientId: string; patientDisplay: string; openCount: number; followUps: Array<{ id: string; text: string; createdAt: string }> }>();
        for (const fu of rows) {
          const display = `${fu.patient.firstName} ${fu.patient.lastName[0]}.`;
          const existing = byPatient.get(fu.patientId);
          if (existing) {
            existing.openCount += 1;
            if (existing.followUps.length < 5) {
              existing.followUps.push({ id: fu.id, text: fu.text, createdAt: fu.createdAt.toISOString() });
            }
          } else {
            byPatient.set(fu.patientId, {
              patientId: fu.patientId,
              patientDisplay: display,
              openCount: 1,
              followUps: [{ id: fu.id, text: fu.text, createdAt: fu.createdAt.toISOString() }],
            });
          }
        }
        const patients = Array.from(byPatient.values()).sort((a, b) => b.openCount - a.openCount).slice(0, limit);
        return {
          ok: true,
          rowCount: patients.length,
          data: { patients, totalOpen: rows.length },
        };
      }

      case 'summarizeMyWeekDone': {
        // Composite: visits signed in the last 7 days + follow-ups closed.
        if (!ctx.clinicianOrgUserId) {
          return { ok: false, error: 'clinician_context_required' };
        }
        const clinicianOrgUserId = ctx.clinicianOrgUserId;
        const args = summarizeMyWeekDoneArgs.parse(argsRaw);
        const endDate = args.endDate ? new Date(`${args.endDate}T23:59:59`) : new Date();
        const startDate = new Date(endDate.getTime() - 7 * 86_400_000);
        const [signedCount, closedFuCount, distinctPatientCount] = await Promise.all([
          prisma.note.count({
            where: {
              orgId: ctx.orgId,
              clinicianOrgUserId,
              status: { in: ['SIGNED', 'TRANSFERRED'] },
              signedAt: { gte: startDate, lte: endDate },
            },
          }),
          prisma.followUp.count({
            where: {
              orgId: ctx.orgId,
              originNote: { clinicianOrgUserId },
              status: { in: ['MET', 'CARRIED', 'DROPPED'] },
              closedAt: { gte: startDate, lte: endDate },
            },
          }),
          (async () => {
            const ns = await prisma.note.findMany({
              where: {
                orgId: ctx.orgId,
                clinicianOrgUserId,
                status: { in: ['SIGNED', 'TRANSFERRED'] },
                signedAt: { gte: startDate, lte: endDate },
              },
              select: { patientId: true },
              distinct: ['patientId'],
            });
            return ns.length;
          })(),
        ]);
        return {
          ok: true,
          rowCount: 1,
          data: {
            from: startDate.toISOString(),
            to: endDate.toISOString(),
            signedNoteCount: signedCount,
            distinctPatientCount,
            followUpsClosedCount: closedFuCount,
          },
        };
      }

      // ===== Tier 11 — learning + calibration =========================

      case 'lookupMyAcceptRate': {
        // Reads COPILOT_DRAFT_PROPOSED / _CONFIRMED / _DISCARDED audit
        // rows for me, computes accept rate per draft kind. Cleo's
        // own self-awareness — let her say "you accept my referral
        // letters 90% but my patient messages 40%".
        if (!ctx.clinicianOrgUserId) {
          return { ok: false, error: 'clinician_context_required' };
        }
        const args = lookupMyAcceptRateArgs.parse(argsRaw);
        const windowDays = args.windowDays ?? 30;
        const since = new Date(Date.now() - windowDays * 86_400_000);
        // userId on AuditLog is the User.id (not OrgUser.id). We resolve
        // via OrgUser → User.
        const orgUser = await prisma.orgUser.findUnique({
          where: { id: ctx.clinicianOrgUserId },
          select: { userId: true },
        });
        if (!orgUser) return { ok: false, error: 'clinician_not_found' };
        const proposed = await prisma.auditLog.findMany({
          where: {
            orgId: ctx.orgId,
            userId: orgUser.userId,
            action: 'COPILOT_DRAFT_PROPOSED',
            createdAt: { gte: since },
          },
          select: { metadata: true },
        });
        const confirmed = await prisma.auditLog.findMany({
          where: {
            orgId: ctx.orgId,
            userId: orgUser.userId,
            action: 'COPILOT_DRAFT_CONFIRMED',
            createdAt: { gte: since },
          },
          select: { metadata: true },
        });
        const discarded = await prisma.auditLog.findMany({
          where: {
            orgId: ctx.orgId,
            userId: orgUser.userId,
            action: 'COPILOT_DRAFT_DISCARDED',
            createdAt: { gte: since },
          },
          select: { metadata: true },
        });
        const tally = (rows: typeof proposed): Record<string, number> => {
          const out: Record<string, number> = {};
          for (const r of rows) {
            const kind = ((r.metadata as { kind?: string } | null)?.kind ?? 'unknown') as string;
            if (args.kind && kind !== args.kind) continue;
            out[kind] = (out[kind] ?? 0) + 1;
          }
          return out;
        };
        const proposedByKind = tally(proposed);
        const confirmedByKind = tally(confirmed);
        const discardedByKind = tally(discarded);
        const allKinds = new Set([...Object.keys(proposedByKind), ...Object.keys(confirmedByKind), ...Object.keys(discardedByKind)]);
        const perKind = Array.from(allKinds).map((k) => {
          const p = proposedByKind[k] ?? 0;
          const c = confirmedByKind[k] ?? 0;
          const d = discardedByKind[k] ?? 0;
          const acceptRate = p > 0 ? c / p : null;
          return { kind: k, proposed: p, confirmed: c, discarded: d, acceptRate };
        });
        return {
          ok: true,
          rowCount: perKind.length,
          data: { windowDays, perKind },
        };
      }

      // ===== Tier 12 — Care Pathway library ===========================

      case 'lookupAvailablePathways': {
        const args = lookupAvailablePathwaysArgs.parse(argsRaw);
        const pathways = await prisma.carePathway.findMany({
          where: {
            orgId: ctx.orgId,
            isDeleted: false,
            ...(args.division ? { division: args.division } : {}),
          },
          orderBy: { name: 'asc' },
          take: args.limit ?? 20,
          select: {
            id: true,
            name: true,
            primaryIcd: true,
            primaryIcdLabel: true,
            division: true,
            evidenceSource: true,
            version: true,
            _count: { select: { steps: true } },
          },
        });
        return {
          ok: true,
          rowCount: pathways.length,
          data: {
            pathways: pathways.map((p) => ({
              id: p.id,
              name: p.name,
              primaryIcd: p.primaryIcd,
              primaryIcdLabel: p.primaryIcdLabel,
              division: p.division,
              evidenceSource: p.evidenceSource,
              version: p.version,
              stepCount: p._count.steps,
            })),
          },
        };
      }

      case 'lookupCarePathway': {
        const args = lookupCarePathwayArgs.parse(argsRaw);
        const pathway = await prisma.carePathway.findFirst({
          where: {
            orgId: ctx.orgId,
            isDeleted: false,
            ...(args.pathwayId
              ? { id: args.pathwayId }
              : { primaryIcd: { startsWith: args.primaryIcd! } }),
          },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            primaryIcd: true,
            primaryIcdLabel: true,
            division: true,
            evidenceSource: true,
            version: true,
            steps: {
              orderBy: { ordinal: 'asc' },
              select: {
                id: true,
                ordinal: true,
                title: true,
                description: true,
                requiredElementsJson: true,
              },
            },
          },
        });
        if (!pathway) return { ok: false, error: 'pathway_not_found' };
        return {
          ok: true,
          rowCount: 1,
          data: {
            pathway: {
              id: pathway.id,
              name: pathway.name,
              primaryIcd: pathway.primaryIcd,
              primaryIcdLabel: pathway.primaryIcdLabel,
              division: pathway.division,
              evidenceSource: pathway.evidenceSource,
              version: pathway.version,
              steps: pathway.steps.map((s) => ({
                id: s.id,
                ordinal: s.ordinal,
                title: s.title,
                description: s.description,
                requiredElements: Array.isArray(s.requiredElementsJson)
                  ? (s.requiredElementsJson as string[])
                  : [],
              })),
            },
          },
        };
      }

      case 'compareDocumentationToPathway': {
        // Sub-LLM compares draft sections against the pathway's per-step
        // requiredElements. Resolves pathway-by-ICD if not supplied.
        const args = compareDocumentationToPathwayArgs.parse(argsRaw);
        const note = await prisma.note.findUnique({
          where: { id: args.noteId },
          select: {
            id: true,
            orgId: true,
            division: true,
            finalJson: true,
            draftJson: true,
            status: true,
            encounter: {
              select: { caseManagement: { select: { primaryIcd: true } } },
            },
          },
        });
        if (!note) return { ok: false, error: 'note_not_found' };
        assertOrgScoped(note.orgId, ctx.orgId);
        const sections = extractSectionsBlob(note);
        if (!sections) return { ok: false, error: 'no_note_content' };
        let pathway: {
          id: string;
          name: string;
          primaryIcd: string;
          primaryIcdLabel: string;
          steps: Array<{ ordinal: number; title: string; description: string; requiredElements: string[] }>;
        } | null = null;
        if (args.pathwayId) {
          const row = await prisma.carePathway.findFirst({
            where: { id: args.pathwayId, orgId: ctx.orgId, isDeleted: false },
            select: {
              id: true,
              name: true,
              primaryIcd: true,
              primaryIcdLabel: true,
              steps: {
                orderBy: { ordinal: 'asc' },
                select: { ordinal: true, title: true, description: true, requiredElementsJson: true },
              },
            },
          });
          if (row) {
            pathway = {
              id: row.id,
              name: row.name,
              primaryIcd: row.primaryIcd,
              primaryIcdLabel: row.primaryIcdLabel,
              steps: row.steps.map((s) => ({
                ordinal: s.ordinal,
                title: s.title,
                description: s.description,
                requiredElements: Array.isArray(s.requiredElementsJson)
                  ? (s.requiredElementsJson as string[])
                  : [],
              })),
            };
          }
        } else {
          const icd = note.encounter?.caseManagement?.primaryIcd;
          if (!icd) return { ok: false, error: 'no_pathway_match' };
          const row = await prisma.carePathway.findFirst({
            where: {
              orgId: ctx.orgId,
              isDeleted: false,
              primaryIcd: { startsWith: icd.slice(0, 3) },
            },
            select: {
              id: true,
              name: true,
              primaryIcd: true,
              primaryIcdLabel: true,
              steps: {
                orderBy: { ordinal: 'asc' },
                select: { ordinal: true, title: true, description: true, requiredElementsJson: true },
              },
            },
          });
          if (row) {
            pathway = {
              id: row.id,
              name: row.name,
              primaryIcd: row.primaryIcd,
              primaryIcdLabel: row.primaryIcdLabel,
              steps: row.steps.map((s) => ({
                ordinal: s.ordinal,
                title: s.title,
                description: s.description,
                requiredElements: Array.isArray(s.requiredElementsJson)
                  ? (s.requiredElementsJson as string[])
                  : [],
              })),
            };
          }
        }
        if (!pathway) return { ok: false, error: 'no_pathway_match' };
        return runPathwayComparison(
          {
            noteId: args.noteId,
            division: note.division,
            sectionsBlob: sections,
            pathway,
          },
          { orgId: ctx.orgId },
        );
      }

      // ===== Tier 13 — Multimedia intake ==============================

      case 'lookupPatientUploads': {
        const args = lookupPatientUploadsArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: { id: true, orgId: true },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);
        // Rule 20 — default to ATTESTED only. The clinician explicitly
        // accepted these into the chart; raw OCR + denied rows do NOT
        // count as source-grounded.
        const statusFilter = args.statusFilter ?? 'attested_only';
        const statusWhere =
          statusFilter === 'attested_only'
            ? { status: 'ATTESTED' as const }
            : statusFilter === 'reviewable'
              ? {
                  status: {
                    in: ['ATTESTED', 'EXTRACTED', 'MANUAL_ONLY'] as PatientUploadStatus[],
                  },
                }
              : {};
        const uploads = await prisma.patientUpload.findMany({
          where: {
            orgId: ctx.orgId,
            patientId: args.patientId,
            isDeleted: false,
            ...(args.kind ? { kind: args.kind } : {}),
            ...statusWhere,
          },
          orderBy: { createdAt: 'desc' },
          take: args.limit ?? 20,
          select: {
            id: true,
            kind: true,
            mimeType: true,
            filename: true,
            byteSize: true,
            status: true,
            createdAt: true,
            attestedAt: true,
            captureContext: true,
            ...(args.includeExtracted
              ? {
                  ocrText: true,
                  extractedJson: true,
                  attestedJson: true,
                  extractionErrorMessage: true,
                }
              : {}),
          },
        });
        return {
          ok: true,
          rowCount: uploads.length,
          data: {
            // Re-state the filter in the response so the agent can cite
            // accurately ("3 attested scans on file" vs "3 scans total").
            statusFilter,
            uploads: uploads.map((u) => {
              const isAttested = u.status === 'ATTESTED';
              return {
                uploadId: u.id,
                kind: u.kind,
                mimeType: u.mimeType,
                filename: u.filename,
                byteSize: u.byteSize,
                status: u.status,
                attestedAt: u.attestedAt?.toISOString() ?? null,
                captureContext: u.captureContext,
                createdAt: u.createdAt.toISOString(),
                ...(args.includeExtracted
                  ? {
                      ocrText:
                        (u as { ocrText?: string | null }).ocrText ?? null,
                      // Rule 20 — ATTESTED rows prefer the clinician-
                      // accepted attestedJson; fall back to the raw
                      // extractedJson only when no attested copy was
                      // recorded (older rows pre-Phase A).
                      extractedJson: isAttested
                        ? (u as { attestedJson?: unknown }).attestedJson ??
                          (u as { extractedJson?: unknown }).extractedJson ??
                          null
                        : (u as { extractedJson?: unknown }).extractedJson ??
                          null,
                      attestedOnly: isAttested,
                      extractionErrorMessage:
                        (u as { extractionErrorMessage?: string | null })
                          .extractionErrorMessage ?? null,
                    }
                  : {}),
              };
            }),
          },
        };
      }

      case 'lookupUploadFindings': {
        const args = lookupUploadFindingsArgs.parse(argsRaw);
        const upload = await prisma.patientUpload.findUnique({
          where: { id: args.uploadId },
          select: {
            id: true,
            orgId: true,
            patientId: true,
            kind: true,
            mimeType: true,
            filename: true,
            status: true,
            ocrText: true,
            extractedJson: true,
            attestedJson: true,
            attestedAt: true,
            captureContext: true,
            extractionErrorMessage: true,
            createdAt: true,
            isDeleted: true,
          },
        });
        if (!upload) return { ok: false, error: 'upload_not_found' };
        assertOrgScoped(upload.orgId, ctx.orgId);
        if (upload.isDeleted) return { ok: false, error: 'upload_deleted' };
        if (upload.status === 'PENDING_EXTRACTION' || upload.status === 'EXTRACTING') {
          return { ok: false, error: 'extraction_pending' };
        }
        if (upload.status === 'EXTRACTION_FAILED') {
          return {
            ok: false,
            error: `extraction_failed:${upload.extractionErrorMessage ?? 'unknown'}`,
          };
        }
        if (upload.status === 'REJECTED') {
          return { ok: false, error: 'upload_rejected' };
        }
        if (upload.status !== 'ATTESTED' && upload.status !== 'EXTRACTED' && upload.status !== 'MANUAL_ONLY') {
          return { ok: false, error: `upload_status:${upload.status}` };
        }
        return {
          ok: true,
          rowCount: 1,
          data: {
            uploadId: upload.id,
            patientId: upload.patientId,
            kind: upload.kind,
            mimeType: upload.mimeType,
            filename: upload.filename,
            status: upload.status,
            ocrText: upload.ocrText,
            extractedJson:
              upload.status === 'ATTESTED'
                ? upload.attestedJson ?? upload.extractedJson
                : upload.extractedJson,
            attestedOnly: upload.status === 'ATTESTED',
            attestedAt: upload.attestedAt?.toISOString() ?? null,
            captureContext: upload.captureContext,
            createdAt: upload.createdAt.toISOString(),
          },
        };
      }

      // ===== Tier 14 — Internal team coordination =====================

      case 'lookupCareTeam': {
        // Returns clinicians who have touched this patient in any
        // significant way: signed notes authored, cases opened,
        // follow-ups resolved. Use this for "who should I notify?".
        const args = lookupCareTeamArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: { id: true, orgId: true },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);
        const [noteAuthors, caseOwners] = await Promise.all([
          prisma.note.findMany({
            where: {
              orgId: ctx.orgId,
              patientId: args.patientId,
              status: { in: ['SIGNED', 'TRANSFERRED'] },
            },
            select: { clinicianOrgUserId: true, division: true, signedAt: true },
            orderBy: { signedAt: 'desc' },
            take: 200,
          }),
          prisma.caseManagement.findMany({
            where: {
              orgId: ctx.orgId,
              patientId: args.patientId,
              status: 'ACTIVE',
            },
            select: { openedByOrgUserId: true },
          }),
        ]);
        const byOrgUserId = new Map<
          string,
          { orgUserId: string; signedNoteCount: number; divisions: Set<string>; lastTouchAt: string }
        >();
        for (const n of noteAuthors) {
          const existing = byOrgUserId.get(n.clinicianOrgUserId);
          const dateIso = (n.signedAt ?? new Date()).toISOString();
          if (existing) {
            existing.signedNoteCount += 1;
            existing.divisions.add(n.division);
            if (dateIso > existing.lastTouchAt) existing.lastTouchAt = dateIso;
          } else {
            byOrgUserId.set(n.clinicianOrgUserId, {
              orgUserId: n.clinicianOrgUserId,
              signedNoteCount: 1,
              divisions: new Set([n.division]),
              lastTouchAt: dateIso,
            });
          }
        }
        // CaseManagement.openedByOrgUserId is nullable (e.g. system-
        // generated PENDING_ROUTER cases) — strip null before building
        // the orgUser fan-out set.
        const caseOwnerIds = new Set(
          caseOwners
            .map((c) => c.openedByOrgUserId)
            .filter((id): id is string => !!id),
        );
        // Resolve display names.
        const orgUsers = await prisma.orgUser.findMany({
          where: { id: { in: Array.from(byOrgUserId.keys()).concat(Array.from(caseOwnerIds)) } },
          select: {
            id: true,
            division: true,
            profession: true,
            user: { select: { name: true, email: true } },
          },
        });
        const orgUserById = new Map(orgUsers.map((ou) => [ou.id, ou]));
        const team = Array.from(byOrgUserId.values()).map((t) => {
          const ou = orgUserById.get(t.orgUserId);
          return {
            orgUserId: t.orgUserId,
            displayName: ou?.user.name ?? ou?.user.email ?? 'Unknown clinician',
            profession: ou?.profession ?? null,
            division: ou?.division ?? null,
            signedNoteCount: t.signedNoteCount,
            divisionsSeen: Array.from(t.divisions),
            lastTouchAt: t.lastTouchAt,
            ownsActiveCase: caseOwnerIds.has(t.orgUserId),
          };
        });
        // Add case owners who never authored a signed note on this patient.
        for (const id of caseOwnerIds) {
          if (byOrgUserId.has(id)) continue;
          const ou = orgUserById.get(id);
          team.push({
            orgUserId: id,
            displayName: ou?.user.name ?? ou?.user.email ?? 'Unknown clinician',
            profession: ou?.profession ?? null,
            division: ou?.division ?? null,
            signedNoteCount: 0,
            divisionsSeen: [],
            lastTouchAt: '',
            ownsActiveCase: true,
          });
        }
        team.sort((a, b) => b.signedNoteCount - a.signedNoteCount);
        return {
          ok: true,
          rowCount: team.length,
          data: { team },
        };
      }

      case 'lookupTeamMessages': {
        if (!ctx.clinicianOrgUserId) {
          return { ok: false, error: 'clinician_context_required' };
        }
        const clinicianOrgUserId = ctx.clinicianOrgUserId;
        const args = lookupTeamMessagesArgs.parse(argsRaw);
        const direction = args.direction ?? 'inbox';
        const limit = args.limit ?? 25;
        const rows = await prisma.internalPatientMessage.findMany({
          where: {
            orgId: ctx.orgId,
            isDeleted: false,
            ...(direction === 'inbox'
              ? { recipientOrgUserId: clinicianOrgUserId }
              : { senderOrgUserId: clinicianOrgUserId }),
            ...(args.patientId ? { patientId: args.patientId } : {}),
            ...(args.status ? { status: args.status } : {}),
          },
          orderBy: { sentAt: 'desc' },
          take: limit,
          select: {
            id: true,
            topic: true,
            urgency: true,
            status: true,
            sentAt: true,
            readAt: true,
            patientId: true,
            senderOrgUserId: true,
            recipientOrgUserId: true,
            contextHref: true,
            patient: { select: { firstName: true, lastName: true } },
            sender: { select: { user: { select: { name: true, email: true } } } },
            recipient: { select: { user: { select: { name: true, email: true } } } },
          },
        });
        return {
          ok: true,
          rowCount: rows.length,
          data: {
            direction,
            messages: rows.map((m) => ({
              messageId: m.id,
              topic: m.topic,
              urgency: m.urgency,
              status: m.status,
              sentAt: m.sentAt.toISOString(),
              readAt: m.readAt?.toISOString() ?? null,
              patientId: m.patientId,
              patientDisplay: `${m.patient.firstName} ${m.patient.lastName[0]}.`,
              senderDisplay: m.sender.user.name ?? m.sender.user.email,
              recipientDisplay: m.recipient.user.name ?? m.recipient.user.email,
              contextHref: m.contextHref,
            })),
          },
        };
      }

      case 'draftTeamMessage': {
        if (!ctx.clinicianOrgUserId) {
          return { ok: false, error: 'clinician_context_required' };
        }
        const args = draftTeamMessageArgs.parse(argsRaw);
        return runDraftTeamMessage(
          {
            ...args,
            senderOrgUserId: ctx.clinicianOrgUserId,
          },
          { orgId: ctx.orgId },
        );
      }

      case 'lookupCommonClinicianEdits': {
        // Reads COPILOT_DRAFT_CONFIRMED audit rows where metadata
        // signals an edit happened (editsLength > 0). Phase 1: surfaces
        // raw event count + kinds. Phase 2 (later) would diff the
        // original draft against the saved version to extract pattern.
        if (!ctx.clinicianOrgUserId) {
          return { ok: false, error: 'clinician_context_required' };
        }
        const args = lookupCommonClinicianEditsArgs.parse(argsRaw);
        const orgUser = await prisma.orgUser.findUnique({
          where: { id: ctx.clinicianOrgUserId },
          select: { userId: true },
        });
        if (!orgUser) return { ok: false, error: 'clinician_not_found' };
        const limit = args.limit ?? 20;
        const rows = await prisma.auditLog.findMany({
          where: {
            orgId: ctx.orgId,
            userId: orgUser.userId,
            action: 'COPILOT_DRAFT_CONFIRMED',
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: { metadata: true, createdAt: true },
        });
        const editEvents = rows
          .map((r) => {
            const m = (r.metadata as { kind?: string; editsLength?: number; contentLength?: number } | null) ?? {};
            return {
              kind: m.kind ?? 'unknown',
              editsLength: m.editsLength ?? 0,
              contentLength: m.contentLength ?? 0,
              at: r.createdAt.toISOString(),
              ratio: m.contentLength ? (m.editsLength ?? 0) / m.contentLength : null,
            };
          })
          .filter((e) => e.editsLength > 0);
        const summaryByKind: Record<string, { count: number; avgEditRatio: number | null }> = {};
        for (const e of editEvents) {
          const s = summaryByKind[e.kind] ?? { count: 0, avgEditRatio: null };
          s.count += 1;
          if (e.ratio != null) {
            const prev = s.avgEditRatio ?? 0;
            s.avgEditRatio = (prev * (s.count - 1) + e.ratio) / s.count;
          }
          summaryByKind[e.kind] = s;
        }
        return {
          ok: true,
          rowCount: editEvents.length,
          data: { editEvents, summaryByKind },
        };
      }

      default:
        return { ok: false, error: `unknown_tool:${name}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof z.ZodError
        ? `args_invalid:${err.issues[0]?.message ?? 'unknown'}`
        : err instanceof Error
          ? err.message.slice(0, 120)
          : 'tool_threw',
    };
  }
}
