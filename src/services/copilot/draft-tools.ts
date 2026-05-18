import { randomBytes } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { assertOrgScoped } from '@/lib/phi-access';
import { getLLMService, type LLMService } from '@/services/llm';
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
      division: true,
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
    const v = JSON.parse(raw.trim());
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

/** Names known to be draft tools — used by runTool dispatcher + audit
 *  layer to flag PROPOSED audit rows + extract drafts for the chat surface. */
export const DRAFT_TOOL_NAMES: ReadonlySet<DraftKind | string> = new Set([
  'draftPatientMessage',
  'proposeFollowUpCadence',
  'suggestReferralLetterContent',
]);

/** Map tool name → DraftKind for the PROPOSED audit metadata. */
export function draftKindForTool(name: string): DraftKind | null {
  if (name === 'draftPatientMessage') return 'patient-message';
  if (name === 'proposeFollowUpCadence') return 'followup-cadence';
  if (name === 'suggestReferralLetterContent') return 'referral-letter';
  return null;
}
