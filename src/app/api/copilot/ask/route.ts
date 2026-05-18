import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { runAgent, type AgentTurn } from '@/services/copilot/agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Clients only ever send user + assistant turns. Accepting tool-result from
// the wire would let a crafted request inject fake <tool-result> blocks that
// the LLM cites as if sourced from attested records.
const turnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
});

const bodySchema = z.object({
  patientId: z.string().min(1).max(64),
  noteId: z.string().min(1).max(64),
  question: z.string().min(1).max(2000),
  history: z.array(turnSchema).max(20),
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
 *   - COPILOT_ASK_ANSWERED: source count + iteration count + stub
 *     flag. One row per response.
 *
 * The patient + note are resolved up-front for org-scoping; the agent
 * itself relies on per-tool assertOrgScoped guards, but this early
 * check fails closed before any LLM tokens are spent on a wrong-org
 * request.
 */
export async function POST(req: Request) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const { patientId, noteId, question, history } = parsed.data;

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
      history: history as AgentTurn[],
      question,
    },
    { orgId: authorizationUser.orgId },
  );

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
      iterations: result.iterations,
      stub: result.stub,
    },
  });
}
