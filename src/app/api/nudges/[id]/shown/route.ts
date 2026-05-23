import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { PERSONA_VERSION } from '@/services/copilot/persona';

export const runtime = 'nodejs';

/**
 * POST /api/nudges/[id]/shown — Sprint 0.18.
 *
 * Stamps `shownAt` (once) + flips PROPOSED → SHOWN + emits
 * CLEO_NUDGE_SHOWN. Called by the `<NudgeCard>` component's
 * first-mount effect (decision 5 — "was it actually seen" needs the
 * render lifecycle, not the server-side projection).
 *
 * IDEMPOTENT — repeated calls when `shownAt IS NOT NULL` no-op:
 * return 200, no second update, no second audit. The client uses a
 * `useRef` guard but a remount across navigation can also trigger
 * the call; the server-side guard is the canonical safeguard.
 *
 * Rule 8: audit OUTSIDE swallowing try-catch.
 */
const bodySchema = z.object({
  /** Where the clinician saw the nudge — recorded in audit metadata
   *  so the auditor lens can distinguish chart-only visibility from
   *  visit-prepare-only visibility. */
  surface: z.enum(['CHART', 'VISIT_PREPARE']),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_EDIT', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id: nudgeId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const nudge = await prisma.cleoNudge.findUnique({
    where: { id: nudgeId },
    select: {
      id: true,
      orgId: true,
      status: true,
      kind: true,
      priority: true,
      shownAt: true,
    },
  });
  if (!nudge) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(nudge.orgId, authorizationUser.orgId);

  // Idempotent — already shown.
  if (nudge.shownAt) {
    return NextResponse.json({ data: { ok: true, status: nudge.status } });
  }

  // PROPOSED → SHOWN. Other states are allowed (e.g. a SHOWN nudge
  // that hadn't yet been stamped — defensive); but for the canonical
  // first-mount we only update from PROPOSED. Terminal states are
  // refused to keep the audit signal clean.
  if (
    nudge.status === 'DISMISSED' ||
    nudge.status === 'ACTED' ||
    nudge.status === 'EXPIRED'
  ) {
    return NextResponse.json(
      { error: { code: 'invalid_state', status: nudge.status } },
      { status: 409 },
    );
  }

  await prisma.cleoNudge.update({
    where: { id: nudge.id },
    data: {
      // Only promote PROPOSED → SHOWN; SNOOZED + SHOWN keep their
      // status (the shownAt stamp is sufficient signal that the
      // first-mount audit fired).
      status: nudge.status === 'PROPOSED' ? 'SHOWN' : nudge.status,
      shownAt: new Date(),
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: nudge.orgId,
    action: 'CLEO_NUDGE_SHOWN',
    resourceType: 'CleoNudge',
    resourceId: nudge.id,
    metadata: {
      nudgeId: nudge.id,
      kind: nudge.kind,
      priority: nudge.priority,
      surface: parsed.data.surface,
      personaVersion: PERSONA_VERSION,
    },
  });

  return NextResponse.json({ data: { ok: true, status: 'SHOWN' } });
}
