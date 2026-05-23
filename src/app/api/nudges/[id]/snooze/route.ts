import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { PERSONA_VERSION } from '@/services/copilot/persona';

export const runtime = 'nodejs';

/**
 * POST /api/nudges/[id]/snooze — Sprint 0.18.
 *
 * Defers a nudge until `until` (one of 1d or 7d in Sprint 0.18 —
 * custom snooze durations are deferred per spec "out of scope"). The
 * `nudge-selector.ts` read filter re-surfaces the row once now ≥
 * snoozeUntil; no scheduled job needed (spec §goal — "an expiry sweep
 * baked into the read filter").
 *
 * Body shape mirrors the dismiss route — the UI threads the active
 * surface so the audit metadata distinguishes which surface the
 * clinician snoozed from. Rule 8: audit OUTSIDE swallowing try-catch.
 */
const bodySchema = z.object({
  /** ISO-8601. Server-side bound: max 30 days into the future
   *  (defense against pathological client values). */
  until: z.string().datetime(),
  surface: z.enum(['CHART', 'VISIT_PREPARE']),
});

const MAX_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_EDIT', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id: nudgeId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const snoozeUntil = new Date(parsed.data.until);
  if (
    Number.isNaN(snoozeUntil.getTime()) ||
    snoozeUntil.getTime() < Date.now() ||
    snoozeUntil.getTime() > Date.now() + MAX_SNOOZE_MS
  ) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'invalid snooze window' } },
      { status: 400 },
    );
  }

  const nudge = await prisma.cleoNudge.findUnique({
    where: { id: nudgeId },
    select: { id: true, orgId: true, status: true, kind: true, priority: true },
  });
  if (!nudge) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(nudge.orgId, authorizationUser.orgId);

  if (nudge.status !== 'PROPOSED' && nudge.status !== 'SHOWN' && nudge.status !== 'SNOOZED') {
    return NextResponse.json(
      { error: { code: 'invalid_state', status: nudge.status } },
      { status: 409 },
    );
  }

  await prisma.cleoNudge.update({
    where: { id: nudge.id },
    data: {
      status: 'SNOOZED',
      snoozedAt: new Date(),
      snoozedByUserId: user.id,
      snoozeUntil,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: nudge.orgId,
    action: 'CLEO_NUDGE_SNOOZED',
    resourceType: 'CleoNudge',
    resourceId: nudge.id,
    metadata: {
      nudgeId: nudge.id,
      kind: nudge.kind,
      priority: nudge.priority,
      snoozeUntilIso: snoozeUntil.toISOString(),
      surface: parsed.data.surface,
      personaVersion: PERSONA_VERSION,
    },
  });

  return NextResponse.json({ data: { ok: true, status: 'SNOOZED', snoozeUntil: snoozeUntil.toISOString() } });
}
