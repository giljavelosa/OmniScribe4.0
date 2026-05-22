import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { enqueueTranscriptionJob, enqueueAiGenerationJob } from '@/lib/queue';
import { NoteStatus } from '@prisma/client';

export const runtime = 'nodejs';

/**
 * POST /api/notes/[id]/retry-transcription
 *
 * Re-queues a note that is stuck in INTERRUPTED back into the transcription
 * pipeline. The note status is reset to TRANSCRIBING before enqueueing so
 * the worker's idempotency guard doesn't skip the job.
 *
 * Only callable by the clinician who owns the note or an ORG_ADMIN.
 * Only valid when note.status === INTERRUPTED.
 *
 * Side effects:
 *   1. Reset Note.status INTERRUPTED → TRANSCRIBING, clear lastWorkerError.
 *   2. Enqueue the appropriate transcription job (same type as original,
 *      derived from Note.captureMode).
 *   3. Audit NOTE_RETRY_ENQUEUED.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const { id: noteId } = await params;
  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: authorizationUser.orgId },
    select: { id: true, status: true, clinicianOrgUserId: true, captureMode: true },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  if (note.clinicianOrgUserId !== authorizationUser.orgUserId && authorizationUser.role !== 'ORG_ADMIN') {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  // Only retry from INTERRUPTED. TRANSCRIBING/DRAFTING means the worker is
  // already running; DRAFT+ means it already succeeded.
  if (note.status !== NoteStatus.INTERRUPTED) {
    return NextResponse.json(
      { error: { code: 'invalid_state', message: `Cannot retry from status ${note.status}.` } },
      { status: 409 },
    );
  }

  // Derive which transcription job type to re-enqueue from the capture mode.
  type TranscriptionJobType = 'finalize-realtime-transcript' | 'transcribe-uploaded-audio' | 'cleanup-pasted-transcript';
  const jobTypeByMode: Record<string, TranscriptionJobType> = {
    LIVE: 'finalize-realtime-transcript',
    UPLOADED: 'transcribe-uploaded-audio',
    PASTED: 'cleanup-pasted-transcript',
  };
  const jobType: TranscriptionJobType = jobTypeByMode[note.captureMode] ?? 'finalize-realtime-transcript';

  // Reset status and clear the error before enqueueing.
  await prisma.note.update({
    where: { id: noteId },
    data: {
      status: NoteStatus.TRANSCRIBING,
      interruptedAt: null,
      lastWorkerError: null,
    },
  });

  const requestId = randomBytes(8).toString('hex');

  // PASTED mode skips transcription and goes straight to AI generation.
  if (jobType === 'cleanup-pasted-transcript') {
    // transcriptClean already exists (pasted inline during capture).
    // Jump straight to DRAFTING + enqueue AI generation.
    await prisma.note.update({
      where: { id: noteId },
      data: { status: NoteStatus.DRAFTING },
    });
    await enqueueAiGenerationJob({
      noteId,
      orgId: orgUser.orgId,
      type: 'generate-note',
      requestId,
    });
  } else {
    await enqueueTranscriptionJob({
      noteId,
      orgId: orgUser.orgId,
      type: jobType,
      requestId,
    });
  }

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'NOTE_RETRY_ENQUEUED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: { jobType, requestId, captureMode: note.captureMode },
  });

  return NextResponse.json({ data: { ok: true, jobType } });
}
