import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { NoteStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { enqueueAiGenerationJob } from '@/lib/queue';
import { readSectionStatus } from '@/lib/notes/section-status';
import type { NoteSectionDef } from '@/lib/notes/build-prompt';

export const runtime = 'nodejs';

const bodySchema = z.object({
  sectionId: z.string().min(1),
  requestId: z.string().optional(),
  /** Client passes true if the section was already 'edited' to confirm overwrite. */
  overwriteEdited: z.boolean().optional(),
});

/**
 * POST /api/notes/[id]/regenerate-section
 *
 * Enqueues an ai-generation job with type='regenerate-section' for a single
 * section. The ai-generation queue's stable jobId scheme makes double-taps
 * idempotent.
 *
 * Refuses:
 *   - 404 if note not found / not in org
 *   - 403 if not the assigned clinician (or SUPER_ADMIN)
 *   - 409 note_signed (rule 3)
 *   - 409 section_already_generating (defense — section status already
 *     'generating'; the client should disable the button while in flight)
 *   - 409 overwrite_requires_confirm if status === 'edited' && client did
 *     NOT set overwriteEdited=true. The /review UI surfaces a
 *     SectionRegenerateConfirmDialog (spec §G) on this case.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_EDIT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const { sectionId, overwriteEdited } = parsed.data;
  const requestId = parsed.data.requestId ?? randomBytes(8).toString('hex');

  const { id: noteId } = await params;
  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: authorizationUser.orgId },
    select: {
      id: true,
      orgId: true,
      status: true,
      clinicianOrgUserId: true,
      inferenceLog: true,
      template: { select: { sectionSchema: true } },
    },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'SUPER_ADMIN'
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  if (note.status === NoteStatus.SIGNED) {
    return NextResponse.json({ error: { code: 'note_signed' } }, { status: 409 });
  }

  const sections =
    (note.template?.sectionSchema as { sections: NoteSectionDef[] } | null)?.sections ?? [];
  if (!sections.find((s) => s.id === sectionId)) {
    return NextResponse.json({ error: { code: 'unknown_section' } }, { status: 404 });
  }

  const status = readSectionStatus(note.inferenceLog);
  const current = status[sectionId];
  if (current?.status === 'generating') {
    return NextResponse.json({ error: { code: 'section_already_generating' } }, { status: 409 });
  }
  const wasEdited = current?.status === 'edited';
  if (wasEdited && !overwriteEdited) {
    return NextResponse.json(
      { error: { code: 'overwrite_requires_confirm' } },
      { status: 409 },
    );
  }

  await enqueueAiGenerationJob({
    noteId,
    orgId: note.orgId,
    type: 'regenerate-section',
    requestId,
    sectionId,
  });

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'SECTION_REGEN_ENQUEUED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: { sectionId, requestId, overwroteEdited: wasEdited },
  });

  return NextResponse.json({ data: { ok: true, requestId } });
}
