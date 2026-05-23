/**
 * Sprint 0.13 — Miss Cleo's case-router agent service.
 *
 * Single-shot LLM service (NOT a tool loop — the inputs are bounded; we
 * give the model everything it needs in the user message). Returns a
 * Zod-validated CaseRouterProposal that the BullMQ worker persists into
 * a CaseRouterRun row + audits.
 *
 * Persona: prepends `buildPersonaSystemBlock('chart')` + `PERSONA_ANTI_DRIFT_BLOCK`
 * to the system prompt. The agent IS Miss Cleo — same identity, same
 * voice, same anti-drift rules. Rule 24 is enforced by the prompt: the
 * agent does data routing only, never clinical recommendations.
 *
 * Stub-mode awareness: when the LLM service returns a stub envelope
 * (Bedrock not configured), `propose()` returns a synthetic LOW-confidence
 * `open-new` proposal so the worker still writes a CaseRouterRun row +
 * the review-screen panel still renders end-to-end.
 *
 * Output validation: parsed via CaseRouterProposalSchema. On parse failure
 * we fall back to the same synthetic LOW-confidence proposal — never
 * trust an unparseable model output to drive a routing decision.
 */

import { z } from 'zod';

import { getLLMService, type LLMService } from '@/services/llm';
import {
  PERSONA_ANTI_DRIFT_BLOCK,
  PERSONA_VERSION,
  buildPersonaSystemBlock,
} from './persona';

// =============================================================================
// Output schema — Zod-validated proposal shape.
// =============================================================================

const NewCaseSchema = z.object({
  /** ICD-10 when the model is confident; null when "Needs coding". */
  primaryIcd: z.string().nullable(),
  primaryIcdLabel: z.string().min(1).max(280),
  secondaryIcd: z.string().optional(),
  secondaryIcdLabel: z.string().optional(),
});

const SecondaryIcdAdditionSchema = z.object({
  icd: z.string().min(1).max(16),
  icdLabel: z.string().min(1).max(280),
});

/**
 * Sprint 0.15 — payload for the `open-new-from-condition` action. The
 * agent pre-fills these from a verified FHIR Condition; the accept
 * endpoint promotes the pending case with the coded ICD + links via
 * `CaseManagement.mirrorsFhirConditionId`. `primaryIcd` is REQUIRED
 * here (in contrast to plain `open-new`, which permits null + "Needs
 * coding") — the whole point of this action is that we already have
 * a verified coded value.
 */
const NewCaseFromConditionSchema = z.object({
  fhirConditionId: z.string().min(1).max(128),
  primaryIcd: z.string().min(1).max(16),
  primaryIcdLabel: z.string().min(1).max(280),
  recordedDate: z.string().min(1).max(40),
  recorderName: z.string().max(160).nullable(),
});

/** Sprint 0.15 — per-citation audit row payload. Every Condition the
 *  agent considered (whether or not it ended up driving the chosen
 *  action) is recorded here so a regulator can answer "did Cleo have
 *  this data?" in one query. PHI-free — recorder + date are clinician
 *  / institution metadata, not HIPAA Safe Harbor identifiers. */
const FhirCitationSchema = z.object({
  resourceType: z.literal('Condition'),
  fhirId: z.string().min(1).max(128),
  lastUpdated: z.string().min(1).max(40),
  recorder: z.string().max(160).nullable(),
  recordedDate: z.string().min(1).max(40),
});

/** Sprint 0.16 — one of the explicit resolution options the agent
 *  surfaces inside a `reconcileProposal`. Five kinds total — four for
 *  status drift, three for ICD drift (the agent picks 2-4 most
 *  clinically-plausible options per spec decision 4). The clinician
 *  picks one in the review panel; the accept endpoint executes the
 *  chosen mutation atomically with the drift-log resolution. */
const ReconcileResolutionOptionSchema = z.object({
  kind: z.enum([
    'reopen-case',
    'open-new-case',
    'close-case',
    'attach-as-is',
    'update-case-icd',
  ]),
  /** Human label rendered in the radio. Voiced as the resolution
   *  outcome ("Reopen the case as a recurrence"), not the technical
   *  operation. */
  label: z.string().min(1).max(160),
  /** 1-sentence citation — why this is a plausible resolution. */
  reasoning: z.string().min(1).max(600),
});

/** Sprint 0.16 — `reconcile` action payload. Built by the agent when
 *  the worker fed it a `driftSignals` block. Every drift signal the
 *  worker persisted produces exactly one `CaseFhirDriftLog` row; the
 *  proposal references the log by id. */
const ReconcileProposalSchema = z.object({
  driftLogId: z.string().min(1).max(64),
  caseManagementId: z.string().min(1).max(64),
  fhirConditionId: z.string().min(1).max(128),
  driftKind: z.enum(['STATUS', 'ICD']),
  /** 1-2 sentence human-readable summary of WHAT drifted. Rendered as
   *  the body of the amber drift banner. Cites both sides
   *  concretely ("EHR resolved 2025-01-12 by Dr. Park; OmniScribe
   *  case ACTIVE with 11 recent visits"). */
  summary: z.string().min(1).max(800),
  /** 2-4 resolution options ranked by clinical plausibility. */
  resolutionOptions: z.array(ReconcileResolutionOptionSchema).min(2).max(4),
  /** Optional pointer into `resolutionOptions` — the agent's
   *  recommended pre-selection. Index into the array; the UI
   *  pre-checks the matching radio when present. */
  recommendedOptionIndex: z.number().int().min(0).optional(),
});

const AlternativeSchema = z.object({
  // Sprint 0.15 — alternatives can now reference the FHIR-backed action
  // too, so the LOW-confidence fallback view can offer both "attach to
  // existing native case" AND "open new from EHR diagnosis."
  action: z.enum(['attach', 'open-new', 'open-new-from-condition']),
  caseManagementId: z.string().optional(),
  newCase: z
    .object({
      primaryIcd: z.string().nullable(),
      primaryIcdLabel: z.string().min(1).max(280),
    })
    .optional(),
  newCaseFromCondition: NewCaseFromConditionSchema.optional(),
  reasoning: z.string().min(1).max(600),
});

export const CaseRouterProposalSchema = z.object({
  action: z.enum([
    'attach',
    'attach-with-secondary',
    'open-new',
    // Sprint 0.15 — FHIR-backed "open new with verified ICD" path.
    'open-new-from-condition',
    // Sprint 0.16 — drift reconciliation. Surfaced when the agent's
    // input carried driftSignals; ALWAYS at most MEDIUM confidence
    // (decision 7 — the system detected the drift, the clinician
    // chooses how to reconcile).
    'reconcile',
  ]),
  caseManagementId: z.string().optional(),
  newCase: NewCaseSchema.optional(),
  /** Sprint 0.15 — populated only for `open-new-from-condition`. */
  newCaseFromCondition: NewCaseFromConditionSchema.optional(),
  /** Sprint 0.16 — populated only for `reconcile`. */
  reconcileProposal: ReconcileProposalSchema.optional(),
  secondaryIcdAddition: SecondaryIcdAdditionSchema.optional(),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z.string().min(1).max(2000),
  alternatives: z.array(AlternativeSchema).max(3),
  /** Sprint 0.15 — every Condition the agent considered in this run.
   *  Populated by the worker before persisting (the agent doesn't need
   *  to echo back its inputs — we know what we fed it). Optional so
   *  Sprint-0.13 runs (no FHIR inputs) round-trip unchanged. */
  fhirCitations: z.array(FhirCitationSchema).optional(),
});

export type CaseRouterProposal = z.infer<typeof CaseRouterProposalSchema>;
export type CaseRouterAlternative = z.infer<typeof AlternativeSchema>;

// =============================================================================
// Inputs the worker passes per Note.
// =============================================================================

export type CaseRouterCaseInput = {
  id: string;
  primaryIcd: string | null;
  primaryIcdLabel: string;
  secondaryIcd: string | null;
  secondaryIcdLabel: string | null;
  status: 'ACTIVE' | 'CLOSED' | 'CANCELLED' | 'PENDING_ROUTER';
  /** Sprint 0.15 — non-null when the case mirrors a verified FHIR
   *  Condition. Drives Sprint 0.16's drift detection: only mirrored
   *  cases can drift against the EHR. */
  mirrorsFhirConditionId: string | null;
  /** ISO — most recent note activity by *this* viewing clinician. */
  viewerLastActivityAt: string | null;
  /** ISO — most recent note activity by anyone in the viewer's division. */
  viewerDivisionLastActivityAt: string | null;
  /** ISO — most recent note activity overall. */
  lastActivityAt: string | null;
  /** Visit count attributed to the viewer's division on this case. */
  viewerDivisionVisitCount: number;
};

/** Sprint 0.15 — verified FHIR Condition projected into the case-router
 *  agent's input shape. Optional in the input type so non-FHIR runs are
 *  byte-identical to Sprint 0.13. When non-empty, the agent gains a
 *  fourth action option and a citation guidance block.
 *
 *  Sprint 0.16 widens `clinicalStatus` to the FHIR-R4 union to match
 *  the underlying fetcher's projection. `fetchPatientConditions` still
 *  filters to `active` at runtime — the wider type is structural so a
 *  future fetcher can pass enriched data without a contract churn. */
export type FhirConditionInput = {
  fhirId: string;
  icd: string;
  icdLabel: string;
  clinicalStatus: 'active' | 'recurrence' | 'relapse' | 'resolved' | 'remission';
  recordedDate: string;
  recorderName: string | null;
  lastUpdated: string;
};

/** Sprint 0.16 — drift signal projected into the agent's input. The
 *  worker pre-persists a `CaseFhirDriftLog` row per signal and threads
 *  the row id (`driftLogId`) through; the agent echoes it on its
 *  `reconcileProposal` so the accept endpoint can update the matching
 *  log atomically with the case mutation. */
export type DriftSignalInput = {
  driftLogId: string;
  caseManagementId: string;
  fhirConditionId: string;
  driftKind: 'STATUS' | 'ICD';
  caseStatus: 'ACTIVE' | 'CLOSED' | 'CANCELLED' | 'PENDING_ROUTER';
  caseIcd: string | null;
  caseIcdLabel: string | null;
  conditionStatus: 'active' | 'recurrence' | 'relapse' | 'resolved' | 'remission';
  conditionIcd: string;
  conditionIcdLabel: string;
  recordedDate: string;
  recorderName: string | null;
};

export type CaseRouterInput = {
  noteId: string;
  orgId: string;
  patientId: string;
  /** Drafted Note's Assessment text (or empty string when unavailable). */
  assessmentSnippet: string;
  /** Drafted Note's Plan text (or empty string when unavailable). */
  planSnippet: string;
  /** Active + recent cases on this patient (excluding the PENDING_ROUTER
   *  case the encounter is currently bound to). */
  cases: CaseRouterCaseInput[];
  /** The clinician's profession-derived division. Drives the recency
   *  signals in the user prompt + biases pre-selection. */
  clinicianDivision: 'MEDICAL' | 'REHAB' | 'BEHAVIORAL_HEALTH' | 'MULTI' | null;
  /** Drives the cite-this-arc heuristic. */
  noteDivision: 'MEDICAL' | 'REHAB' | 'BEHAVIORAL_HEALTH' | 'MULTI';
  /**
   * Sprint 0.14 — optional cross-visit context block built from this
   * clinician's `CopilotPatientState` (case-awareness + observed
   * patterns). Passed as a pre-formatted string so the case-router
   * service stays free of a prisma dependency (testable in isolation).
   * Backward-compatible: when absent, the agent runs identically to
   * Sprint 0.13.
   *
   * Build with `buildPriorCrossVisitContextBlock` (defined below); the
   * cleo-state worker / case-router worker thread the state through.
   */
  priorCrossVisitContext?: string | null;
  /**
   * Sprint 0.15 — verified FHIR Conditions on this patient (active only,
   * already passed the rule-20 verification gate inside
   * `case-router-fhir.ts`). When present + non-empty, the system prompt
   * grows by the FHIR-citation block below and the agent gains the
   * `open-new-from-condition` action.
   *
   * Backward compatibility (decision 10): when absent / empty, the agent
   * runs identically to Sprint 0.13 / 0.14 — the new action is
   * literally impossible to surface without an input Condition.
   *
   * IDs the agent may reference (the agent is constrained to picking
   * `fhirId` values that appear in this list; the worker rejects
   * hallucinated ids in `validateProposalAgainstInput`).
   */
  fhirConditions?: FhirConditionInput[];
  /**
   * Sprint 0.16 — drift signals detected by `detectDriftSignals` and
   * persisted as `CaseFhirDriftLog` rows. When present + non-empty,
   * the system prompt grows by the drift-handling block + the agent
   * gains the `reconcile` action. Backward-compatible: when
   * absent/empty, the agent runs identically to Sprint 0.15.
   *
   * The worker writes the log rows BEFORE the agent runs so the
   * `driftLogId` is known + threaded through; the agent echoes it on
   * `reconcileProposal.driftLogId`. Hallucinated ids are rejected by
   * `validateProposalAgainstInput`.
   */
  driftSignals?: DriftSignalInput[];
};

// =============================================================================
// Service result.
// =============================================================================

export type CaseRouterRunResult = {
  proposal: CaseRouterProposal;
  /** Family of model that produced the proposal — `'sonnet' | 'haiku' | 'stub' | 'fallback' | 'unknown'`. */
  modelVersion: string;
  /** Full Bedrock model id (or 'stub' / 'fallback'). Audited for traceability. */
  modelId: string;
  stub: boolean;
  /** Set when we returned a synthetic LOW-confidence proposal because the
   *  model couldn't be parsed/validated. The worker logs this in audit
   *  metadata so the auditor sees why the proposal isn't model-authored. */
  fallbackCause?: string;
};

// =============================================================================
// System prompt — persona-prefixed.
// =============================================================================

const ROUTER_INSTRUCTION_BLOCK = `
═══ CASE-ROUTING TASK ═══

You are doing ONE thing: deciding which CaseManagement (an ICD-anchored
care arc) this just-drafted clinical note belongs to. You produce a
structured proposal; the clinician confirms (1 tap) or overrides at
review time. You never sign, edit, or modify the note itself.

Three actions are available:

  1. "attach"
       The note's Assessment + Plan continue an existing case the patient
       already has on file. Set { action: "attach", caseManagementId }.
       Use this whenever the visit is a clear continuation.

  2. "attach-with-secondary"
       Same as attach, BUT today's visit also surfaces a NEW diagnosis
       that fits as a secondary on the same case (e.g. an MD documenting
       both cervicogenic headache AND a new shoulder finding under one
       musculoskeletal arc). Set { action, caseManagementId,
       secondaryIcdAddition: { icd, icdLabel } }. Only use this when the
       chosen case has NO secondary on file already.

  3. "open-new"
       The visit's Assessment + Plan are about a problem none of the
       patient's existing cases cover. Set { action, newCase: { primaryIcd,
       primaryIcdLabel, [secondaryIcd, secondaryIcdLabel] } }.
       primaryIcd may be null when you have a clear label but no
       confident ICD-10; the clinician adds the code later.

  (A fourth action, "open-new-from-condition", is available ONLY when
  the patient has verified EHR-recorded diagnoses — see the FHIR-citation
  block below for the rules. A fifth action, "reconcile", is available
  ONLY when the input carries a drift-signal block — see the
  drift-handling block below for when + how to use it.)

Confidence rubric:

  - "high"   — the case clearly continues a recent arc (cite a specific
               case id) AND the Assessment text uses language that
               matches the case's existing diagnosis arc. Or "open-new"
               when no plausible case exists at all.
  - "medium" — the case fits but you're filling in detail (e.g. the
               plan adds a secondary). Always provide alternatives.
  - "low"    — multiple plausible reads. Surface alternatives; the
               clinician will pick.

Reasoning rule (citational — Miss Cleo's voice):
  - Cite either a specific case id ("Case cm_abc — your last 3 visits
    here") OR a specific Assessment fragment ("The Assessment names
    'right shoulder impingement' as today's primary"). Never speculate.
  - 1–3 sentences max.
  - You may name your own action — "attach to your active case" — but
    NEVER recommend treatment, dosing, follow-up cadence, or anything
    clinical beyond data routing.

Alternatives (max 3):
  - Provide 1–3 alternative actions, ordered by plausibility, when
    confidence is medium or low. Each carries a one-sentence reasoning.
  - High confidence may have 0 alternatives.

DO NOT:
  - Invent ICD codes you didn't see in the inputs. If you don't know one
    use null + a confident label. (The clinician adds the code.)
  - Cite cases by id that aren't in the input list.
  - Output anything that isn't strict JSON matching the schema below.
  - Output any clinical advice beyond routing.

═══ OUTPUT FORMAT (strict JSON, nothing else) ═══

{
  "action": "attach" | "attach-with-secondary" | "open-new" |
             "open-new-from-condition" | "reconcile",
  "caseManagementId": "<id>",            // required for attach + attach-with-secondary
  "newCase": {                              // required for open-new
    "primaryIcd": "<code>" | null,
    "primaryIcdLabel": "<label>",
    "secondaryIcd": "<code>",                // optional
    "secondaryIcdLabel": "<label>"           // optional
  },
  "newCaseFromCondition": {                // required for open-new-from-condition
    "fhirConditionId": "<fhirId from the FHIR-citation block>",
    "primaryIcd": "<code>",                  // required — coded
    "primaryIcdLabel": "<label>",
    "recordedDate": "<YYYY-MM-DD>",
    "recorderName": "<name>" | null
  },
  "reconcileProposal": {                    // required for reconcile (Sprint 0.16)
    "driftLogId": "<driftLogId from the drift-signal block>",
    "caseManagementId": "<id>",
    "fhirConditionId": "<fhirId>",
    "driftKind": "STATUS" | "ICD",
    "summary": "<1–2 sentence citation>",
    "resolutionOptions": [                  // 2–4 entries
      { "kind": "reopen-case" | "open-new-case" | "close-case" |
                "attach-as-is" | "update-case-icd",
        "label": "<verb-phrase clinicians read>",
        "reasoning": "<one sentence>" }
    ],
    "recommendedOptionIndex": <int>          // optional pre-selection
  },
  "secondaryIcdAddition": {                 // required for attach-with-secondary
    "icd": "<code>",
    "icdLabel": "<label>"
  },
  "confidence": "high" | "medium" | "low",
  "reasoning": "<1–3 sentence citation, ≤2000 chars>",
  "alternatives": [
    { "action": "attach" | "open-new" | "open-new-from-condition",
      "caseManagementId": "<id>",
      "newCase": { "primaryIcd": "<code>" | null, "primaryIcdLabel": "<label>" },
      "newCaseFromCondition": { "fhirConditionId": "<id>", "primaryIcd": "<code>",
        "primaryIcdLabel": "<label>", "recordedDate": "<YYYY-MM-DD>",
        "recorderName": "<name>" | null },
      "reasoning": "<one sentence>" },
    ...
  ]
}

The very first character of every response is { and the very last is }.
`.trim();

/**
 * Sprint 0.15 — FHIR-citation guidance block. Appended to the system
 * prompt ONLY when `input.fhirConditions` is non-empty so the
 * Sprint-0.13 / 0.14 prompt is byte-identical for non-FHIR patients
 * (decision 10 — backward compatibility).
 *
 * The instruction is narrow on purpose: prefer the verified-Condition
 * path over a free-text "Needs coding" path when both could apply, and
 * NEVER invent a `fhirConditionId` outside the input list (the worker
 * fails validation on hallucinated ids).
 */
const FHIR_CITATION_BLOCK = `
═══ EHR DIAGNOSIS LIST (FHIR Conditions — verified) ═══

You ALSO have the patient's clinically-active diagnoses as recorded in
the EHR. These are FHIR Condition resources surfaced from the patient's
verified EHR connection — every entry has a coded ICD-10 value and a
documented recorder.

When a clinically-active Condition matches what today's visit is about
AND none of the existing OmniScribe cases above mirror it (no case in
the input list has its mirrorsFhirConditionId set to that Condition's
fhirId), PREFER the action "open-new-from-condition" over a plain
"open-new". Reason: the EHR already coded the diagnosis; we should
inherit that coded value rather than re-asking the clinician.

When you choose "open-new-from-condition":
  - Set newCaseFromCondition.fhirConditionId to one of the fhirId values
    in the FHIR-citation block. NEVER invent an id. If no Condition is
    a real clinical match, fall back to plain "open-new" instead.
  - Copy primaryIcd + primaryIcdLabel from the Condition's icd + label.
  - Echo the Condition's recordedDate + recorderName verbatim — do not
    paraphrase. The provenance pill in the UI relies on these.
  - Cite the recorder + recordedDate in your reasoning so the clinician
    sees the trust signal at a glance ("EHR shows Dr. Patel recorded
    M54.81 on 2024-08-15.").

Existing cases STILL take precedence — if the visit clearly continues
one of the OmniScribe cases above ("attach" / "attach-with-secondary"),
choose that even when a matching Condition also exists. The EHR-coded
path is an alternative to "open-new", not a replacement for "attach".
`.trim();

/**
 * Sprint 0.16 — drift-handling guidance block. Appended to the system
 * prompt ONLY when `input.driftSignals` is non-empty so non-drift runs
 * are byte-identical to Sprint 0.15.
 *
 * The instruction is firm on three rules per the spec:
 *   1. When a drift signal is present on the case that would otherwise
 *      be the best `attach` target, `reconcile` is the REQUIRED top
 *      action — never silently attach over a drift.
 *   2. The `reconcileProposal` must reference one of the `driftLogId`
 *      values surfaced in the drift-signal block (worker validates).
 *   3. Confidence is bounded at `medium` (decision 7) — the system
 *      detected the drift, the clinician resolves it.
 *
 * Resolution-option enums:
 *   STATUS drift options: reopen-case, open-new-case, close-case,
 *                         attach-as-is.
 *   ICD drift options:    update-case-icd, open-new-case, attach-as-is.
 *
 * Per spec decision 4, the agent picks 2–4 of these as the most
 * clinically plausible for THIS specific drift.
 */
const DRIFT_HANDLING_BLOCK = `
═══ DRIFT DETECTION (EHR ↔ OmniScribe disagreement) ═══

You ALSO have a drift-signal block listing OmniScribe cases whose
mirrored FHIR Condition has moved out of sync. Each entry includes:
  - driftLogId (echo verbatim on reconcileProposal.driftLogId)
  - the case's id, status, and ICD
  - the Condition's clinicalStatus, ICD, recordedDate, and recorderName
  - driftKind: "STATUS" (the two systems disagree on case state) or
    "ICD" (they disagree on the coded diagnosis)

RULES:

  1. When a drift signal exists on a case that would otherwise be the
     best "attach" target for this visit, your top action MUST be
     "reconcile" — NEVER "attach". Use the driftLogId from the signal
     block. Do NOT invent driftLogIds; the worker rejects unknown ones.

  2. The "attach" option becomes a resolution choice INSIDE the
     reconcileProposal as kind="attach-as-is" (note the drift, don't
     change either system). It does not appear at the proposal's top
     level when drift is present.

  3. Build reconcileProposal.summary as a 1-2 sentence citation showing
     BOTH sides concretely — e.g. "Your OmniScribe case M17.11 — Right
     knee OA — is ACTIVE with 11 recent visits. The matching EHR
     Condition was marked RESOLVED on 2025-01-12 by Dr. Park." Cite
     the recorder + recordedDate when you have them.

  4. Pick 2-4 resolution options ranked by clinical plausibility.
     For STATUS drift the menu is: reopen-case, open-new-case,
     close-case, attach-as-is. For ICD drift the menu is:
     update-case-icd, open-new-case, attach-as-is. You may include
     "attach-as-is" in BOTH menus as the no-op fallback.

  5. Optionally set recommendedOptionIndex to your top pick. The UI
     pre-selects it; the clinician can still override.

  6. Confidence for "reconcile" is bounded at "medium". NEVER "high".
     The system detected the drift; the right resolution depends on
     clinical judgment.

  7. You may pair "reconcile" with alternatives that propose other
     destinations (e.g. attach to a different non-drifting case), but
     "reconcile" is the primary action when drift exists.
`.trim();

export const CASE_ROUTER_SYSTEM_PROMPT_TAIL = ROUTER_INSTRUCTION_BLOCK;

/**
 * Build the system prompt. Guidance blocks (FHIR-citation,
 * drift-handling) are appended only when the corresponding input
 * shape is non-empty so the prompt stays byte-identical to the prior
 * sprint's output on the no-extra-input path.
 *
 * The booleans are flags (not the inputs themselves) so tests can
 * assert "the block is included" independently of fixture wiring.
 */
export function buildCaseRouterSystemPrompt(
  options: { fhirAware?: boolean; driftAware?: boolean } = {},
): string {
  const blocks: string[] = [
    buildPersonaSystemBlock('chart'),
    PERSONA_ANTI_DRIFT_BLOCK,
    ROUTER_INSTRUCTION_BLOCK,
  ];
  if (options.fhirAware) blocks.push(FHIR_CITATION_BLOCK);
  if (options.driftAware) blocks.push(DRIFT_HANDLING_BLOCK);
  return blocks.join('\n\n');
}

/**
 * Sprint 0.14 — pre-format the cleo-state cross-visit context for the
 * case-router system prompt. Pure function over a state row so callers
 * can build the block without a prisma dependency (the worker reads the
 * state row + invokes this). Returns `null` when nothing useful would be
 * surfaced (empty cases + zero patterns) so the agent prompt stays clean.
 *
 * Rule 24: this block lists what HAPPENED (cited case ids + observed
 * patterns) — never what to do.
 */
export type PriorCrossVisitContextInput = {
  caseAwareness?: {
    cases: Array<{
      id: string;
      primaryIcd: string | null;
      primaryIcdLabel: string;
      status: string;
      lastViewerActivityAt: string | null;
      routingConfidenceHistory?: Array<{
        runId: string;
        confidence: string;
        acceptedAction: string | null;
        at: string;
      }>;
    }>;
  };
  observedPatterns?: {
    patterns: Array<{
      kind: string;
      label: string;
      observedInNoteIds: string[];
      count: number;
    }>;
  };
  lastRebuiltAt?: string | null;
};

export function buildPriorCrossVisitContextBlock(
  state: PriorCrossVisitContextInput | null,
): string | null {
  if (!state) return null;
  const cases = state.caseAwareness?.cases ?? [];
  const patterns = state.observedPatterns?.patterns ?? [];
  if (cases.length === 0 && patterns.length === 0) return null;

  const lines: string[] = ['═══ PRIOR CROSS-VISIT CONTEXT (Miss Cleo memory) ═══', ''];
  lines.push(
    'Background from THIS clinician\'s prior work on this patient (cited',
    'from signed notes + accepted case-router decisions). Use only as',
    'background; the per-visit Assessment + Plan above remain authoritative.',
    '',
  );

  if (cases.length > 0) {
    lines.push('Case awareness:');
    for (const c of cases.slice(0, 6)) {
      const icd = c.primaryIcd ? `${c.primaryIcd} · ${c.primaryIcdLabel}` : c.primaryIcdLabel;
      const lastSeen = c.lastViewerActivityAt
        ? `viewer last visit ${c.lastViewerActivityAt}`
        : 'no viewer history';
      const history = (c.routingConfidenceHistory ?? [])
        .slice(0, 3)
        .map((r) => `${r.confidence}/${r.acceptedAction ?? 'pending'}@${r.at}`)
        .join(', ');
      lines.push(`  - ${c.id}: ${icd} (status ${c.status}; ${lastSeen})`);
      if (history) lines.push(`    routing history: ${history}`);
    }
    lines.push('');
  }

  if (patterns.length > 0) {
    lines.push('Observed patterns (cited from signed notes / goals / episodes):');
    for (const p of patterns.slice(0, 8)) {
      lines.push(
        `  - [${p.kind}] ${p.label} (count: ${p.count}; cited in ${p.observedInNoteIds.length} notes)`,
      );
    }
    lines.push('');
  }

  if (state.lastRebuiltAt) {
    lines.push(`Memory last rebuilt: ${state.lastRebuiltAt}`);
  }
  return lines.join('\n').trim();
}

// =============================================================================
// User message builder.
// =============================================================================

export function buildCaseRouterUserMessage(input: CaseRouterInput): string {
  const cases = input.cases.length === 0
    ? '  (no existing cases — open-new is the only viable action)'
    : input.cases
        .map((c) => {
          const icd = c.primaryIcd ? `${c.primaryIcd} · ${c.primaryIcdLabel}` : c.primaryIcdLabel;
          const sec = c.secondaryIcd ? ` · sec ${c.secondaryIcd} ${c.secondaryIcdLabel ?? ''}`.trimEnd() : '';
          const recency: string[] = [];
          if (c.viewerLastActivityAt) {
            recency.push(`viewer last visit ${c.viewerLastActivityAt}`);
          }
          if (c.viewerDivisionLastActivityAt) {
            recency.push(`viewer-division last activity ${c.viewerDivisionLastActivityAt}`);
          }
          if (c.lastActivityAt) {
            recency.push(`overall last activity ${c.lastActivityAt}`);
          }
          if (c.viewerDivisionVisitCount > 0) {
            recency.push(`viewer-division visits: ${c.viewerDivisionVisitCount}`);
          }
          return [
            `  - id: ${c.id}`,
            `    primary: ${icd}${sec}`,
            `    status: ${c.status}`,
            recency.length > 0 ? `    recency: ${recency.join('; ')}` : '',
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n');

  // Sprint 0.15 — FHIR conditions block (only emitted when the worker
  // passed verified Conditions). Each row already mirrors the
  // FHIR-citation guidance block in the system prompt: fhirId is the
  // value the agent must echo verbatim into `newCaseFromCondition`.
  const fhirBlock =
    input.fhirConditions && input.fhirConditions.length > 0
      ? [
          '',
          '<fhir_conditions ehr="verified, active only">',
          ...input.fhirConditions.map((c) =>
            [
              `  - fhirId: ${c.fhirId}`,
              `    icd: ${c.icd} · ${c.icdLabel}`,
              `    recordedDate: ${c.recordedDate}`,
              `    recorder: ${c.recorderName ?? 'unspecified'}`,
              `    lastUpdated: ${c.lastUpdated}`,
            ].join('\n'),
          ),
          '</fhir_conditions>',
        ].join('\n')
      : '';

  // Sprint 0.16 — drift-signal block (only emitted when the worker
  // pre-persisted CaseFhirDriftLog rows). Each row carries the
  // driftLogId the agent must echo verbatim into
  // `reconcileProposal.driftLogId`; the worker validates against this
  // set, so a hallucinated id falls back to LOW-confidence open-new.
  const driftBlock =
    input.driftSignals && input.driftSignals.length > 0
      ? [
          '',
          '<drift_signals ehr_vs_omniscribe="present">',
          ...input.driftSignals.map((s) =>
            [
              `  - driftLogId: ${s.driftLogId}`,
              `    driftKind: ${s.driftKind}`,
              `    caseManagementId: ${s.caseManagementId}`,
              `    caseStatus: ${s.caseStatus}`,
              `    caseIcd: ${s.caseIcd ?? 'none'} · ${s.caseIcdLabel ?? '(no label)'}`,
              `    fhirConditionId: ${s.fhirConditionId}`,
              `    conditionStatus: ${s.conditionStatus}`,
              `    conditionIcd: ${s.conditionIcd} · ${s.conditionIcdLabel}`,
              `    recordedDate: ${s.recordedDate}`,
              `    recorder: ${s.recorderName ?? 'unspecified'}`,
            ].join('\n'),
          ),
          '</drift_signals>',
        ].join('\n')
      : '';

  return [
    '<context>',
    `  noteId: ${input.noteId}`,
    `  patientId: ${input.patientId}`,
    `  noteDivision: ${input.noteDivision}`,
    `  clinicianDivision: ${input.clinicianDivision ?? 'unknown'}`,
    '</context>',
    '',
    '<existing_cases>',
    cases,
    '</existing_cases>',
    fhirBlock,
    driftBlock,
    '',
    '<draft_note>',
    '  <assessment>',
    `    ${truncate(input.assessmentSnippet, 4000)}`,
    '  </assessment>',
    '  <plan>',
    `    ${truncate(input.planSnippet, 4000)}`,
    '  </plan>',
    '</draft_note>',
    '',
    'Respond with strict JSON only.',
  ]
    .filter((s) => s !== '')
    .join('\n');
}

// =============================================================================
// Service.
// =============================================================================

export class CaseRouterService {
  constructor(private readonly llm: LLMService = getLLMService()) {}

  async propose(input: CaseRouterInput): Promise<CaseRouterRunResult> {
    // Sprint 0.14 — when the cleo-state worker has built a cross-visit
    // context block for this (patient × clinician), append it to the
    // system prompt so the agent gets richer per-visit context.
    // Sprint 0.15 — FHIR-aware: append the FHIR-citation guidance block.
    // Sprint 0.16 — drift-aware: append the drift-handling block when
    // the worker pre-persisted drift signals. All three are backward-
    // compatible: absent inputs → byte-identical prompt.
    const fhirAware =
      Array.isArray(input.fhirConditions) && input.fhirConditions.length > 0;
    const driftAware =
      Array.isArray(input.driftSignals) && input.driftSignals.length > 0;
    const baseSystem = buildCaseRouterSystemPrompt({ fhirAware, driftAware });
    const system = input.priorCrossVisitContext
      ? `${baseSystem}\n\n${input.priorCrossVisitContext}`
      : baseSystem;
    const user = buildCaseRouterUserMessage(input);

    let result;
    try {
      result = await this.llm.generate(system, user, {
        phi: true,
        temperature: 0,
        jsonMode: true,
        model: 'sonnet',
        maxTokens: 1200,
        meter: {
          orgId: input.orgId,
          noteId: input.noteId,
          surface: 'worker.case-router.sonnet',
        },
      });
    } catch (err) {
      // Sonnet failure → try Haiku once. The agent is required to ship
      // *some* proposal so the review panel always renders.
      result = await this.llm.generate(system, user, {
        phi: true,
        temperature: 0,
        jsonMode: true,
        model: 'haiku',
        maxTokens: 1200,
        meter: {
          orgId: input.orgId,
          noteId: input.noteId,
          surface: 'worker.case-router.haiku',
        },
      }).catch(() => null);
      if (!result) {
        return synthesizeLowConfidenceFallback(input, 'sonnet_threw', err);
      }
    }

    const stub = !!result.stub;
    if (stub) {
      return {
        proposal: synthesizeStubProposal(input),
        modelVersion: 'stub',
        modelId: result.model,
        stub: true,
      };
    }

    const parsed = parseProposal(result.text);
    if (!parsed.ok) {
      return synthesizeLowConfidenceFallback(input, parsed.error, undefined, result.model);
    }
    // Cross-validate the proposal against the input cases — a model
    // hallucinating a caseManagementId is a fail-closed event. We coerce
    // to the synthetic fallback to avoid persisting an invalid id.
    const validated = validateProposalAgainstInput(parsed.value, input);
    if (!validated.ok) {
      return synthesizeLowConfidenceFallback(input, validated.error, undefined, result.model);
    }

    return {
      proposal: validated.value,
      modelVersion: modelFamily(result.model),
      modelId: result.model,
      stub: false,
    };
  }
}

// =============================================================================
// Helpers.
// =============================================================================

/** Extract the model family ('sonnet' | 'haiku') from a Bedrock model id. */
function modelFamily(modelId: string): 'sonnet' | 'haiku' | 'stub' | 'unknown' {
  const lc = modelId.toLowerCase();
  if (lc === 'stub') return 'stub';
  if (lc.includes('sonnet')) return 'sonnet';
  if (lc.includes('haiku')) return 'haiku';
  return 'unknown';
}

function parseProposal(rawText: string): { ok: true; value: CaseRouterProposal } | { ok: false; error: string } {
  let trimmed = rawText.trim();
  // Strip markdown code fence if present.
  const fence = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/);
  if (fence?.[1] !== undefined) trimmed = fence[1].trim();

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'parse:non_json' };
  }

  // Stub envelope sneaking past stub flag detection — return a parse failure
  // so the synthesize-fallback path activates and audit shows a clear cause.
  if (
    json &&
    typeof json === 'object' &&
    (json as { stub?: boolean }).stub === true
  ) {
    return { ok: false, error: 'parse:stub_envelope' };
  }

  const result = CaseRouterProposalSchema.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      error: `parse:${result.error.issues[0]?.message ?? 'invalid_shape'}`,
    };
  }
  return { ok: true, value: result.data };
}

function validateProposalAgainstInput(
  proposal: CaseRouterProposal,
  input: CaseRouterInput,
): { ok: true; value: CaseRouterProposal } | { ok: false; error: string } {
  const knownCaseIds = new Set(input.cases.map((c) => c.id));
  // Sprint 0.15 — known FHIR Condition ids from the input. A proposal
  // referencing an id outside this set is a hallucination; fail closed.
  const knownFhirIds = new Set((input.fhirConditions ?? []).map((c) => c.fhirId));
  // Sprint 0.16 — known drift-log ids from the worker-pre-persisted
  // signals. The agent MUST echo a known id on
  // reconcileProposal.driftLogId; otherwise we coerce to the synthetic
  // LOW-confidence fallback (the agent can't invent a row that doesn't
  // exist).
  const knownDriftLogIds = new Set(
    (input.driftSignals ?? []).map((s) => s.driftLogId),
  );

  if (proposal.action === 'attach' || proposal.action === 'attach-with-secondary') {
    if (!proposal.caseManagementId) {
      return { ok: false, error: 'validate:attach_missing_caseManagementId' };
    }
    if (!knownCaseIds.has(proposal.caseManagementId)) {
      return { ok: false, error: 'validate:unknown_caseManagementId' };
    }
  }
  if (proposal.action === 'attach-with-secondary' && !proposal.secondaryIcdAddition) {
    return { ok: false, error: 'validate:secondary_missing_addition' };
  }
  if (proposal.action === 'open-new' && !proposal.newCase) {
    return { ok: false, error: 'validate:open_new_missing_newCase' };
  }
  if (proposal.action === 'open-new-from-condition') {
    if (!proposal.newCaseFromCondition) {
      return { ok: false, error: 'validate:open_new_from_condition_missing_payload' };
    }
    if (!knownFhirIds.has(proposal.newCaseFromCondition.fhirConditionId)) {
      return { ok: false, error: 'validate:unknown_fhirConditionId' };
    }
  }
  let coercedConfidence: CaseRouterProposal['confidence'] | null = null;
  if (proposal.action === 'reconcile') {
    const rp = proposal.reconcileProposal;
    if (!rp) {
      return { ok: false, error: 'validate:reconcile_missing_payload' };
    }
    if (!knownDriftLogIds.has(rp.driftLogId)) {
      return { ok: false, error: 'validate:unknown_driftLogId' };
    }
    if (!knownCaseIds.has(rp.caseManagementId)) {
      return { ok: false, error: 'validate:reconcile_unknown_caseManagementId' };
    }
    // recommendedOptionIndex (if set) must point inside resolutionOptions.
    if (
      rp.recommendedOptionIndex !== undefined &&
      rp.recommendedOptionIndex >= rp.resolutionOptions.length
    ) {
      return { ok: false, error: 'validate:reconcile_recommended_out_of_range' };
    }
    // Spec decision 7 — confidence is bounded at medium for reconcile.
    // Coerce down rather than fail — the rest of the proposal is
    // well-formed, and an over-confident model shouldn't tank the
    // reconciliation surface. The worker's audit metadata still
    // captures the original confidence via fallbackCause / modelVersion
    // diagnostics for the auditor lens.
    if (proposal.confidence === 'high') {
      coercedConfidence = 'medium';
    }
  }
  // Filter alternatives that reference unknown case ids OR unknown
  // FHIR condition ids. A `open-new-from-condition` alternative
  // pointing at an id we didn't provide is a hallucination — drop it
  // silently (the primary action's validation has already passed).
  const alternatives = proposal.alternatives.filter((a) => {
    if (a.action === 'attach') {
      return a.caseManagementId !== undefined && knownCaseIds.has(a.caseManagementId);
    }
    if (a.action === 'open-new-from-condition') {
      return (
        a.newCaseFromCondition !== undefined &&
        knownFhirIds.has(a.newCaseFromCondition.fhirConditionId)
      );
    }
    return true;
  });

  return {
    ok: true,
    value: {
      ...proposal,
      alternatives,
      ...(coercedConfidence ? { confidence: coercedConfidence } : {}),
    },
  };
}

function synthesizeStubProposal(input: CaseRouterInput): CaseRouterProposal {
  return {
    action: 'open-new',
    newCase: {
      primaryIcd: null,
      primaryIcdLabel: 'Routing in progress',
    },
    confidence: 'low',
    reasoning: 'Auto-route unavailable in stub mode — pick manually.',
    alternatives: input.cases.slice(0, 3).map((c) => ({
      action: 'attach' as const,
      caseManagementId: c.id,
      reasoning: `Existing case ${c.primaryIcdLabel} on file.`,
    })),
  };
}

function synthesizeLowConfidenceFallback(
  input: CaseRouterInput,
  cause: string,
  _err?: unknown,
  modelId?: string,
): CaseRouterRunResult {
  return {
    proposal: {
      action: 'open-new',
      newCase: {
        primaryIcd: null,
        primaryIcdLabel: 'Routing in progress',
      },
      confidence: 'low',
      reasoning: 'Auto-route unavailable — pick manually.',
      alternatives: input.cases.slice(0, 3).map((c) => ({
        action: 'attach' as const,
        caseManagementId: c.id,
        reasoning: `Existing case ${c.primaryIcdLabel} on file.`,
      })),
    },
    modelVersion: 'fallback',
    modelId: modelId ?? 'fallback',
    stub: false,
    fallbackCause: cause,
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '… [truncated]';
}

// Re-export persona version so audit metadata callers can stamp it without
// reaching into the persona module.
export { PERSONA_VERSION };
