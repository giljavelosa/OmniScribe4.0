import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { runAgent, type AgentTurn } from '@/services/copilot/agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const turnSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool-result']),
  content: z.string().min(1).max(8000),
});

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
  history: z.array(turnSchema).max(20),
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
  const { question, history } = parsed.data;

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
    },
  });
}
