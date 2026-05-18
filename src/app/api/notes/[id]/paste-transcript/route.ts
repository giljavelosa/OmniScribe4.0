import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { NoteStatus, CaptureMode } from '@prisma/client';

export const runtime = 'nodejs';

const bodySchema = z.object({
  text: z.string().min(1).max(50_000),
});

/**
 * POST /api/notes/[id]/paste-transcript — clinician already has the
 * transcript and just wants the LLM draft. Writes Note.transcriptClean
 * directly, sets captureMode = PASTED, transitions PREPARING → TRANSCRIBING
 * (Unit 04 fast-paths PASTED notes straight into ai-generation without the
 * Soniox path).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_CREATE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const { id: noteId } = await params;
  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: authorizationUser.orgId },
    select: { id: true, status: true, clinicianOrgUserId: true },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  if (note.clinicianOrgUserId !== authorizationUser.orgUserId && authorizationUser.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  if (note.status !== NoteStatus.PREPARING) {
    return NextResponse.json({ error: { code: 'invalid_state' } }, { status: 409 });
  }

  await prisma.note.update({
    where: { id: noteId },
    data: {
      captureMode: CaptureMode.PASTED,
      transcriptClean: { source: 'pasted', text: parsed.data.text } as object,
      status: NoteStatus.TRANSCRIBING,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'TRANSCRIPT_PASTED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: { charCount: parsed.data.text.length },
  });

  return NextResponse.json({ data: { ok: true } });
}
