import { NextResponse } from 'next/server';

import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { purgeConversation } from '@/services/copilot/conversation-store';
import { PERSONA_VERSION } from '@/services/copilot/persona';

export const runtime = 'nodejs';

/**
 * DELETE /api/copilot/conversations/[id] — Sprint 0.14 reset action.
 *
 * Purges a CopilotConversation row + its CopilotMessage rows (cascade).
 * The CopilotPatientState row is NOT purged — facts already distilled
 * into `conversationFactsJson` survive (they're cited from primary
 * sources, not from the deleted chat content).
 *
 * Auth: NOTE_REVIEW (same gate as POST /api/copilot/ask). A clinician
 * can only reset their OWN conversation — purgeConversation enforces
 * org-scope; the unique-by-tuple invariant guarantees ownership.
 *
 * Rule 8: writeAuditLog is NOT wrapped in swallowing try-catch; a PHI
 * violation throws and bubbles.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  const purged = await purgeConversation({
    orgId: authorizationUser.orgId,
    conversationId: id,
  });
  if (!purged) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'CLEO_CONVERSATION_PURGED',
    resourceType: 'CopilotConversation',
    resourceId: id,
    metadata: {
      conversationId: id,
      mode: purged.mode,
      patientId: purged.patientId,
      messageCount: purged.messageCount,
      personaVersion: PERSONA_VERSION,
    },
  });

  return NextResponse.json({ data: { ok: true } });
}
