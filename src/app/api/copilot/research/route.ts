import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
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
  question: z.string().min(1).max(2000),
  /** Sprint 0.14 — DB-stored conversation is the source of truth; client
   *  may still send `history` (legacy). Accepted + ignored in favor of
   *  the persisted thread. */
  history: z.array(turnSchema).max(50).optional(),
});

/**
 * POST /api/copilot/research — Unit 29 research mode.
 *
 * Separate endpoint from /api/copilot/ask so the chart-mode and
 * research-mode surfaces can't accidentally share a request shape.
 * Body deliberately OMITS patientId + noteId — research is
 * patient-agnostic (see RESEARCH_SYSTEM_PROMPT rule 3).
 *
 * Auth via NOTE_REVIEW (any clinician with chart-review rights can
 * research; the route doesn't need a stronger gate since literature
 * search is patient-agnostic + the cost is bounded by the LLM iteration
 * budget). Stub-mode safe (LLMService.generate returns canned envelope
 * → agent returns "Bedrock not configured" message).
 *
 * Audit chain (PHI-fenced, same shape as Unit 27 except QUERY uses the
 * Unit 29 action name):
 *   COPILOT_RESEARCH_QUERY → questionLength + historyTurns
 *   COPILOT_TOOL_CALL × N → tool name + rowCount (reuses Unit 27 action)
 *   COPILOT_REASONING_STEP × N → stepIndex + summaryLength (Unit 31;
 *     bounded by MAX_THINK_STEPS = 5; summary text NEVER logged)
 *   COPILOT_ASK_ANSWERED → sourceCount + iterations + stub +
 *     mode: 'research' (auditor counts chart-vs-research from one row
 *     type via metadata.mode)
 *
 * resourceType on every audit row is 'Copilot' (not 'Note') — research
 * isn't anchored to a specific note. Reuses the action name to avoid
 * action-union explosion.
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
  const { question } = parsed.data;

  // Sprint 0.14 — research-mode conversations persist per (org × clinician).
  // patientId is null (research is patient-agnostic). One RESEARCH thread
  // per clinician per org; the partial-unique index in the migration
  // enforces that.
  const { conversation, messages: priorMessages, wasCreated } = await loadOrCreateConversation({
    orgId: authorizationUser.orgId,
    patientId: null,
    clinicianOrgUserId: authorizationUser.orgUserId,
    mode: 'RESEARCH',
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
        mode: 'RESEARCH',
        patientId: null,
        personaVersion: PERSONA_VERSION,
      },
    });
  }
  const history = messagesToAgentHistory(priorMessages);

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'COPILOT_RESEARCH_QUERY',
    resourceType: 'Copilot',
    resourceId: 'research',
    metadata: { questionLength: question.length, historyTurns: history.length },
  });

  const result = await runAgent(
    {
      // patientId/noteId required by AgentInput typing but ignored in
      // research mode (the agent's prompt has no patient context).
      // Pass empty strings + the research mode flag.
      patientId: '',
      noteId: '',
      history: history as AgentTurn[],
      question,
      mode: 'research',
    },
    { orgId: authorizationUser.orgId },
  );

  // Sprint 0.14 — persist the turn into the research conversation.
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

  for (const call of result.toolCalls) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'COPILOT_TOOL_CALL',
      resourceType: 'Copilot',
      resourceId: 'research',
      metadata: {
        tool: call.tool,
        rowCount: call.rowCount,
        resultOk: call.resultOk,
        mode: 'research',
      },
    });
  }

  // Unit 31 — per-reasoning-step audit. PHI-fenced: index + length only;
  // the summary text is never logged. Bounded by MAX_THINK_STEPS = 5.
  for (const step of result.reasoningSteps) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'COPILOT_REASONING_STEP',
      resourceType: 'Copilot',
      resourceId: 'research',
      metadata: {
        stepIndex: step.index,
        summaryLength: step.summary.length,
        mode: 'research',
      },
    });
  }

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'COPILOT_ASK_ANSWERED',
    resourceType: 'Copilot',
    resourceId: 'research',
    metadata: {
      sourceCount: result.answer.sources.length,
      iterations: result.iterations,
      stub: result.stub,
      isClarification: result.answer.isClarification,
      toolCallCount: result.toolCalls.length,
      reasoningStepCount: result.reasoningSteps.length,
      mode: 'research',
      // Phase 1B — auditor-queryable signal for the LLM-knowledge
      // fallback path. 'llm-intrinsic' when the model exhausted the
      // vetted corpus and answered from training knowledge; null on
      // every literature-cited answer. PHI-free.
      fallback: result.answer.isLLMKnowledge ? 'llm-intrinsic' : null,
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
      // Unit 31 — chain-of-thought steps to surface as a collapsible
      // chain under the assistant bubble in ResearchSurface.
      reasoningSteps: result.reasoningSteps,
      iterations: result.iterations,
      stub: result.stub,
      // Sprint 0.14 — surface the persistent conversation id so the
      // chat UI can render the "Reset this conversation" menu item.
      conversationId: conversation.id,
    },
  });
}
