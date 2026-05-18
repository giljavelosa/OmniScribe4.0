import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

/**
 * GET /api/notes/[id]/transcript — returns the cleaned diarized transcript
 * for a note. Used by the /review transcript drawer so clinicians can
 * cross-reference the source while editing draft sections.
 *
 * Returns only transcriptClean (the canonical TranscriptClean shape) to
 * keep payload small + avoid shipping raw partials. Both DRAFT and SIGNED
 * notes are readable; the transcript is reference material, never edited.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const { id } = await params;
  const note = await prisma.note.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    select: {
      id: true,
      orgId: true,
      clinicianOrgUserId: true,
      transcriptClean: true,
      captureMode: true,
    },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(note.orgId, authorizationUser.orgId);

  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'SUPER_ADMIN'
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  return NextResponse.json({
    data: {
      captureMode: note.captureMode,
      transcriptClean: note.transcriptClean,
    },
  });
}
