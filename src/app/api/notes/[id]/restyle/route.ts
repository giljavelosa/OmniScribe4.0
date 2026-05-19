import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { NoteStatus, NoteStyle } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { enqueueAiGenerationJob } from '@/lib/queue';

export const runtime = 'nodejs';

const bodySchema = z.object({
  /** "concise" -> STRUCTURED, "verbose" -> NARRATIVE. */
  preset: z.enum(['concise', 'verbose']),
});

/**
 * POST /api/notes/[id]/restyle — switch note format and regenerate all sections.
 *
 * concise -> NoteStyle.STRUCTURED (tight key/value lines)
 * verbose -> NoteStyle.NARRATIVE (flowing prose)
 *
 * Refuses 409 note_signed (rule 3) or not_reviewable for non-DRAFT/REVIEWING.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_EDIT', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const { preset } = parsed.data;
  const nextStyle = preset === 'concise' ? NoteStyle.STRUCTURED : NoteStyle.NARRATIVE;

  const { id } = await params;
  const note = await prisma.note.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    select: { id: true, orgId: true, status: true, noteStyle: true, clinicianOrgUserId: true },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(note.orgId, authorizationUser.orgId);

  if (note.status === NoteStatus.SIGNED) {
    return NextResponse.json({ error: { code: 'note_signed' } }, { status: 409 });
  }
  if (note.status !== NoteStatus.DRAFT && note.status !== NoteStatus.REVIEWING) {
    return NextResponse.json(
      { error: { code: 'not_reviewable', message: `Restyle runs on DRAFT/REVIEWING (current: ${note.status}).` } },
      { status: 409 },
    );
  }
  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'ORG_ADMIN'
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  if (note.noteStyle === nextStyle) {
    return NextResponse.json({ data: { ok: true, unchanged: true } });
  }

  const requestId = randomBytes(8).toString('hex');
  await prisma.note.update({ where: { id }, data: { noteStyle: nextStyle } });
  await enqueueAiGenerationJob({
    noteId: id,
    orgId: authorizationUser.orgId,
    type: 'generate-note',
    requestId,
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'NOTE_STYLE_CHANGED',
    resourceType: 'Note',
    resourceId: id,
    metadata: { from: note.noteStyle, to: nextStyle, preset, requestId },
  });

  return NextResponse.json({ data: { ok: true, noteStyle: nextStyle, requestId } });
}
