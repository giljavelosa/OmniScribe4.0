import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { runAgent, type AgentTurn } from '@/services/copilot/agent';
import { PERSONA_VERSION } from '@/services/copilot/persona';
import {
  appendTurn,
  loadOrCreateConversation,
  messagesToAgentHistory,
} from '@/services/copilot/conversation-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const turnSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool-result']),
  content: z.string().min(1).max(8000),
});

const bodySchema = z.object({
  patientId: z.string().min(1).max(64),
  noteId: z.string().min(1).max(64),
  question: z.string().min(1).max(2000),
  /**
   * Sprint 0.14 — `history` is OPTIONAL now. When present, the client is
   * still sending its in-memory turns (existing surfaces that haven't
   * been updated yet); we accept + ignore in favor of the DB-stored
   * thread to keep semantics consistent across browser sessions. When
   * absent, the server pulls the last N turns from CopilotConversation.
   */
  history: z.array(turnSchema).max(50).optional(),
});

/**
 * POST /api/copilot/ask — Unit 27 / Ask mode v1.
 *
 * Multi-turn agent loop with 4 read-only lookup tools. Returns a
 * structured answer with source pills. Stub-mode safe — when Bedrock
 * isn't configured, returns the canned "set the env var" response so
 * the UI is exercisable.
 *
 * PHI fence on audit metadata:
 *   - COPILOT_ASK_QUERY: question LENGTH only (question text may carry
 *     PHI). One row per request regardless of stub.
 *   - COPILOT_TOOL_CALL: tool name + row count (no args, no content).
 *     One row per tool invocation.
 *   - COPILOT_REASONING_STEP: stepIndex + summaryLength only (the
 *     summary text itself is NEVER logged — the model is instructed to
 *     exclude PHI in summaries, but the audit metadata shape enforces
 *     that even if the model misbehaves). One row per think step,
 *     bounded by MAX_THINK_STEPS = 5.
 *   - COPILOT_ASK_ANSWERED: source count + iteration count + stub
 *     flag. One row per response.
 *
 * The patient + note are resolved up-front for org-scoping; the agent
 * itself relies on per-tool assertOrgScoped guards, but this early
 * check fails closed before any LLM tokens are spent on a wrong-org
 * request.
 */
export async function POST(req: Request) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const { patientId, noteId, question } = parsed.data;

  // Org scope check before spending any LLM tokens.
  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: authorizationUser.orgId },
    select: { id: true, orgId: true, encounter: { select: { episodeOfCareId: true } } },
  });
  if (!note) return NextResponse.json({ error: { code: 'note_not_found' } }, { status: 404 });
  assertOrgScoped(note.orgId, authorizationUser.orgId);

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, orgId: authorizationUser.orgId },
    select: { id: true },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'patient_not_found' } }, { status: 404 });
  }

  // Sprint 0.14 — load (or create) the persistent CHART conversation for
  // this (patient × clinician). Audit CLEO_CONVERSATION_OPENED exactly
  // once when the row is newly created. Lazy create — first message is
  // also conversation birth.
  const { conversation, messages: priorMessages, wasCreated } = await loadOrCreateConversation({
    orgId: authorizationUser.orgId,
    patientId,
    clinicianOrgUserId: authorizationUser.orgUserId,
    mode: 'CHART',
  });
  if (wasCreated) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'CLEO_CONVERSATION_OPENED',
      resourceType: 'CopilotConversation',
      resourceId: conversation.id,
      metadata: {
        conversationId: conversation.id,
        mode: 'CHART',
        patientId,
        personaVersion: PERSONA_VERSION,
      },
    });
  }

  const history = messagesToAgentHistory(priorMessages);

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'COPILOT_ASK_QUERY',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: { questionLength: question.length, historyTurns: history.length },
  });

  const result = await runAgent(
    {
      patientId,
      noteId,
      episodeId: note.encounter?.episodeOfCareId ?? null,
      // Viewer's clinical lens (the requesting clinician's
      // OrgUser.division). The agent's VIEWER LENS block uses this to
      // frame answers; tool results are NOT filtered.
      viewerDivision: authorizationUser.division ?? null,
      // Sprint 0.x — clinicianOrgUserId is plumbed into ToolContext so
      // per-clinician memory tools (lookupCleoPatterns) can find this
      // clinician's CopilotPatientState row. Memory is scoped per
      // (patient × clinician) — never shared across clinicians.
      clinicianOrgUserId: authorizationUser.orgUserId,
      history: history as AgentTurn[],
      question,
    },
    { orgId: authorizationUser.orgId },
  );

  // Sprint 0.14 — persist BOTH the user message AND the assistant turn
  // into the conversation thread. Stub-mode responses still persist so the
  // chat history is accurate even when Bedrock is unconfigured. Source
  // pills land in sourcesJson; the state-builder distills them on next
  // refresh.
  await appendTurn({
    conversationId: conversation.id,
    userContent: question,
    assistantContent: result.answer.text,
    sources: result.answer.sources,
    toolCalls: result.toolCalls.map((c) => ({
      tool: c.tool,
      rowCount: c.rowCount,
      resultOk: c.resultOk,
    })),
  });

  // Per-tool audit (one row each). Suppressed when no tools were called
  // — the answer-only path doesn't need a tool-call audit row.
  for (const call of result.toolCalls) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'COPILOT_TOOL_CALL',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: { tool: call.tool, rowCount: call.rowCount, resultOk: call.resultOk },
    });
  }

  // Unit 30 — per-draft PROPOSED audit row. Metadata is kind +
  // contentLength + draftId; the draft text itself is NEVER logged
  // (PHI-fenced — patient messages may carry health information).
  for (const draft of result.drafts) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'COPILOT_DRAFT_PROPOSED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: {
        draftId: draft.draftId,
        kind: draft.kind,
        contentLength: draft.content.length,
      },
    });
  }

  // Unit 31 — per-reasoning-step audit. PHI fence: metadata records
  // index + summary LENGTH only; the summary text itself is never
  // logged. Bounded by MAX_THINK_STEPS = 5 so volume is capped per
  // ask regardless of how many tools were called.
  for (const step of result.reasoningSteps) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'COPILOT_REASONING_STEP',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: {
        stepIndex: step.index,
        summaryLength: step.summary.length,
      },
    });
  }

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'COPILOT_ASK_ANSWERED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: {
      sourceCount: result.answer.sources.length,
      iterations: result.iterations,
      stub: result.stub,
      isClarification: result.answer.isClarification,
      toolCallCount: result.toolCalls.length,
      draftCount: result.drafts.length,
      reasoningStepCount: result.reasoningSteps.length,
      // Unit 42 — auditor-queryable persona version stamp. PHI-free.
      personaVersion: PERSONA_VERSION,
    },
  });

  return NextResponse.json({
    data: {
      answer: result.answer,
      toolCalls: result.toolCalls.map((c) => ({
        tool: c.tool,
        rowCount: c.rowCount,
        resultOk: c.resultOk,
      })),
      // Drafts ride alongside the assistant message — the chat surface
      // renders each as a DraftCard with Accept / Edit / Discard.
      drafts: result.drafts,
      // Unit 31 — chain-of-thought steps. Empty when the model went
      // straight to tools + answer. The chat surface renders each as a
      // collapsible "Reasoning chain · N steps" chip under the bubble.
      reasoningSteps: result.reasoningSteps,
      iterations: result.iterations,
      stub: result.stub,
      // Sprint 0.14 — surface the persistent conversation id so the
      // chat UI can render the "Reset this conversation" menu item.
      conversationId: conversation.id,
    },
  });
}
