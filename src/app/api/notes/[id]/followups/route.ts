import { NextResponse } from 'next/server';
import { z } from 'zod';
import { FollowUpStatus, NoteStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const postSchema = z.object({
  items: z
    .array(z.string().trim().min(5).max(500))
    .min(1)
    .max(10),
});

/**
 * POST /api/notes/[id]/followups — clinician-initiated follow-up creation
 * from the /review screen.
 *
 * Why this exists: the post-sign note-brief worker LLM-extracts follow-ups
 * from the Plan section, but the model can miss commitments the clinician
 * verbally captured but didn't write into the Plan text. This route is the
 * explicit "I want to commit to checking ROM next visit" path. The new
 * "Follow-ups for next visit" card on /review POSTs here when the clinician
 * adds a row inline.
 *
 * Rule 24 compliance: this is a clinician-initiated write, not an AI write.
 * The chips/buttons that trigger it require explicit clinician action.
 *
 * GET /api/notes/[id]/followups — lists OPEN rows whose originNoteId === this
 * note (i.e. "what I'm committing the next visit's clinician to"). The
 * /review card uses this for optimistic-update reconciliation.
 *
 * Safety:
 *   - Auth via NOTE_REVIEW (same gate as the sections editor).
 *   - Clinician must own the note (or be ORG_ADMIN). Same defense-in-depth
 *     pattern as the other note-scoped routes.
 *   - Note must be in DRAFT or REVIEWING — rejects if already SIGNED+ (the
 *     follow-up should have been captured pre-sign) or still PREPARING/
 *     RECORDING/PAUSED (Plan section doesn't exist yet).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id: noteId } = await params;
  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: authorizationUser.orgId },
    select: {
      id: true,
      orgId: true,
      status: true,
      clinicianOrgUserId: true,
      patientId: true,
      // Unit 49 PR2 — FollowUp.division is NOT NULL and inherits from
      // the origin note. Pull it here so the create payload below can
      // stamp it without a second round trip.
      division: true,
      encounter: { select: { episodeOfCareId: true } },
    },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'ORG_ADMIN'
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  // Only DRAFT / REVIEWING — pre-sign window. SIGNED+ rejects so we never
  // accidentally create rows tied to an immutable note that won't be the
  // "next visit's predecessor" anymore. Earlier statuses reject because the
  // Plan section hasn't been drafted yet.
  if (note.status !== NoteStatus.DRAFT && note.status !== NoteStatus.REVIEWING) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_state',
          message: `Cannot add follow-ups to a note in status ${note.status}.`,
        },
      },
      { status: 409 },
    );
  }

  const episodeId = note.encounter?.episodeOfCareId ?? null;
  const items = parsed.data.items.map((text) => text.trim());

  const created = await prisma.$transaction(
    items.map((text) =>
      prisma.followUp.create({
        data: {
          orgId: note.orgId,
          patientId: note.patientId,
          episodeId,
          originNoteId: note.id,
          text,
          division: note.division,
          status: FollowUpStatus.OPEN,
        },
        select: { id: true, text: true, status: true, createdAt: true },
      }),
    ),
  );

  for (const fu of created) {
    await writeAuditLog({
      userId: user.id,
      orgId: orgUser.orgId,
      action: 'FOLLOWUP_CREATED',
      resourceType: 'FollowUp',
      resourceId: fu.id,
      metadata: {
        source: 'review-inline',
        originNoteId: note.id,
        textLength: fu.text.length,
      },
    });
  }

  return NextResponse.json({
    data: { items: created.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })) },
  });
}

/**
 * GET /api/notes/[id]/followups — list rows whose originNoteId === this note.
 *
 * Used by the /review card to reconcile after a delete or after the
 * clinician returns to the page. Lightweight; same auth as POST.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const { id: noteId } = await params;
  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: authorizationUser.orgId },
    select: { id: true, clinicianOrgUserId: true },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'ORG_ADMIN'
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const items = await prisma.followUp.findMany({
    where: { originNoteId: noteId, orgId: authorizationUser.orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, text: true, status: true, createdAt: true },
  });

  return NextResponse.json({
    data: {
      items: items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
    },
  });
}
