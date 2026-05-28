import { NextResponse } from 'next/server';

import { NoteStatus, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const PLACEHOLDER_SNIPPET = 'No transcript captured for this encounter';

type TranscriptCleanShape = { wordCount?: number };

function noteHasCapturedContent(note: {
  transcriptClean: unknown;
  draftJson: unknown;
}): boolean {
  const clean = note.transcriptClean as TranscriptCleanShape | null;
  if (clean && typeof clean.wordCount === 'number' && clean.wordCount > 0) {
    return true;
  }
  if (!note.draftJson || typeof note.draftJson !== 'object') return false;
  const serialized = JSON.stringify(note.draftJson);
  if (!serialized || serialized === '{}' || serialized === 'null') return false;
  // Placeholder-only drafts from the empty-transcript short-circuit are resettable.
  if (serialized.includes(PLACEHOLDER_SNIPPET) && !serialized.replaceAll(PLACEHOLDER_SNIPPET, '').trim()) {
    return false;
  }
  return serialized.length > 20;
}

/**
 * POST /api/notes/[id]/reset-recording
 *
 * Lets a clinician re-record after a silent / empty-transcript failure.
 * Flips DRAFT or INTERRUPTED notes back to PREPARING and clears ephemeral
 * capture artifacts. Refuses PREPARING (already on the recording surface)
 * and any note with real captured content (rule 3 / attestation safety).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const { id: noteId } = await params;
  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: authorizationUser.orgId },
    select: {
      id: true,
      status: true,
      clinicianOrgUserId: true,
      draftJson: true,
      transcriptRaw: true,
      transcriptClean: true,
    },
  });
  if (!note) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'ORG_ADMIN'
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  if (note.status !== NoteStatus.DRAFT && note.status !== NoteStatus.INTERRUPTED) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_state',
          message: `Cannot reset recording from status ${note.status}.`,
        },
      },
      { status: 409 },
    );
  }

  if (noteHasCapturedContent(note)) {
    return NextResponse.json(
      {
        error: {
          code: 'has_content',
          message: 'This note has captured content — reset is not allowed.',
        },
      },
      { status: 409 },
    );
  }

  await prisma.$transaction([
    prisma.audioSegment.updateMany({
      where: { noteId, isDeleted: false },
      data: { isDeleted: true },
    }),
    prisma.note.update({
      where: { id: noteId },
      data: {
        status: NoteStatus.PREPARING,
        draftJson: Prisma.JsonNull,
        transcriptRaw: Prisma.JsonNull,
        transcriptClean: Prisma.JsonNull,
        interruptedAt: null,
        lastWorkerError: null,
      },
    }),
  ]);

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'NOTE_RECORDING_RESET',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: { priorStatus: note.status },
  });

  return NextResponse.json({ data: { ok: true } });
}
