import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { PERSONA_VERSION } from '@/services/copilot/persona';

export const runtime = 'nodejs';

/**
 * POST /api/nudges/[id]/dismiss — Sprint 0.18.
 *
 * One-tap dismissal (decision 6 — no `<AlertDialog>` required;
 * dismissal is non-destructive because the pattern will re-emit on
 * the next state rebuild if it persists past the per-kind cooldown
 * window in `nudge-selector.ts`). Flips PROPOSED|SHOWN → DISMISSED,
 * stamps `dismissedAt` + `dismissedByUserId`, writes
 * CLEO_NUDGE_DISMISSED audit.
 *
 * Anti-regression rule 8 — audit OUTSIDE any swallowing try-catch.
 *
 * Idempotent on repeated DISMISSED state (returns 200 with current
 * status, no second audit).
 */
const bodySchema = z.object({
  /** Recorded in the audit metadata so the org-level analytics can
   *  distinguish "dismissed from the chart" vs "dismissed from
   *  visit-prepare". Always one of the two — the UI passes the
   *  active surface. */
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
    select: { id: true, orgId: true, status: true, kind: true, priority: true },
  });
  if (!nudge) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(nudge.orgId, authorizationUser.orgId);

  if (nudge.status === 'DISMISSED') {
    return NextResponse.json({ data: { ok: true, status: 'DISMISSED' } });
  }
  if (nudge.status !== 'PROPOSED' && nudge.status !== 'SHOWN') {
    return NextResponse.json(
      { error: { code: 'invalid_state', status: nudge.status } },
      { status: 409 },
    );
  }

  await prisma.cleoNudge.update({
    where: { id: nudge.id },
    data: {
      status: 'DISMISSED',
      dismissedAt: new Date(),
      dismissedByUserId: user.id,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: nudge.orgId,
    action: 'CLEO_NUDGE_DISMISSED',
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

  return NextResponse.json({ data: { ok: true, status: 'DISMISSED' } });
}
