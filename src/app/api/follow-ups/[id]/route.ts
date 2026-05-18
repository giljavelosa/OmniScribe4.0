import { NextResponse } from 'next/server';
import { z } from 'zod';
import { FollowUpStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    status: z.enum(['MET', 'DROPPED', 'CARRIED']),
    closingNoteText: z.string().min(5).max(280).optional(),
    dropReason: z.string().min(5).max(280).optional(),
    closingNoteId: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'MET' && !v.closingNoteText) {
      ctx.addIssue({ code: 'custom', path: ['closingNoteText'], message: 'required_for_met' });
    }
    if (v.status === 'DROPPED' && !v.dropReason) {
      ctx.addIssue({ code: 'custom', path: ['dropReason'], message: 'required_for_dropped' });
    }
  });

/**
 * PATCH /api/follow-ups/[id]
 *
 * Transition a follow-up from OPEN to MET / DROPPED / CARRIED. Lifecycle
 * invariants (spec §6.3) enforced at the API layer:
 *
 *   - MET requires closingNoteText (≥5 chars) AND (optionally) closingNoteId
 *   - DROPPED requires dropReason (≥5 chars)
 *   - CARRIED requires no input (will re-surface on next visit)
 *
 * Refuses 409 if the follow-up is not currently OPEN (idempotency — once
 * resolved, requires a separate workflow to reopen).
 *
 * Audits FOLLOWUP_STATUS_CHANGED + FOLLOWUP_CLOSED (the second is the
 * "this commitment is closed" semantic event, distinct from "the status was
 * mutated" — separating them lets analytics filter for the close moment
 * without false positives on hypothetical reopen flows).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_EDIT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const followUp = await prisma.followUp.findUnique({ where: { id } });
  if (!followUp) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(followUp.orgId, authorizationUser.orgId);

  if (followUp.status !== FollowUpStatus.OPEN) {
    return NextResponse.json(
      { error: { code: 'not_open', message: `Follow-up is already ${followUp.status}.` } },
      { status: 409 },
    );
  }

  const nowDate = new Date();
  const nextStatus = FollowUpStatus[parsed.data.status];
  // CARRIED is NOT a terminal state — it re-surfaces on next visit. Only
  // MET / DROPPED close the commitment; closedAt/closedByOrgUserId must stay
  // null for CARRIED so the next visit's sweep + brief still see it alive.
  const isTerminal = parsed.data.status === 'MET' || parsed.data.status === 'DROPPED';
  const updated = await prisma.followUp.update({
    where: { id },
    data: {
      status: nextStatus,
      closingNoteText: parsed.data.status === 'MET' ? parsed.data.closingNoteText! : null,
      dropReason: parsed.data.status === 'DROPPED' ? parsed.data.dropReason! : null,
      closingNoteId: parsed.data.closingNoteId ?? null,
      closedAt: isTerminal ? nowDate : null,
      closedByOrgUserId: isTerminal ? authorizationUser.orgUserId : null,
    },
  });

  const auditMeta = {
    from: 'OPEN',
    to: parsed.data.status,
    originNoteId: followUp.originNoteId,
    closingNoteId: parsed.data.closingNoteId ?? null,
    textLength: followUp.text.length,
    hasClosingNote: !!parsed.data.closingNoteText,
    hasDropReason: !!parsed.data.dropReason,
  };
  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'FOLLOWUP_STATUS_CHANGED',
    resourceType: 'FollowUp',
    resourceId: id,
    metadata: auditMeta,
  });
  if (isTerminal) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'FOLLOWUP_CLOSED',
      resourceType: 'FollowUp',
      resourceId: id,
      metadata: auditMeta,
    });
  }

  return NextResponse.json({ data: updated });
}
