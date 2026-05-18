import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  draftId: z.string().min(1).max(80),
  kind: z.enum(['patient-message', 'followup-cadence', 'referral-letter']),
  /** Optional one-line reason the clinician chose to discard
   *  (free-text from a confirmation modal in a future polish; v1 leaves
   *  it null). Cap at 200 chars + PHI fence at the audit layer — the
   *  audit row records LENGTH only. */
  reason: z.string().max(200).optional(),
});

/**
 * POST /api/copilot/draft-discard — Unit 30 / Phase 55.
 *
 * Records that the clinician rejected a copilot-suggested draft.
 * NO side effects beyond the audit row. Mirror of draft-confirm —
 * the audit log captures BOTH the agent's suggestion (PROPOSED) and
 * the clinician's decision (DISCARDED) so the auditor can answer
 * "how often does the clinician accept vs. reject the agent's
 * drafts?" from one row type.
 *
 * PHI fence: metadata is draftId + kind + (reason LENGTH if supplied) —
 * NEVER the reason text itself.
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
  const body = parsed.data;

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'COPILOT_DRAFT_DISCARDED',
    resourceType: 'Copilot',
    resourceId: body.draftId,
    metadata: {
      draftId: body.draftId,
      kind: body.kind,
      reasonLength: body.reason?.length ?? 0,
    },
  });

  return NextResponse.json({ data: { ok: true } });
}
