import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, NoteStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { markSectionStatus } from '@/lib/notes/section-status';
import type { NoteSectionDef } from '@/lib/notes/build-prompt';

export const runtime = 'nodejs';

const bodySchema = z.object({
  content: z.string(),
});

/**
 * PATCH /api/notes/[id]/sections/[sectionId]
 *
 * Inline section edit from /review. Writes only the target section's
 * content into Note.draftJson and flips _sectionStatus[sectionId].status →
 * 'edited' + records lastEditedAt.
 *
 * Anti-regression rule 3: refuses if note.status === SIGNED. The clinician
 * gets a 409 invalid_state from the API + the /review UI shouldn't expose
 * the edit affordance on signed notes anyway (defense-in-depth).
 *
 * Auto-saved by the client at ~1s debounce, so this endpoint should stay
 * lean — no full re-render of the note, just the targeted write.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_EDIT', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const { id: noteId, sectionId } = await params;
  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: authorizationUser.orgId },
    select: {
      id: true,
      status: true,
      clinicianOrgUserId: true,
      draftJson: true,
      template: { select: { sectionSchema: true } },
    },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'ORG_ADMIN'
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  if (note.status === NoteStatus.SIGNED) {
    return NextResponse.json({ error: { code: 'note_signed' } }, { status: 409 });
  }

  // Validate the section id exists in the template (defense vs. typo'd paths).
  const sections =
    (note.template?.sectionSchema as { sections: NoteSectionDef[] } | null)?.sections ?? [];
  if (!sections.find((s) => s.id === sectionId)) {
    return NextResponse.json({ error: { code: 'unknown_section' } }, { status: 404 });
  }

  const draft = (note.draftJson as Record<string, { content: string; updatedAt: string }> | null) ?? {};
  const next = {
    ...draft,
    [sectionId]: { content: parsed.data.content, updatedAt: new Date().toISOString() },
  };
  await prisma.note.update({
    where: { id: noteId },
    data: { draftJson: next as unknown as Prisma.InputJsonValue },
  });
  await markSectionStatus(noteId, sectionId, {
    status: 'edited',
    lastEditedAt: new Date().toISOString(),
  });

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'SECTION_EDITED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: { sectionId, charCount: parsed.data.content.length },
  });

  return NextResponse.json({ data: { ok: true } });
}
