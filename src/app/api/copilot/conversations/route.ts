import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { findConversationByTuple } from '@/services/copilot/conversation-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/copilot/conversations?mode=CHART&patientId=…
 *  →  GET /api/copilot/conversations?mode=RESEARCH
 *
 * Sprint 0.14 — hydrate the persisted conversation for the (org × patient
 * × clinician × mode) tuple on AskSurface / ResearchSurface mount. Returns
 * `{ conversation: null, messages: [] }` when no thread exists yet — the
 * surface still renders the empty-state intro + greeting.
 *
 * Auth: NOTE_REVIEW (same gate as POST /api/copilot/ask). Returns only
 * THIS clinician's own conversation — no cross-clinician memory sharing
 * per spec decision 1.
 */
export async function GET(req: Request) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const url = new URL(req.url);
  const mode = (url.searchParams.get('mode') ?? '').toUpperCase();
  if (mode !== 'CHART' && mode !== 'RESEARCH') {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'mode must be CHART or RESEARCH' } },
      { status: 400 },
    );
  }
  const patientId = url.searchParams.get('patientId');
  if (mode === 'CHART' && !patientId) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'patientId required for CHART mode' } },
      { status: 400 },
    );
  }

  const conversation = await findConversationByTuple({
    orgId: authorizationUser.orgId,
    patientId: mode === 'CHART' ? patientId! : null,
    clinicianOrgUserId: authorizationUser.orgUserId,
    mode,
  });

  if (!conversation) {
    return NextResponse.json({
      data: { conversation: null, messages: [] },
    });
  }
  assertOrgScoped(conversation.orgId, authorizationUser.orgId);

  const messages = await prisma.copilotMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({
    data: {
      conversation: {
        id: conversation.id,
        mode: conversation.mode,
        patientId: conversation.patientId,
        startedAt: conversation.startedAt.toISOString(),
        lastActivityAt: conversation.lastActivityAt.toISOString(),
        personaVersion: conversation.personaVersion,
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sources: m.sourcesJson ?? null,
        toolCalls: m.toolCallsJson ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
    },
  });
}
