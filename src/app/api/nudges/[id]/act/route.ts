import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { PERSONA_VERSION } from '@/services/copilot/persona';

export const runtime = 'nodejs';

/**
 * POST /api/nudges/[id]/act — Sprint 0.18.
 *
 * The clinician pressed the contextual affordance (e.g.
 * "Open reconcile flow"). We flip PROPOSED|SHOWN → ACTED, stamp the
 * affordance slug + actor, and emit CLEO_NUDGE_ACTED with the slug
 * in the metadata so the auditor lens can record WHICH path the
 * clinician chose (decision 7 — a generic 'open' slug regresses the
 * auditor).
 *
 * Idempotent on repeated ACT calls (the UI may double-fire on a
 * slow navigation — we return 200 with the current status without
 * a second audit).
 */
const ALLOWED_SLUGS = [
  'open-reconcile-flow',
  'start-recert-visit',
  'open-plan-editor',
  'review-failed-writeback',
  'reevaluate-goal',
] as const;

const bodySchema = z.object({
  affordanceSlug: z.enum(ALLOWED_SLUGS),
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
      patientId: true,
    },
  });
  if (!nudge) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(nudge.orgId, authorizationUser.orgId);

  // Idempotent on already-ACTED.
  if (nudge.status === 'ACTED') {
    return NextResponse.json({ data: { ok: true, status: 'ACTED' } });
  }
  if (
    nudge.status !== 'PROPOSED' &&
    nudge.status !== 'SHOWN' &&
    nudge.status !== 'SNOOZED'
  ) {
    return NextResponse.json(
      { error: { code: 'invalid_state', status: nudge.status } },
      { status: 409 },
    );
  }

  await prisma.cleoNudge.update({
    where: { id: nudge.id },
    data: {
      status: 'ACTED',
      actedAt: new Date(),
      actedByUserId: user.id,
      actedAction: parsed.data.affordanceSlug,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: nudge.orgId,
    action: 'CLEO_NUDGE_ACTED',
    resourceType: 'CleoNudge',
    resourceId: nudge.id,
    metadata: {
      nudgeId: nudge.id,
      kind: nudge.kind,
      priority: nudge.priority,
      affordanceSlug: parsed.data.affordanceSlug,
      personaVersion: PERSONA_VERSION,
    },
  });

  return NextResponse.json({
    data: {
      ok: true,
      status: 'ACTED',
      affordanceSlug: parsed.data.affordanceSlug,
    },
  });
}
