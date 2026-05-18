import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  draftId: z.string().min(1).max(80),
  kind: z.enum(['patient-message', 'followup-cadence', 'referral-letter']),
  /** The final (possibly edited) content the clinician confirmed. The
   *  audit row carries LENGTH only — never the text itself. */
  content: z.string().min(1).max(10_000),
  /** True when the clinician edited the model's draft before
   *  confirming. Audit metadata for the auditor lens. */
  wasEdited: z.boolean(),
  /** Optional patient context — required when sideEffect = 'followup-
   *  create' (need a patientId to create the FollowUp row). */
  patientId: z.string().min(1).max(64).optional(),
  noteId: z.string().min(1).max(64).optional(),
  /** What the confirm should do server-side:
   *    - 'clipboard'         — no side effect; the UI copied the text
   *      to the user's clipboard. Audit records the decision.
   *    - 'followup-create'   — server creates a FollowUp row tied to
   *      the patientId + noteId.
   *  Future: 'send-message' for a real secure-messaging integration. */
  sideEffect: z.enum(['clipboard', 'followup-create']),
});

/**
 * POST /api/copilot/draft-confirm — Unit 30 / Phase 55.
 *
 * Persists the clinician's confirmation of a copilot-suggested draft.
 * NO autonomous side effects beyond what the clinician explicitly
 * opted into via `sideEffect`. Audits per spec rule 4.
 *
 * PHI fence: audit metadata is draftId + kind + contentLength +
 * wasEdited + sideEffect + actionTaken — NEVER the draft text.
 *
 * For sideEffect = 'followup-create', creates ONE FollowUp row with
 * the confirmed content as the text. Multi-row cadences (e.g. weekly
 * → biweekly → quarterly) would need the spec's `suggestedIntervals`
 * shape; v1 lets the clinician confirm one cadence at a time.
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

  // Side-effect dispatch by KIND, not by client preference (locked decision).
  // Reject mismatched (kind, sideEffect) tuples — e.g. a 'patient-message'
  // draft must NEVER trigger followup-create regardless of what the client
  // sent.
  const expectedSideEffect: Record<typeof body.kind, typeof body.sideEffect> = {
    'patient-message': 'clipboard',
    'referral-letter': 'clipboard',
    'followup-cadence': 'followup-create',
  };
  if (body.sideEffect !== expectedSideEffect[body.kind]) {
    return NextResponse.json(
      { error: { code: 'kind_side_effect_mismatch' } },
      { status: 400 },
    );
  }

  let actionTaken: 'noop' | 'followup-created' = 'noop';
  let createdFollowUpId: string | null = null;

  if (body.sideEffect === 'followup-create') {
    if (!body.patientId || !body.noteId) {
      return NextResponse.json(
        { error: { code: 'patient_or_note_required_for_followup' } },
        { status: 400 },
      );
    }
    const patient = await prisma.patient.findFirst({
      where: { id: body.patientId, orgId: authorizationUser.orgId },
      select: { id: true, orgId: true },
    });
    if (!patient) return NextResponse.json({ error: { code: 'patient_not_found' } }, { status: 404 });
    assertOrgScoped(patient.orgId, authorizationUser.orgId);

    const note = await prisma.note.findFirst({
      where: { id: body.noteId, orgId: authorizationUser.orgId },
      select: { id: true, encounter: { select: { episodeOfCareId: true } } },
    });
    if (!note) return NextResponse.json({ error: { code: 'note_not_found' } }, { status: 404 });

    const followUp = await prisma.followUp.create({
      data: {
        orgId: authorizationUser.orgId,
        patientId: body.patientId,
        episodeId: note.encounter?.episodeOfCareId ?? null,
        originNoteId: body.noteId,
        text: body.content.slice(0, 1000),
      },
    });
    createdFollowUpId = followUp.id;
    actionTaken = 'followup-created';
  }

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'COPILOT_DRAFT_CONFIRMED',
    resourceType: 'Copilot',
    resourceId: body.draftId,
    metadata: {
      draftId: body.draftId,
      kind: body.kind,
      contentLength: body.content.length,
      wasEdited: body.wasEdited,
      sideEffect: body.sideEffect,
      actionTaken,
      ...(createdFollowUpId ? { followUpId: createdFollowUpId } : {}),
    },
  });

  return NextResponse.json({
    data: {
      ok: true,
      actionTaken,
      ...(createdFollowUpId ? { followUpId: createdFollowUpId } : {}),
    },
  });
}
