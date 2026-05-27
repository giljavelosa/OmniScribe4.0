import { randomBytes } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { assertOrgScoped } from '@/lib/phi-access';
import { getLLMService, type LLMService } from '@/services/llm';
import { stripJsonFence } from '@/lib/llm/strip-json-fence';
import type { Draft, DraftKind } from './tools';

/**
 * Draft tools — Unit 30 / Phase 55.
 *
 * Each tool runs a focused sub-LLM call to PRODUCE a draft the
 * clinician will review. No autonomous effects — confirm + discard
 * happen in the UI + go through /api/copilot/draft-{confirm,discard}.
 *
 * Per-type system prompt locks tone + structure. Stub-mode returns
 * deterministic canned drafts seeded off patientId so the UI is
 * exercisable end-to-end without a real Bedrock key.
 *
 * Patient context (loaded once per draft call):
 *   - demographics (firstName, lastName, dob, sex)
 *   - most recent signed note's Plan section text (Rule 20: SIGNED/
 *     TRANSFERRED only — no draft data leaks into the suggestion)
 *   - active episode goals (when an episode is in scope)
 *
 * Returns:
 *   { draft: Draft, contextSummary: string }
 *
 * `contextSummary` is a short PHI-free string the audit row can carry
 * ("drew from 1 signed note + 2 active goals"). Source for the
 * assistant message is the underlying note (kind: 'note').
 */

export type DraftToolContext = {
  orgId: string;
};

export type DraftToolResult =
  | { ok: true; rowCount: 1; data: { draft: Draft; contextSummary: string; sourceNoteId: string | null } }
  | { ok: false; error: string };

const DRAFT_SUB_LLM_MAX_TOKENS = 500;

// =====================================================================
// Per-type system prompts
// =====================================================================

const PATIENT_MESSAGE_SYSTEM_PROMPT = `
You write short, plain-language messages from a clinician to a patient. Tone:
warm, direct, 6th-grade reading level. NEVER repeat the patient's full name
in the body (the platform will prepend a greeting). NEVER include clinical
recommendations beyond what the source note's Plan section says.

OUTPUT FORMAT (strict JSON, nothing else):
  { "content": "<message body, 2-4 short paragraphs>",
    "topic": "<one-line subject>",
    "tone": "informational" | "follow-up" | "encouragement" }
`.trim();

const FOLLOWUP_CADENCE_SYSTEM_PROMPT = `
You suggest a follow-up cadence (recheck schedule) based on the patient's
plan + active goals. Return a SHORT JSON object with one suggested
interval (in days from today) + a one-line basis explanation. DO NOT
prescribe multiple appointments; the clinician picks the cadence.

OUTPUT FORMAT (strict JSON, nothing else):
  { "content": "<one-sentence summary, e.g. 'Recheck A1c in 90 days.'>",
    "basis": "<one-line reason>",
    "suggestedIntervals": [ { "label": "first recheck", "days": <int> } ] }
`.trim();

const REFERRAL_LETTER_SYSTEM_PROMPT = `
You draft a brief referral letter from one clinician to a specialist. Tone:
professional, concise. Structure: ONE paragraph history + ONE paragraph
reason for referral + ONE paragraph what the referring clinician would
like done. NEVER include clinical recommendations beyond what the source
note says.

OUTPUT FORMAT (strict JSON, nothing else):
  { "content": "<letter body, 3 short paragraphs>",
    "specialty": "<the specialty being referred to>",
    "reason": "<one-line reason>",
    "recommendedReceiver": "<optional clinic / clinician name suggestion or null>" }
`.trim();

// =====================================================================
// Helpers
// =====================================================================

async function loadPatientContext(patientId: string, orgId: string) {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      id: true,
      orgId: true,
      firstName: true,
      lastName: true,
      dob: true,
      sex: true,
    },
  });
  if (!patient) return null;
  assertOrgScoped(patient.orgId, orgId);

  // Most recent SIGNED note (Rule 20). Pull only the Plan section text.
  const recentSigned = await prisma.note.findFirst({
    where: {
      patientId,
      orgId,
      status: { in: ['SIGNED', 'TRANSFERRED'] },
    },
    orderBy: { signedAt: 'desc' },
    select: {
      id: true,
      signedAt: true,
      finalJson: true,
      encounter: { select: { episodeOfCareId: true } },
    },
  });

  const planText = extractPlanText(recentSigned?.finalJson);
  const episodeId = recentSigned?.encounter?.episodeOfCareId ?? null;
  const activeGoals = episodeId
    ? await prisma.episodeGoal.findMany({
        where: { episodeId, status: { in: ['ACTIVE', 'PARTIALLY_MET'] } },
        orderBy: { createdAt: 'asc' },
        take: 5,
      })
    : [];

  return {
    patient,
    recentSignedNoteId: recentSigned?.id ?? null,
    recentSignedDate: recentSigned?.signedAt?.toISOString().slice(0, 10) ?? null,
    planText,
    activeGoals: activeGoals.map((g) => ({
      text: g.goalText,
      status: g.status,
      type: g.goalType,
    })),
  };
}

function extractPlanText(finalJson: unknown): string | null {
  const obj = finalJson as { sections?: Array<{ label?: string; content?: string }> } | null;
  if (!obj?.sections) return null;
  const plan = obj.sections.find((s) => /plan/i.test(s.label ?? ''));
  return plan?.content?.trim() || null;
}

function newDraftId(): string {
  return `draft-${randomBytes(8).toString('hex')}`;
}

function contextSummary(ctx: Awaited<ReturnType<typeof loadPatientContext>>): string {
  if (!ctx) return 'no patient context';
  const parts = [
    ctx.recentSignedNoteId ? `1 signed note from ${ctx.recentSignedDate}` : 'no prior signed notes',
    ctx.activeGoals.length > 0 ? `${ctx.activeGoals.length} active goals` : null,
  ].filter(Boolean);
  return parts.join(' + ');
}

function parseModelDraftJson(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(stripJsonFence(raw));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// =====================================================================
// Stub-mode synthesis (deterministic per patientId)
// =====================================================================

function stubPatientMessage(): { content: string; topic: string; tone: string } {
  return {
    content: `[stub] Hi — just a quick note to follow up on your visit. We discussed your plan and I want to make sure you're set up for the next step. Reach out if anything comes up before we talk again.`,
    topic: 'Follow-up from your recent visit',
    tone: 'follow-up',
  };
}

function stubFollowupCadence() {
  return {
    content: `[stub] Recheck in 90 days based on the most recent plan.`,
    basis: 'Most-recent signed note + stub-mode default cadence.',
    suggestedIntervals: [{ label: 'first recheck', days: 90 }],
  };
}

function stubReferralLetter(_patientId: string, specialty: string, reason: string) {
  return {
    content: `[stub] Dear Colleague,\n\nI'm referring this patient for ${specialty} evaluation. Recent history is summarized in their chart.\n\nReason for referral: ${reason}.\n\nI'd appreciate your assessment + ongoing recommendations. Please reach out with questions.\n\nThanks.`,
    specialty,
    reason,
    recommendedReceiver: null,
  };
}

// =====================================================================
// Public tool dispatch
// =====================================================================

export async function runDraftPatientMessage(
  args: { patientId: string; topic: string },
  ctx: DraftToolContext,
  llm: LLMService = getLLMService(),
): Promise<DraftToolResult> {
  const pctx = await loadPatientContext(args.patientId, ctx.orgId);
  if (!pctx) return { ok: false, error: 'patient_not_found' };

  const userPrompt = [
    `<topic>${args.topic}</topic>`,
    `<plan_section>\n${pctx.planText ?? '(no plan section in most recent signed note)'}\n</plan_section>`,
    `<patient_initials>${pctx.patient.firstName[0] ?? '?'}${pctx.patient.lastName[0] ?? '?'}</patient_initials>`,
    'Write the patient message. Output strict JSON only.',
  ].join('\n\n');

  const result = await llm.generate(PATIENT_MESSAGE_SYSTEM_PROMPT, userPrompt, {
    phi: true,
    temperature: 0.2,
    jsonMode: true,
    model: 'haiku',
    maxTokens: DRAFT_SUB_LLM_MAX_TOKENS,
    // Unit 35 — cost rollup metering.
    meter: { orgId: ctx.orgId, surface: 'copilot.draft.patientMessage' },
  });
  const stub = !!result.stub;
  const parsed = stub ? stubPatientMessage() : parseModelDraftJson(result.text);
  if (!parsed || typeof parsed.content !== 'string') {
    return { ok: false, error: 'draft_parse_failed' };
  }
  return {
    ok: true,
    rowCount: 1,
    data: {
      draft: {
        draftId: newDraftId(),
        kind: 'patient-message',
        content: parsed.content,
        meta: {
          topic: typeof parsed.topic === 'string' ? parsed.topic : args.topic,
          tone: typeof parsed.tone === 'string' ? parsed.tone : 'informational',
        },
      },
      contextSummary: contextSummary(pctx),
      sourceNoteId: pctx.recentSignedNoteId,
    },
  };
}

export async function runProposeFollowUpCadence(
  args: { patientId: string; basis: string },
  ctx: DraftToolContext,
  llm: LLMService = getLLMService(),
): Promise<DraftToolResult> {
  const pctx = await loadPatientContext(args.patientId, ctx.orgId);
  if (!pctx) return { ok: false, error: 'patient_not_found' };

  const userPrompt = [
    `<basis_hint>${args.basis}</basis_hint>`,
    `<plan_section>\n${pctx.planText ?? '(no plan section)'}\n</plan_section>`,
    `<active_goals>${JSON.stringify(pctx.activeGoals)}</active_goals>`,
    'Suggest a follow-up cadence. Output strict JSON only.',
  ].join('\n\n');

  const result = await llm.generate(FOLLOWUP_CADENCE_SYSTEM_PROMPT, userPrompt, {
    phi: true,
    temperature: 0.2,
    jsonMode: true,
    model: 'haiku',
    maxTokens: DRAFT_SUB_LLM_MAX_TOKENS,
    // Unit 35 — cost rollup metering.
    meter: { orgId: ctx.orgId, surface: 'copilot.draft.followupCadence' },
  });
  const stub = !!result.stub;
  const parsed = stub ? stubFollowupCadence() : parseModelDraftJson(result.text);
  if (!parsed || typeof parsed.content !== 'string') {
    return { ok: false, error: 'draft_parse_failed' };
  }
  const intervalsRaw = parsed.suggestedIntervals;
  const suggestedIntervals = Array.isArray(intervalsRaw)
    ? intervalsRaw
        .filter(
          (i): i is { label: string; days: number } =>
            !!i &&
            typeof (i as { label?: unknown }).label === 'string' &&
            typeof (i as { days?: unknown }).days === 'number',
        )
        .slice(0, 3)
    : [];
  return {
    ok: true,
    rowCount: 1,
    data: {
      draft: {
        draftId: newDraftId(),
        kind: 'followup-cadence',
        content: parsed.content,
        meta: {
          basis: typeof parsed.basis === 'string' ? parsed.basis : args.basis,
          suggestedIntervals,
        },
      },
      contextSummary: contextSummary(pctx),
      sourceNoteId: pctx.recentSignedNoteId,
    },
  };
}

export async function runSuggestReferralLetterContent(
  args: { patientId: string; specialty: string; reason: string },
  ctx: DraftToolContext,
  llm: LLMService = getLLMService(),
): Promise<DraftToolResult> {
  const pctx = await loadPatientContext(args.patientId, ctx.orgId);
  if (!pctx) return { ok: false, error: 'patient_not_found' };

  const userPrompt = [
    `<specialty>${args.specialty}</specialty>`,
    `<reason>${args.reason}</reason>`,
    `<plan_section>\n${pctx.planText ?? '(no plan section)'}\n</plan_section>`,
    `<active_goals>${JSON.stringify(pctx.activeGoals)}</active_goals>`,
    'Draft the referral letter. Output strict JSON only.',
  ].join('\n\n');

  const result = await llm.generate(REFERRAL_LETTER_SYSTEM_PROMPT, userPrompt, {
    phi: true,
    temperature: 0.2,
    jsonMode: true,
    model: 'haiku',
    maxTokens: DRAFT_SUB_LLM_MAX_TOKENS,
    // Unit 35 — cost rollup metering.
    meter: { orgId: ctx.orgId, surface: 'copilot.draft.referralLetter' },
  });
  const stub = !!result.stub;
  const parsed = stub
    ? stubReferralLetter(args.patientId, args.specialty, args.reason)
    : parseModelDraftJson(result.text);
  if (!parsed || typeof parsed.content !== 'string') {
    return { ok: false, error: 'draft_parse_failed' };
  }
  return {
    ok: true,
    rowCount: 1,
    data: {
      draft: {
        draftId: newDraftId(),
        kind: 'referral-letter',
        content: parsed.content,
        meta: {
          specialty: typeof parsed.specialty === 'string' ? parsed.specialty : args.specialty,
          reason: typeof parsed.reason === 'string' ? parsed.reason : args.reason,
          recommendedReceiver:
            typeof parsed.recommendedReceiver === 'string'
              ? parsed.recommendedReceiver
              : null,
        },
      },
      contextSummary: contextSummary(pctx),
      sourceNoteId: pctx.recentSignedNoteId,
    },
  };
}

// =====================================================================
// Tier 3 — analyzeDraftGapAgainstTranscript (sub-LLM, but NOT a draft).
// Returns structured findings the agent cites. Phase 1 implementation —
// the prompt is intentionally narrow; the model returns a JSON array of
// gap entries plus a tiny summary.
// =====================================================================

const DRAFT_GAP_SYSTEM_PROMPT = `
You compare a clinician's just-drafted note against the visit transcript and
surface things the patient or clinician said that did NOT make it into the
draft. You are an auditor, not a co-author. Cite verbatim transcript phrasing.

ABSOLUTE RULES:
1. Source-grounded only. Every gap entry MUST quote a transcript fragment.
   Never invent.
2. Observation, not recommendation. Say "patient mentioned sleep concerns"
   — never "add sleep concerns to plan." The clinician decides.
3. Skip social niceties (greetings, weather, billing logistics). Focus on
   clinically meaningful content.

OUTPUT FORMAT (strict JSON, nothing else):
{
  "gaps": [
    { "category": "subjective" | "objective" | "assessment" | "plan" | "other",
      "transcriptQuote": "<verbatim quote from transcript, ≤200 chars>",
      "observation": "<one short sentence describing what was said but not captured>"
    }
  ],
  "draftedAccurately": ["<one short note per topic that IS well captured>"],
  "summary": "<one sentence — 'N gaps noted across subjective/plan'>"
}

Cap: at most 8 gaps. If nothing is meaningful, return { "gaps": [],
"draftedAccurately": [...], "summary": "..." }.
`.trim();

export async function runDraftGapAnalysis(
  args: { noteId: string; draftBlob: string; transcriptText: string },
  ctx: DraftToolContext,
  llm: LLMService = getLLMService(),
): Promise<
  | {
      ok: true;
      rowCount: number;
      data: {
        gaps: Array<{
          category: string;
          transcriptQuote: string;
          observation: string;
        }>;
        draftedAccurately: string[];
        summary: string;
        noteId: string;
      };
    }
  | { ok: false; error: string }
> {
  const userPrompt = [
    `<draft>\n${args.draftBlob.slice(0, 12_000)}\n</draft>`,
    `<transcript>\n${args.transcriptText.slice(0, 12_000)}\n</transcript>`,
    'Output strict JSON only.',
  ].join('\n\n');
  const result = await llm.generate(DRAFT_GAP_SYSTEM_PROMPT, userPrompt, {
    phi: true,
    temperature: 0,
    jsonMode: true,
    model: 'sonnet',
    maxTokens: 1200,
    meter: { orgId: ctx.orgId, surface: 'copilot.analyze.draftGap' },
  });
  const stub = !!result.stub;
  const parsed = stub
    ? {
        gaps: [],
        draftedAccurately: ['[stub] gap analysis unavailable without Bedrock'],
        summary: '[stub] no analysis performed',
      }
    : parseModelDraftJson(result.text);
  if (!parsed) return { ok: false, error: 'gap_analysis_parse_failed' };
  const gapsRaw = Array.isArray(parsed.gaps) ? parsed.gaps : [];
  const gaps = gapsRaw
    .filter(
      (g): g is { category: string; transcriptQuote: string; observation: string } =>
        !!g &&
        typeof (g as { category?: unknown }).category === 'string' &&
        typeof (g as { transcriptQuote?: unknown }).transcriptQuote === 'string' &&
        typeof (g as { observation?: unknown }).observation === 'string',
    )
    .slice(0, 8);
  const accuratelyRaw = Array.isArray(parsed.draftedAccurately) ? parsed.draftedAccurately : [];
  const draftedAccurately = accuratelyRaw
    .filter((s): s is string => typeof s === 'string')
    .slice(0, 8);
  const summary = typeof parsed.summary === 'string' ? parsed.summary : `${gaps.length} gaps noted`;
  return {
    ok: true,
    rowCount: gaps.length,
    data: {
      gaps,
      draftedAccurately,
      summary,
      noteId: args.noteId,
    },
  };
}

// =====================================================================
// Tier 4 drafts — addendum / goal-update / order-set
// =====================================================================

const ADDENDUM_SYSTEM_PROMPT = `
You draft a post-sign ADDENDUM to a signed clinical note. An addendum is a
SEPARATE record that supplements (never replaces) the signed note. Tone:
clinical, concise, attestation-style. State the date + the addition reason
+ the new information. NEVER include clinical recommendations beyond what
the source signed note says.

OUTPUT FORMAT (strict JSON, nothing else):
{
  "content": "<addendum body, 1-3 short paragraphs starting with the addendum reason>",
  "topic": "<one-line summary of what the addendum adds>"
}
`.trim();

const GOAL_UPDATE_SYSTEM_PROMPT = `
You draft a SHORT goal-progress update for a rehab plan-of-care goal. Tone:
clinical, factual. State the new measure value + a one-line rationale tied
to the goal text. NEVER invent measurements; if the rationale is thin, say so.

OUTPUT FORMAT (strict JSON, nothing else):
{
  "content": "<one or two sentences — the progress note>",
  "deltaNote": "<≤120 char rationale>",
  "newMeasureValue": "<the value being recorded, as the user supplied or 'unchanged'>",
  "newStatus": "ACTIVE" | "MET" | "NOT_MET" | "MODIFIED" | "DISCONTINUED" | "PARTIALLY_MET" | null
}
`.trim();

const ORDER_SET_SYSTEM_PROMPT = `
You suggest a STANDARD order set (labs / imaging / handouts / referrals)
tied to a chief condition. Tone: brief checklist. Group by category. NEVER
include doses. NEVER recommend a specific medication. The clinician chooses.

OUTPUT FORMAT (strict JSON, nothing else):
{
  "content": "<one-line summary of the order set>",
  "labs": [ "<test name>" ],
  "imaging": [ "<study name>" ],
  "handouts": [ "<patient education topic>" ],
  "referrals": [ "<specialty>" ],
  "condition": "<the condition this order set is for>"
}

Cap: at most 6 items per category. Lists may be empty.
`.trim();

export async function runDraftAddendum(
  args: { noteId: string; topic: string },
  ctx: DraftToolContext,
  llm: LLMService = getLLMService(),
): Promise<DraftToolResult> {
  // Rule 20: addendum drafting reads only a SIGNED/TRANSFERRED note. If
  // the note isn't attested, refuse — addenda only make sense after sign.
  const note = await prisma.note.findUnique({
    where: { id: args.noteId },
    select: {
      id: true,
      orgId: true,
      status: true,
      signedAt: true,
      finalJson: true,
      patientId: true,
    },
  });
  if (!note) return { ok: false, error: 'note_not_found' };
  assertOrgScoped(note.orgId, ctx.orgId);
  if (note.status !== 'SIGNED' && note.status !== 'TRANSFERRED') {
    return { ok: false, error: 'note_not_attested' };
  }
  const planText = extractPlanText(note.finalJson);
  const userPrompt = [
    `<topic>${args.topic}</topic>`,
    `<signed_date>${note.signedAt?.toISOString().slice(0, 10) ?? 'unknown'}</signed_date>`,
    `<plan_section>\n${planText ?? '(no plan section in signed note)'}\n</plan_section>`,
    'Draft the addendum. Output strict JSON only.',
  ].join('\n\n');
  const result = await llm.generate(ADDENDUM_SYSTEM_PROMPT, userPrompt, {
    phi: true,
    temperature: 0.2,
    jsonMode: true,
    model: 'haiku',
    maxTokens: DRAFT_SUB_LLM_MAX_TOKENS,
    meter: { orgId: ctx.orgId, surface: 'copilot.draft.addendum' },
  });
  const stub = !!result.stub;
  const parsed = stub
    ? {
        content: `[stub] ADDENDUM (${new Date().toISOString().slice(0, 10)}): ${args.topic}. Additional context added after the visit.`,
        topic: args.topic,
      }
    : parseModelDraftJson(result.text);
  if (!parsed || typeof parsed.content !== 'string') {
    return { ok: false, error: 'draft_parse_failed' };
  }
  return {
    ok: true,
    rowCount: 1,
    data: {
      draft: {
        draftId: newDraftId(),
        kind: 'addendum',
        content: parsed.content,
        meta: {
          topic: typeof parsed.topic === 'string' ? parsed.topic : args.topic,
          noteId: args.noteId,
          signedAt: note.signedAt?.toISOString() ?? null,
        },
      },
      // Light context summary — full PHI-fenced.
      contextSummary: `signed-note ${note.signedAt?.toISOString().slice(0, 10) ?? '?'}`,
      sourceNoteId: note.id,
    },
  };
}

export async function runDraftGoalUpdate(
  args: {
    episodeId: string;
    goalId: string;
    newMeasureValue?: string;
    newStatus?: string;
    rationale?: string;
  },
  ctx: DraftToolContext,
  llm: LLMService = getLLMService(),
): Promise<DraftToolResult> {
  const goal = await prisma.episodeGoal.findUnique({
    where: { id: args.goalId },
    select: {
      id: true,
      goalText: true,
      status: true,
      currentMeasure: true,
      targetMeasure: true,
      episode: {
        select: {
          id: true,
          orgId: true,
          patientId: true,
        },
      },
    },
  });
  if (!goal || goal.episode.id !== args.episodeId) {
    return { ok: false, error: 'goal_not_found' };
  }
  assertOrgScoped(goal.episode.orgId, ctx.orgId);

  const userPrompt = [
    `<goal_text>${goal.goalText}</goal_text>`,
    `<current_status>${goal.status}</current_status>`,
    `<current_measure>${goal.currentMeasure ?? '(none)'}</current_measure>`,
    `<target_measure>${goal.targetMeasure ?? '(none)'}</target_measure>`,
    `<proposed_new_measure>${args.newMeasureValue ?? '(unchanged)'}</proposed_new_measure>`,
    `<proposed_new_status>${args.newStatus ?? '(unchanged)'}</proposed_new_status>`,
    `<rationale_hint>${args.rationale ?? '(none)'}</rationale_hint>`,
    'Draft the goal-update note. Output strict JSON only.',
  ].join('\n\n');
  const result = await llm.generate(GOAL_UPDATE_SYSTEM_PROMPT, userPrompt, {
    phi: true,
    temperature: 0.2,
    jsonMode: true,
    model: 'haiku',
    maxTokens: DRAFT_SUB_LLM_MAX_TOKENS,
    meter: { orgId: ctx.orgId, surface: 'copilot.draft.goalUpdate' },
  });
  const stub = !!result.stub;
  const parsed = stub
    ? {
        content: `[stub] Goal updated: ${args.newMeasureValue ?? 'measure unchanged'}; status ${args.newStatus ?? goal.status}.`,
        deltaNote: args.rationale ?? '[stub] no rationale supplied',
        newMeasureValue: args.newMeasureValue ?? 'unchanged',
        newStatus: args.newStatus ?? goal.status,
      }
    : parseModelDraftJson(result.text);
  if (!parsed || typeof parsed.content !== 'string') {
    return { ok: false, error: 'draft_parse_failed' };
  }
  return {
    ok: true,
    rowCount: 1,
    data: {
      draft: {
        draftId: newDraftId(),
        kind: 'goal-update',
        content: parsed.content,
        meta: {
          episodeId: args.episodeId,
          goalId: args.goalId,
          newMeasureValue:
            typeof parsed.newMeasureValue === 'string'
              ? parsed.newMeasureValue
              : args.newMeasureValue ?? null,
          newStatus:
            typeof parsed.newStatus === 'string' ? parsed.newStatus : args.newStatus ?? null,
          deltaNote: typeof parsed.deltaNote === 'string' ? parsed.deltaNote : null,
          goalText: goal.goalText,
        },
      },
      contextSummary: `goal ${goal.goalText.slice(0, 60)}`,
      sourceNoteId: null,
    },
  };
}

export async function runDraftOrderSet(
  args: { patientId: string; condition: string },
  ctx: DraftToolContext,
  llm: LLMService = getLLMService(),
): Promise<DraftToolResult> {
  const pctx = await loadPatientContext(args.patientId, ctx.orgId);
  if (!pctx) return { ok: false, error: 'patient_not_found' };

  const userPrompt = [
    `<condition>${args.condition}</condition>`,
    `<patient_sex>${pctx.patient.sex}</patient_sex>`,
    `<plan_section>\n${pctx.planText ?? '(no plan section)'}\n</plan_section>`,
    `<active_goals>${JSON.stringify(pctx.activeGoals)}</active_goals>`,
    'Suggest the order set. Output strict JSON only.',
  ].join('\n\n');
  const result = await llm.generate(ORDER_SET_SYSTEM_PROMPT, userPrompt, {
    phi: true,
    temperature: 0.2,
    jsonMode: true,
    model: 'haiku',
    maxTokens: DRAFT_SUB_LLM_MAX_TOKENS,
    meter: { orgId: ctx.orgId, surface: 'copilot.draft.orderSet' },
  });
  const stub = !!result.stub;
  const parsed = stub
    ? {
        content: `[stub] Standard ${args.condition} order set.`,
        labs: ['[stub] CBC', '[stub] BMP'],
        imaging: [],
        handouts: [`[stub] ${args.condition} patient handout`],
        referrals: [],
        condition: args.condition,
      }
    : parseModelDraftJson(result.text);
  if (!parsed || typeof parsed.content !== 'string') {
    return { ok: false, error: 'draft_parse_failed' };
  }
  const sliceStr = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string').slice(0, 6) : [];
  return {
    ok: true,
    rowCount: 1,
    data: {
      draft: {
        draftId: newDraftId(),
        kind: 'order-set',
        content: parsed.content,
        meta: {
          condition:
            typeof parsed.condition === 'string' ? parsed.condition : args.condition,
          labs: sliceStr(parsed.labs),
          imaging: sliceStr(parsed.imaging),
          handouts: sliceStr(parsed.handouts),
          referrals: sliceStr(parsed.referrals),
        },
      },
      contextSummary: contextSummary(pctx),
      sourceNoteId: pctx.recentSignedNoteId,
    },
  };
}

// =====================================================================
// Tier 6 — coding + billing analysis (NOT drafts — analysis results)
// =====================================================================

const CPT_SYSTEM_PROMPT = `
You analyze a clinician note's documented elements and suggest CPT
E/M codes the clinician may want to consider. You are NOT a billing
authority — you observe. NEVER say "you should bill X." Say "the
documentation supports X" or "code X may be applicable given Y."

CMS 2021+ Office/Outpatient (99202-99215): driven by either MDM
complexity or total time on the date of service. Score conservatively;
when the documentation is thin, suggest the lower code. When time is
not documented, note that ambiguity.

Use the payer hint (\${payerType}) only as a contextual signal; do
NOT switch coding systems mid-suggestion.

OUTPUT FORMAT (strict JSON, nothing else):
{ "suggestions": [
    { "code": "<5-char CPT>",
      "name": "<short label>",
      "basis": "<one line citing the documented elements>",
      "confidence": "high" | "medium" | "low" },
    ...
  ],
  "caveats": [ "<one-line caveat>", ... ] }
`.trim();

const ICD_SPECIFICITY_SYSTEM_PROMPT = `
You scan a clinician note for ICD-10 codes that could be made more
specific given what's documented. Example: E11.9 (Type 2 DM unspec)
with documented neuropathy → suggest E11.42 (Type 2 DM with
polyneuropathy). NEVER fabricate findings — only suggest specificity
when the documentation explicitly supports it. NEVER make a clinical
recommendation.

OUTPUT FORMAT (strict JSON, nothing else):
{ "suggestions": [
    { "currentCode": "<ICD>",
      "currentLabel": "<short>",
      "suggestedCode": "<ICD>",
      "suggestedLabel": "<short>",
      "basis": "<sentence quoting the documented finding>" },
    ...
  ] }
`.trim();

const BILLABILITY_SYSTEM_PROMPT = `
You audit a clinician note for documentation completeness per CMS
office-visit guidelines. Check whether each of these elements is
PRESENT, PARTIAL, or MISSING:
  - chiefComplaint, hpi, ros, pastMedicalHistory, examination,
    assessment, plan, mdmRiskLevel, timeSpent.
NEVER fabricate. If an element is not documented, mark MISSING — do
not infer.

OUTPUT FORMAT (strict JSON, nothing else):
{ "elements": [
    { "element": "<name>", "status": "PRESENT"|"PARTIAL"|"MISSING",
      "note": "<one line, optional>" }, ...
  ],
  "overallReadiness": "high" | "medium" | "low",
  "summary": "<one-sentence overall assessment>" }
`.trim();

const COMPLETENESS_SYSTEM_PROMPT = `
You audit a clinician note for documentation completeness against the
typical required-element set for the note's division (Primary care,
Rehab, Behavioral, etc.). Output the same shape as the billability
audit but framed around CMS / medical-necessity completeness.

OUTPUT FORMAT (strict JSON, nothing else):
{ "elements": [
    { "element": "<name>", "status": "PRESENT"|"PARTIAL"|"MISSING",
      "note": "<one line, optional>" }, ...
  ],
  "missingForMedicalNecessity": [ "<element name>", ... ],
  "summary": "<one-sentence overall assessment>" }
`.trim();

export type CodingAnalysisInput =
  | {
      kind: 'cpt';
      noteId: string;
      division: string;
      sectionsBlob: Array<{ section: string; content: string }>;
      payerType: string;
    }
  | {
      kind: 'icd-specificity';
      noteId: string;
      division: string;
      sectionsBlob: Array<{ section: string; content: string }>;
      currentIcds: Array<{ code: string; label: string }>;
    }
  | {
      kind: 'billability';
      noteId: string;
      division: string;
      sectionsBlob: Array<{ section: string; content: string }>;
    }
  | {
      kind: 'completeness';
      noteId: string;
      division: string;
      sectionsBlob: Array<{ section: string; content: string }>;
    };

export type CodingAnalysisResult =
  | { ok: true; data: { kind: CodingAnalysisInput['kind']; analysis: Record<string, unknown>; noteId: string }; rowCount: number }
  | { ok: false; error: string };

export async function runCodingAnalysis(
  input: CodingAnalysisInput,
  ctx: DraftToolContext,
  llm: LLMService = getLLMService(),
): Promise<CodingAnalysisResult> {
  const promptByKind: Record<CodingAnalysisInput['kind'], string> = {
    cpt: CPT_SYSTEM_PROMPT,
    'icd-specificity': ICD_SPECIFICITY_SYSTEM_PROMPT,
    billability: BILLABILITY_SYSTEM_PROMPT,
    completeness: COMPLETENESS_SYSTEM_PROMPT,
  };
  const userPrompt = [
    `<note_id>${input.noteId}</note_id>`,
    `<division>${input.division}</division>`,
    input.kind === 'cpt' ? `<payer_type>${input.payerType}</payer_type>` : '',
    input.kind === 'icd-specificity'
      ? `<current_icds>${JSON.stringify(input.currentIcds)}</current_icds>`
      : '',
    `<note_sections>\n${JSON.stringify(input.sectionsBlob)}\n</note_sections>`,
    'Analyze. Output strict JSON only.',
  ]
    .filter(Boolean)
    .join('\n\n');
  const result = await llm.generate(promptByKind[input.kind], userPrompt, {
    phi: true,
    temperature: 0.1,
    jsonMode: true,
    model: 'haiku',
    maxTokens: DRAFT_SUB_LLM_MAX_TOKENS,
    meter: { orgId: ctx.orgId, surface: `copilot.analysis.${input.kind}` },
  });
  if (result.stub) {
    return {
      ok: true,
      rowCount: 1,
      data: {
        kind: input.kind,
        noteId: input.noteId,
        analysis: stubAnalysis(input),
      },
    };
  }
  const parsed = parseModelDraftJson(result.text);
  if (!parsed) {
    return { ok: false, error: 'analysis_parse_failed' };
  }
  return {
    ok: true,
    rowCount: 1,
    data: { kind: input.kind, noteId: input.noteId, analysis: parsed },
  };
}

function stubAnalysis(input: CodingAnalysisInput): Record<string, unknown> {
  if (input.kind === 'cpt') {
    return {
      suggestions: [
        { code: '99213', name: '[stub] E/M Established Pt Lvl 3', basis: '[stub] moderate MDM', confidence: 'medium' },
      ],
      caveats: ['[stub] no real coding inference performed'],
    };
  }
  if (input.kind === 'icd-specificity') {
    return {
      suggestions: input.currentIcds.slice(0, 1).map((i) => ({
        currentCode: i.code,
        currentLabel: i.label,
        suggestedCode: i.code,
        suggestedLabel: '[stub] no change',
        basis: '[stub] no real specificity inference performed',
      })),
    };
  }
  return {
    elements: [
      { element: 'chiefComplaint', status: 'PRESENT', note: '[stub]' },
      { element: 'plan', status: 'PRESENT', note: '[stub]' },
    ],
    overallReadiness: 'medium',
    missingForMedicalNecessity: [],
    summary: '[stub] no real completeness audit performed',
  };
}

// =====================================================================
// Tier 7 — patient-facing letter drafts
// =====================================================================

const AVS_SYSTEM_PROMPT = `
You write an After-Visit Summary for a patient: plain-language,
6th-grade reading level, structured under headings the patient sees.
Use ONLY information from the source note's Assessment + Plan
sections; do NOT add recommendations beyond what was discussed.

OUTPUT FORMAT (strict JSON, nothing else):
{ "content": "<full AVS, markdown allowed>",
  "sections": {
    "whatWeDiscussed": "<one paragraph>",
    "yourPlan": "<bulleted list>",
    "watchFor": "<warning signs, bulleted>",
    "nextSteps": "<next appointment / what to do, one paragraph>"
  } }
`.trim();

const SCHOOL_WORK_SYSTEM_PROMPT = `
You draft a brief letter to a school OR employer documenting medical
restrictions. Tone: professional, no clinical detail beyond what is
NECESSARY to explain the restrictions. NEVER name the diagnosis
unless the restriction would be meaningless without it; prefer
"medical condition" if reasonable.

OUTPUT FORMAT (strict JSON, nothing else):
{ "content": "<letter body, 2-3 short paragraphs>",
  "audience": "school" | "work",
  "durationDays": <int>,
  "restrictions": [ "<one restriction>", ... ] }
`.trim();

const PRIOR_AUTH_SYSTEM_PROMPT = `
You draft a prior-authorization letter to a payer. Tone: professional,
evidence-anchored, addresses medical necessity. Structure:
  1. ONE paragraph: patient context + condition
  2. ONE paragraph: what has been tried + why insufficient
  3. ONE paragraph: requested treatment + why it is medically necessary

NEVER make claims beyond what the source note documents.

OUTPUT FORMAT (strict JSON, nothing else):
{ "content": "<letter body, 3 short paragraphs>",
  "treatment": "<as given>",
  "condition": "<as given>",
  "medicalNecessityBullets": [ "<one line>", ... ] }
`.trim();

const DISCHARGE_SUMMARY_SYSTEM_PROMPT = `
You draft a discharge summary for a completed care episode.
Audience: the patient + receiving clinician (PCP). Structure:
  - course of care summary
  - outcomes achieved (cite the goal text + final status)
  - recommended ongoing care
NEVER invent outcomes; use only the episode + goal data given.

OUTPUT FORMAT (strict JSON, nothing else):
{ "content": "<full discharge summary, 4-6 short paragraphs>",
  "courseOfCare": "<paragraph>",
  "outcomes": [ { "goal": "<text>", "finalStatus": "<status>" }, ... ],
  "recommendations": [ "<one line>", ... ] }
`.trim();

const REFERRAL_FEEDBACK_SYSTEM_PROMPT = `
You draft a brief feedback letter from the receiving specialist BACK
to the original referring clinician. Tone: collegial, concise.
Structure:
  1. ONE paragraph: what was found
  2. ONE paragraph: what was done
  3. ONE paragraph: what the PCP can expect / next steps
NEVER cite a recommendation the source note did not contain.

OUTPUT FORMAT (strict JSON, nothing else):
{ "content": "<letter body, 3 short paragraphs>",
  "recipient": "<as given>",
  "findingsSummary": "<one line>" }
`.trim();

export async function runDraftAfterVisitSummary(
  args: { noteId: string },
  ctx: DraftToolContext,
  llm: LLMService = getLLMService(),
): Promise<DraftToolResult> {
  const note = await prisma.note.findUnique({
    where: { id: args.noteId },
    select: {
      id: true,
      orgId: true,
      status: true,
      finalJson: true,
      draftJson: true,
      patient: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!note) return { ok: false, error: 'note_not_found' };
  assertOrgScoped(note.orgId, ctx.orgId);
  const sectionsSource = (note.finalJson ?? note.draftJson) as { sections?: Array<{ label: string; content: string }> } | null;
  if (!sectionsSource?.sections?.length) return { ok: false, error: 'no_note_content' };
  const userPrompt = [
    `<patient_first_name>${note.patient.firstName}</patient_first_name>`,
    `<note_sections>\n${JSON.stringify(sectionsSource.sections)}\n</note_sections>`,
    'Draft the AVS. Output strict JSON only.',
  ].join('\n\n');
  const result = await llm.generate(AVS_SYSTEM_PROMPT, userPrompt, {
    phi: true,
    temperature: 0.2,
    jsonMode: true,
    model: 'haiku',
    maxTokens: DRAFT_SUB_LLM_MAX_TOKENS,
    meter: { orgId: ctx.orgId, surface: 'copilot.draft.avs' },
  });
  const parsed = result.stub
    ? {
        content: `[stub] Today we discussed your care. Your plan is to follow up as needed.`,
        sections: { whatWeDiscussed: '[stub]', yourPlan: '[stub]', watchFor: '[stub]', nextSteps: '[stub]' },
      }
    : parseModelDraftJson(result.text);
  if (!parsed || typeof parsed.content !== 'string') {
    return { ok: false, error: 'draft_parse_failed' };
  }
  return {
    ok: true,
    rowCount: 1,
    data: {
      draft: {
        draftId: newDraftId(),
        kind: 'after-visit-summary',
        content: parsed.content,
        meta: { noteId: note.id, sections: parsed.sections ?? null },
      },
      contextSummary: `drew from 1 note section block (${sectionsSource.sections.length} sections)`,
      sourceNoteId: note.id,
    },
  };
}

export async function runDraftSchoolWorkLetter(
  args: { patientId: string; restrictions: string; durationDays: number; audience: 'school' | 'work' },
  ctx: DraftToolContext,
  llm: LLMService = getLLMService(),
): Promise<DraftToolResult> {
  const pctx = await loadPatientContext(args.patientId, ctx.orgId);
  if (!pctx) return { ok: false, error: 'patient_not_found' };
  const userPrompt = [
    `<patient_first_name>${pctx.patient.firstName}</patient_first_name>`,
    `<patient_last_name>${pctx.patient.lastName}</patient_last_name>`,
    `<audience>${args.audience}</audience>`,
    `<duration_days>${args.durationDays}</duration_days>`,
    `<restrictions>${args.restrictions}</restrictions>`,
    `<plan_section>\n${pctx.planText ?? '(no plan section)'}\n</plan_section>`,
    'Draft the letter. Output strict JSON only.',
  ].join('\n\n');
  const result = await llm.generate(SCHOOL_WORK_SYSTEM_PROMPT, userPrompt, {
    phi: true,
    temperature: 0.2,
    jsonMode: true,
    model: 'haiku',
    maxTokens: DRAFT_SUB_LLM_MAX_TOKENS,
    meter: { orgId: ctx.orgId, surface: 'copilot.draft.schoolWorkLetter' },
  });
  const parsed = result.stub
    ? {
        content: `[stub] To whom it may concern, please excuse the patient for ${args.durationDays} days due to medical reasons. Restrictions: ${args.restrictions}.`,
        audience: args.audience,
        durationDays: args.durationDays,
        restrictions: [args.restrictions],
      }
    : parseModelDraftJson(result.text);
  if (!parsed || typeof parsed.content !== 'string') {
    return { ok: false, error: 'draft_parse_failed' };
  }
  return {
    ok: true,
    rowCount: 1,
    data: {
      draft: {
        draftId: newDraftId(),
        kind: 'school-work-letter',
        content: parsed.content,
        meta: {
          audience: args.audience,
          durationDays: args.durationDays,
          restrictions: Array.isArray(parsed.restrictions)
            ? parsed.restrictions.filter((s: unknown): s is string => typeof s === 'string')
            : [args.restrictions],
        },
      },
      contextSummary: contextSummary(pctx),
      sourceNoteId: pctx.recentSignedNoteId,
    },
  };
}

export async function runDraftPriorAuthLetter(
  args: { patientId: string; treatment: string; condition: string },
  ctx: DraftToolContext,
  llm: LLMService = getLLMService(),
): Promise<DraftToolResult> {
  const pctx = await loadPatientContext(args.patientId, ctx.orgId);
  if (!pctx) return { ok: false, error: 'patient_not_found' };
  const userPrompt = [
    `<patient_first_name>${pctx.patient.firstName}</patient_first_name>`,
    `<treatment>${args.treatment}</treatment>`,
    `<condition>${args.condition}</condition>`,
    `<plan_section>\n${pctx.planText ?? '(no plan section)'}\n</plan_section>`,
    `<active_goals>${JSON.stringify(pctx.activeGoals)}</active_goals>`,
    'Draft the letter. Output strict JSON only.',
  ].join('\n\n');
  const result = await llm.generate(PRIOR_AUTH_SYSTEM_PROMPT, userPrompt, {
    phi: true,
    temperature: 0.2,
    jsonMode: true,
    model: 'haiku',
    maxTokens: DRAFT_SUB_LLM_MAX_TOKENS,
    meter: { orgId: ctx.orgId, surface: 'copilot.draft.priorAuth' },
  });
  const parsed = result.stub
    ? {
        content: `[stub] Requesting prior authorization for ${args.treatment} given ${args.condition}.`,
        treatment: args.treatment,
        condition: args.condition,
        medicalNecessityBullets: ['[stub] documented condition', '[stub] failed prior therapy'],
      }
    : parseModelDraftJson(result.text);
  if (!parsed || typeof parsed.content !== 'string') {
    return { ok: false, error: 'draft_parse_failed' };
  }
  return {
    ok: true,
    rowCount: 1,
    data: {
      draft: {
        draftId: newDraftId(),
        kind: 'prior-auth-letter',
        content: parsed.content,
        meta: {
          treatment: args.treatment,
          condition: args.condition,
          medicalNecessityBullets: Array.isArray(parsed.medicalNecessityBullets)
            ? parsed.medicalNecessityBullets.filter((s: unknown): s is string => typeof s === 'string').slice(0, 6)
            : [],
        },
      },
      contextSummary: contextSummary(pctx),
      sourceNoteId: pctx.recentSignedNoteId,
    },
  };
}

export async function runDraftDischargeSummary(
  args: { episodeId: string },
  ctx: DraftToolContext,
  llm: LLMService = getLLMService(),
): Promise<DraftToolResult> {
  const episode = await prisma.episodeOfCare.findUnique({
    where: { id: args.episodeId },
    select: {
      id: true,
      orgId: true,
      diagnosis: true,
      primaryIcd: true,
      startedAt: true,
      visitsAuthorized: true,
      visitsCompleted: true,
      patient: { select: { id: true, firstName: true, lastName: true } },
      goals: {
        select: { goalText: true, status: true, baselineMeasure: true, targetMeasure: true, currentMeasure: true },
      },
    },
  });
  if (!episode) return { ok: false, error: 'episode_not_found' };
  assertOrgScoped(episode.orgId, ctx.orgId);
  const userPrompt = [
    `<patient_first_name>${episode.patient.firstName}</patient_first_name>`,
    `<diagnosis>${episode.diagnosis}</diagnosis>`,
    `<started_at>${episode.startedAt?.toISOString() ?? ''}</started_at>`,
    `<visits_authorized>${episode.visitsAuthorized ?? ''}</visits_authorized>`,
    `<visits_completed>${episode.visitsCompleted ?? ''}</visits_completed>`,
    `<goals>${JSON.stringify(episode.goals)}</goals>`,
    'Draft the discharge summary. Output strict JSON only.',
  ].join('\n\n');
  const result = await llm.generate(DISCHARGE_SUMMARY_SYSTEM_PROMPT, userPrompt, {
    phi: true,
    temperature: 0.2,
    jsonMode: true,
    model: 'haiku',
    maxTokens: DRAFT_SUB_LLM_MAX_TOKENS,
    meter: { orgId: ctx.orgId, surface: 'copilot.draft.dischargeSummary' },
  });
  const parsed = result.stub
    ? {
        content: `[stub] Patient discharged from episode of care for ${episode.diagnosis}.`,
        courseOfCare: '[stub] course summary',
        outcomes: episode.goals.map((g) => ({ goal: g.goalText, finalStatus: g.status })),
        recommendations: ['[stub] follow up with PCP'],
      }
    : parseModelDraftJson(result.text);
  if (!parsed || typeof parsed.content !== 'string') {
    return { ok: false, error: 'draft_parse_failed' };
  }
  return {
    ok: true,
    rowCount: 1,
    data: {
      draft: {
        draftId: newDraftId(),
        kind: 'discharge-summary',
        content: parsed.content,
        meta: {
          episodeId: episode.id,
          diagnosis: episode.diagnosis,
          outcomes: parsed.outcomes ?? [],
          recommendations: Array.isArray(parsed.recommendations)
            ? parsed.recommendations.filter((s: unknown): s is string => typeof s === 'string').slice(0, 6)
            : [],
        },
      },
      contextSummary: `drew from episode + ${episode.goals.length} goal${episode.goals.length === 1 ? '' : 's'}`,
      sourceNoteId: null,
    },
  };
}

export async function runDraftReferralFeedbackLetter(
  args: { noteId: string; recipient: string },
  ctx: DraftToolContext,
  llm: LLMService = getLLMService(),
): Promise<DraftToolResult> {
  const note = await prisma.note.findUnique({
    where: { id: args.noteId },
    select: {
      id: true,
      orgId: true,
      status: true,
      finalJson: true,
      draftJson: true,
      patient: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!note) return { ok: false, error: 'note_not_found' };
  assertOrgScoped(note.orgId, ctx.orgId);
  const sectionsSource = (note.finalJson ?? note.draftJson) as { sections?: Array<{ label: string; content: string }> } | null;
  if (!sectionsSource?.sections?.length) return { ok: false, error: 'no_note_content' };
  const userPrompt = [
    `<patient_first_name>${note.patient.firstName}</patient_first_name>`,
    `<recipient>${args.recipient}</recipient>`,
    `<note_sections>\n${JSON.stringify(sectionsSource.sections)}\n</note_sections>`,
    'Draft the feedback letter. Output strict JSON only.',
  ].join('\n\n');
  const result = await llm.generate(REFERRAL_FEEDBACK_SYSTEM_PROMPT, userPrompt, {
    phi: true,
    temperature: 0.2,
    jsonMode: true,
    model: 'haiku',
    maxTokens: DRAFT_SUB_LLM_MAX_TOKENS,
    meter: { orgId: ctx.orgId, surface: 'copilot.draft.referralFeedback' },
  });
  const parsed = result.stub
    ? {
        content: `[stub] Dear ${args.recipient}, thank you for the referral. Findings + plan as discussed.`,
        recipient: args.recipient,
        findingsSummary: '[stub]',
      }
    : parseModelDraftJson(result.text);
  if (!parsed || typeof parsed.content !== 'string') {
    return { ok: false, error: 'draft_parse_failed' };
  }
  return {
    ok: true,
    rowCount: 1,
    data: {
      draft: {
        draftId: newDraftId(),
        kind: 'referral-feedback-letter',
        content: parsed.content,
        meta: {
          noteId: note.id,
          recipient: typeof parsed.recipient === 'string' ? parsed.recipient : args.recipient,
          findingsSummary: typeof parsed.findingsSummary === 'string' ? parsed.findingsSummary : '',
        },
      },
      contextSummary: `drew from 1 note section block (${sectionsSource.sections.length} sections)`,
      sourceNoteId: note.id,
    },
  };
}

// =====================================================================
// Tier 12 — Care Pathway comparison sub-LLM
// =====================================================================

const PATHWAY_COMPARE_SYSTEM_PROMPT = `
You audit a clinician note against an organization's documented care
pathway for a condition. For each pathway step, decide whether its
required documentation elements are PRESENT, PARTIAL, or MISSING based
on the note sections you're given.

You are NOT prescribing care. You are NOT recommending the clinician
follow the pathway. You are reporting whether the documentation
*reflects* the pathway. NEVER include phrases like "you should …" or
"the patient needs …" — observation only (rule 24).

OUTPUT FORMAT (strict JSON, nothing else):
{ "steps": [
    { "ordinal": <int>,
      "title": "<step title>",
      "status": "PRESENT" | "PARTIAL" | "MISSING",
      "presentElements": [ "<element name>", ... ],
      "missingElements": [ "<element name>", ... ],
      "note": "<one-line observation, optional>" },
    ...
  ],
  "summary": "<one-sentence overall observation>",
  "alignmentScore": "high" | "medium" | "low" }
`.trim();

export type PathwayComparisonInput = {
  noteId: string;
  division: string;
  sectionsBlob: Array<{ section: string; content: string }>;
  pathway: {
    id: string;
    name: string;
    primaryIcd: string;
    primaryIcdLabel: string;
    steps: Array<{ ordinal: number; title: string; description: string; requiredElements: string[] }>;
  };
};

export type PathwayComparisonResult =
  | {
      ok: true;
      rowCount: number;
      data: {
        pathwayId: string;
        pathwayName: string;
        noteId: string;
        analysis: Record<string, unknown>;
      };
    }
  | { ok: false; error: string };

export async function runPathwayComparison(
  input: PathwayComparisonInput,
  ctx: DraftToolContext,
  llm: LLMService = getLLMService(),
): Promise<PathwayComparisonResult> {
  const userPrompt = [
    `<note_id>${input.noteId}</note_id>`,
    `<division>${input.division}</division>`,
    `<pathway_name>${input.pathway.name}</pathway_name>`,
    `<pathway_icd>${input.pathway.primaryIcd} — ${input.pathway.primaryIcdLabel}</pathway_icd>`,
    `<pathway_steps>${JSON.stringify(input.pathway.steps)}</pathway_steps>`,
    `<note_sections>\n${JSON.stringify(input.sectionsBlob)}\n</note_sections>`,
    'Compare. Output strict JSON only.',
  ].join('\n\n');
  const result = await llm.generate(PATHWAY_COMPARE_SYSTEM_PROMPT, userPrompt, {
    phi: true,
    temperature: 0.1,
    jsonMode: true,
    model: 'haiku',
    maxTokens: DRAFT_SUB_LLM_MAX_TOKENS,
    meter: { orgId: ctx.orgId, surface: 'copilot.analysis.pathwayCompare' },
  });
  if (result.stub) {
    return {
      ok: true,
      rowCount: 1,
      data: {
        pathwayId: input.pathway.id,
        pathwayName: input.pathway.name,
        noteId: input.noteId,
        analysis: {
          steps: input.pathway.steps.map((s) => ({
            ordinal: s.ordinal,
            title: s.title,
            status: 'PRESENT',
            presentElements: s.requiredElements,
            missingElements: [],
            note: '[stub]',
          })),
          summary: '[stub] no real pathway comparison performed',
          alignmentScore: 'medium',
        },
      },
    };
  }
  const parsed = parseModelDraftJson(result.text);
  if (!parsed) {
    return { ok: false, error: 'pathway_compare_parse_failed' };
  }
  return {
    ok: true,
    rowCount: 1,
    data: {
      pathwayId: input.pathway.id,
      pathwayName: input.pathway.name,
      noteId: input.noteId,
      analysis: parsed,
    },
  };
}

// =====================================================================
// Tier 14 — Internal team message draft
// =====================================================================

const TEAM_MESSAGE_SYSTEM_PROMPT = `
You draft a brief in-app message from one clinician to another about a
specific patient. Tone: collegial, concise, professional. Structure:
ONE short paragraph (3-5 sentences). State the relevant context, then
the ask.

NEVER include clinical recommendations beyond what the source note
documents. NEVER speculate. If the clinician supplied a bodyHint, treat
it as the OPENING they have in mind — don't paraphrase past their
phrasing, only refine it.

OUTPUT FORMAT (strict JSON, nothing else):
{ "content": "<message body, ~80 words>",
  "topic": "<short subject as given>" }
`.trim();

export async function runDraftTeamMessage(
  args: {
    patientId: string;
    recipientOrgUserId: string;
    senderOrgUserId: string;
    topic: string;
    contextHref?: string;
    bodyHint?: string;
    urgency?: 'LOW' | 'NORMAL' | 'URGENT';
  },
  ctx: DraftToolContext,
  llm: LLMService = getLLMService(),
): Promise<DraftToolResult> {
  const pctx = await loadPatientContext(args.patientId, ctx.orgId);
  if (!pctx) return { ok: false, error: 'patient_not_found' };
  const recipient = await prisma.orgUser.findUnique({
    where: { id: args.recipientOrgUserId },
    select: {
      orgId: true,
      profession: true,
      division: true,
      user: { select: { name: true, email: true } },
    },
  });
  if (!recipient) return { ok: false, error: 'recipient_not_found' };
  if (recipient.orgId !== ctx.orgId) return { ok: false, error: 'recipient_cross_org' };
  const userPrompt = [
    `<patient_first_name>${pctx.patient.firstName}</patient_first_name>`,
    `<recipient_display>${recipient.user.name ?? recipient.user.email}</recipient_display>`,
    `<recipient_role>${recipient.profession ?? recipient.division}</recipient_role>`,
    `<topic>${args.topic}</topic>`,
    args.urgency ? `<urgency>${args.urgency}</urgency>` : '',
    args.bodyHint ? `<body_hint>${args.bodyHint}</body_hint>` : '',
    `<plan_section>\n${pctx.planText ?? '(no plan section)'}\n</plan_section>`,
    'Draft the message. Output strict JSON only.',
  ]
    .filter(Boolean)
    .join('\n\n');
  const result = await llm.generate(TEAM_MESSAGE_SYSTEM_PROMPT, userPrompt, {
    phi: true,
    temperature: 0.2,
    jsonMode: true,
    model: 'haiku',
    maxTokens: DRAFT_SUB_LLM_MAX_TOKENS,
    meter: { orgId: ctx.orgId, surface: 'copilot.draft.teamMessage' },
  });
  const parsed = result.stub
    ? {
        content: `[stub] Hi ${recipient.user.name ?? 'colleague'}, wanted to flag ${args.topic} for ${pctx.patient.firstName}. Details to follow.`,
        topic: args.topic,
      }
    : parseModelDraftJson(result.text);
  if (!parsed || typeof parsed.content !== 'string') {
    return { ok: false, error: 'draft_parse_failed' };
  }
  return {
    ok: true,
    rowCount: 1,
    data: {
      draft: {
        draftId: newDraftId(),
        kind: 'team-message',
        content: parsed.content,
        meta: {
          patientId: args.patientId,
          senderOrgUserId: args.senderOrgUserId,
          recipientOrgUserId: args.recipientOrgUserId,
          recipientDisplay: recipient.user.name ?? recipient.user.email,
          topic: typeof parsed.topic === 'string' ? parsed.topic : args.topic,
          urgency: args.urgency ?? 'NORMAL',
          contextHref: args.contextHref ?? null,
        },
      },
      contextSummary: contextSummary(pctx),
      sourceNoteId: pctx.recentSignedNoteId,
    },
  };
}

/** Names known to be draft tools — used by runTool dispatcher + audit
 *  layer to flag PROPOSED audit rows + extract drafts for the chat surface. */
export const DRAFT_TOOL_NAMES: ReadonlySet<DraftKind | string> = new Set([
  'draftPatientMessage',
  'proposeFollowUpCadence',
  'suggestReferralLetterContent',
  // Tier 4 drafts (sprint 0.x — scaffold).
  'draftAddendum',
  'draftGoalUpdate',
  'draftOrderSet',
  // Tier 7 drafts (sprint 0.x — scaffold).
  'draftAfterVisitSummary',
  'draftSchoolWorkLetter',
  'draftPriorAuthLetter',
  'draftDischargeSummary',
  'draftReferralFeedbackLetter',
  // Tier 14 draft (sprint 0.19 — scaffold).
  'draftTeamMessage',
]);

/** Map tool name → DraftKind for the PROPOSED audit metadata. */
export function draftKindForTool(name: string): DraftKind | null {
  if (name === 'draftPatientMessage') return 'patient-message';
  if (name === 'proposeFollowUpCadence') return 'followup-cadence';
  if (name === 'suggestReferralLetterContent') return 'referral-letter';
  // Tier 4 drafts (sprint 0.x — scaffold).
  if (name === 'draftAddendum') return 'addendum';
  if (name === 'draftGoalUpdate') return 'goal-update';
  if (name === 'draftOrderSet') return 'order-set';
  // Tier 7 drafts (sprint 0.x — scaffold).
  if (name === 'draftAfterVisitSummary') return 'after-visit-summary';
  if (name === 'draftSchoolWorkLetter') return 'school-work-letter';
  if (name === 'draftPriorAuthLetter') return 'prior-auth-letter';
  if (name === 'draftDischargeSummary') return 'discharge-summary';
  if (name === 'draftReferralFeedbackLetter') return 'referral-feedback-letter';
  // Tier 14 draft (sprint 0.19 — scaffold).
  if (name === 'draftTeamMessage') return 'team-message';
  return null;
}
