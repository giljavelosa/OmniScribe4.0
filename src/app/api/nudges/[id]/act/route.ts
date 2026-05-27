import { NextResponse } from 'next/server';
import { z } from 'zod';
import { EncounterIntent, IntentSource } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { PERSONA_VERSION } from '@/services/copilot/persona';
import { isIntentValidForDivision } from '@/services/copilot/intent-proposer';

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
  // Unit 48 PR5 — in-place action (no navigation). When the nudge's
  // kind is INTENT_PROPOSAL_MISSED, this handler ALSO updates the
  // referenced Encounter.intent to the proposed value from the
  // nudge's snapshot. See the conditional block below.
  'apply-intent-proposal',
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
      // Unit 48 PR5 — snapshot carries { encounterId, proposedIntent,
      // division, ... } when kind=INTENT_PROPOSAL_MISSED so the
      // apply-intent-proposal branch can write back without a second
      // round trip.
      sourcePatternSnapshotJson: true,
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

  // Unit 48 PR5 — apply-intent-proposal side effect.
  // When the nudge is INTENT_PROPOSAL_MISSED + slug is apply-intent-proposal,
  // we ALSO update the referenced Encounter's intent before flipping the
  // nudge to ACTED. The update happens FIRST so a failed encounter
  // update doesn't leave a "phantom ACTED" nudge whose action did
  // nothing.
  let intentApplied: {
    encounterId: string;
    newIntent: EncounterIntent;
  } | null = null;

  if (
    nudge.kind === 'INTENT_PROPOSAL_MISSED' &&
    parsed.data.affordanceSlug === 'apply-intent-proposal'
  ) {
    const snapshot = nudge.sourcePatternSnapshotJson as
      | { encounterId?: string; proposedIntent?: string; division?: string }
      | null;
    if (
      !snapshot ||
      typeof snapshot.encounterId !== 'string' ||
      typeof snapshot.proposedIntent !== 'string' ||
      typeof snapshot.division !== 'string'
    ) {
      return NextResponse.json(
        {
          error: {
            code: 'invalid_nudge_snapshot',
            message: 'Nudge snapshot missing encounterId or proposedIntent.',
          },
        },
        { status: 409 },
      );
    }
    const proposedIntent = snapshot.proposedIntent as EncounterIntent;
    // Defense — only allow valid enum values and division match.
    if (
      !Object.values(EncounterIntent).includes(proposedIntent) ||
      !isIntentValidForDivision(
        proposedIntent,
        snapshot.division as 'REHAB' | 'BEHAVIORAL_HEALTH' | 'MEDICAL' | 'MULTI',
      )
    ) {
      return NextResponse.json(
        { error: { code: 'intent_invalid_for_division' } },
        { status: 400 },
      );
    }
    // Org-scope guard via patientId + encounter lookup.
    const enc = await prisma.encounter.findFirst({
      where: {
        id: snapshot.encounterId,
        patientId: nudge.patientId,
        orgId: nudge.orgId,
      },
      select: { id: true, intent: true },
    });
    if (!enc) {
      return NextResponse.json(
        { error: { code: 'encounter_not_found' } },
        { status: 404 },
      );
    }
    // Idempotent — if encounter already has the proposed intent, skip
    // the write and just flip the nudge.
    if (enc.intent !== proposedIntent) {
      await prisma.encounter.update({
        where: { id: enc.id },
        data: {
          intent: proposedIntent,
          intentSource: IntentSource.COPILOT_PROPOSAL_CONFIRMED,
        },
      });
      await writeAuditLog({
        userId: user.id,
        orgId: nudge.orgId,
        action: 'ENCOUNTER_INTENT_UPDATED',
        resourceType: 'Encounter',
        resourceId: enc.id,
        metadata: {
          from: enc.intent,
          to: proposedIntent,
          source: IntentSource.COPILOT_PROPOSAL_CONFIRMED,
          triggeredByNudgeId: nudge.id,
          personaVersion: PERSONA_VERSION,
        },
      });
    }
    intentApplied = { encounterId: enc.id, newIntent: proposedIntent };
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
      ...(intentApplied
        ? {
            appliedEncounterId: intentApplied.encounterId,
            appliedIntent: intentApplied.newIntent,
          }
        : {}),
    },
  });

  return NextResponse.json({
    data: {
      ok: true,
      status: 'ACTED',
      affordanceSlug: parsed.data.affordanceSlug,
      ...(intentApplied ? { intentApplied } : {}),
    },
  });
}
