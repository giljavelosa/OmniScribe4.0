import { NextResponse } from 'next/server';
import { Prisma, NoteStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { detectEmptyTranscript } from '@/lib/notes/empty-transcript';
import type { TranscriptClean } from '@/services/transcription';
import { readInferenceLog, type InferenceLog } from '@/lib/notes/section-status';

export const runtime = 'nodejs';

/**
 * POST /api/notes/[id]/reset-recording — recover from an empty-transcript draft.
 *
 * Background
 * ----------
 * Reported 2026-05-25: a clinician hit "Finish" on a 4-second silent
 * recording. The pipeline correctly refused to fabricate clinical text
 * and wrote placeholder paragraphs into every section (rule 1
 * attestation guard). The clinician landed on /review with a draft
 * that looked broken; clicking the "Re-record" CTA in
 * <EmptyTranscriptBanner> sent them back to /prepare/[noteId] but the
 * note was already in DRAFT status, so /prepare's recording CTA was
 * disabled and they were stuck.
 *
 * This route is the missing recovery primitive: it discards the
 * placeholder draft + the silent audio + the empty transcript and
 * transitions the note back to PREPARING so the recording surfaces
 * become live again. After the reset the clinician can use the same
 * encounter (no new patient visit row, no duplicate billing), they
 * just record again on the existing /prepare or /capture page.
 *
 * Safety
 * ------
 *  - Refuses unless `detectEmptyTranscript` says the note is in the
 *    no-source-material state. This is the SAFETY GUARD — a real
 *    recording (transcript with words OR clinician-edited content)
 *    can NEVER be reset by this endpoint, even by an admin.
 *  - Refuses if the note is SIGNED/TRANSFERRED (rule 3).
 *  - Refuses if the caller isn't the assigned clinician AND isn't an
 *    ORG_ADMIN.
 *  - Audio segments are soft-deleted (`isDeleted: true,
 *    deletedAt: now`) — anti-regression rule 7: audio NEVER hard-
 *    deleted from S3. The objects stay; the rows hide.
 *
 * Audit
 * -----
 * `RECORDING_RESET` carries `priorStatus`, `segmentIdsSoftDeleted`,
 * `discardedDurationMs`, `discardedByteSize` so a reviewer can
 * reconstruct what was thrown away. PHI-free.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_EDIT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const { id: noteId } = await params;
  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: authorizationUser.orgId },
    include: {
      audioSegments: {
        where: { isDeleted: false },
        select: { id: true, durationMs: true, byteSize: true },
      },
    },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(note.orgId, authorizationUser.orgId);

  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'ORG_ADMIN'
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  // Anti-regression rule 3: signed notes are immutable, finalJson too.
  if (note.status === NoteStatus.SIGNED || note.status === NoteStatus.TRANSFERRED) {
    return NextResponse.json(
      {
        error: {
          code: 'note_signed',
          message: 'Signed notes cannot be reset. Open an addendum instead.',
        },
      },
      { status: 409 },
    );
  }

  // Only DRAFT or INTERRUPTED notes can land here in practice. Any
  // upstream state (PREPARING/RECORDING/PAUSED/TRANSCRIBING/DRAFTING)
  // either has no draft yet OR has work in flight that the recovery
  // path shouldn't preempt.
  if (note.status !== NoteStatus.DRAFT && note.status !== NoteStatus.INTERRUPTED) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_state',
          message: `Reset only applies to DRAFT or INTERRUPTED notes (current: ${note.status}).`,
        },
      },
      { status: 409 },
    );
  }

  // SAFETY GUARD — never destroy real content. detectEmptyTranscript
  // returns null unless transcript is empty AND the draft is all
  // placeholder text (or _meta says so). If a clinician has edited
  // even one section into real content, the heuristic flips false
  // and this endpoint refuses.
  const emptyMarker = detectEmptyTranscript({
    inferenceLog: note.inferenceLog,
    transcriptClean: note.transcriptClean as TranscriptClean | null,
    draftJson: note.draftJson,
  });
  if (!emptyMarker) {
    return NextResponse.json(
      {
        error: {
          code: 'has_content',
          message:
            'This note has captured content and cannot be reset. Edit the sections directly or contact support.',
        },
      },
      { status: 409 },
    );
  }

  const priorStatus = note.status;
  const segmentIds = note.audioSegments.map((s) => s.id);
  const discardedDurationMs = note.audioSegments.reduce(
    (sum, s) => sum + (s.durationMs ?? 0),
    0,
  );
  const discardedByteSize = note.audioSegments.reduce(
    (sum, s) => sum + (s.byteSize ?? 0),
    0,
  );

  // Strip ALL transient pipeline state from inferenceLog (per-section
  // status, regenerations, _meta) so the next ai-generation pass starts
  // clean. Keep _sectionStats for org-level latency rollups (PHI-free,
  // historical observability).
  const log = readInferenceLog(note.inferenceLog);
  const cleanLog: InferenceLog = log._sectionStats
    ? { _sectionStats: log._sectionStats }
    : {};

  await prisma.$transaction(async (tx) => {
    // Soft-delete audio segments — rule 7: audio NEVER deleted from
    // S3, only hidden in DB. The S3 object stays as evidence-of-record
    // even though the clinician chose to discard the take.
    if (segmentIds.length > 0) {
      await tx.audioSegment.updateMany({
        where: { id: { in: segmentIds } },
        data: { isDeleted: true, deletedAt: new Date() },
      });
    }
    await tx.note.update({
      where: { id: noteId },
      data: {
        status: NoteStatus.PREPARING,
        draftJson: Prisma.JsonNull,
        transcriptRaw: Prisma.JsonNull,
        transcriptClean: Prisma.JsonNull,
        audioFileKey: null,
        interruptedAt: null,
        lastWorkerError: null,
        inferenceLog: cleanLog as unknown as Prisma.InputJsonValue,
      },
    });
  });

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'RECORDING_RESET',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: {
      priorStatus,
      segmentIdsSoftDeleted: segmentIds,
      discardedDurationMs,
      discardedByteSize,
      reason: 'empty_transcript_recovery',
      detectedDurationMs: emptyMarker.durationMs,
      detectedByteSize: emptyMarker.byteSize,
    },
  });

  return NextResponse.json({
    data: {
      ok: true,
      noteId,
      status: NoteStatus.PREPARING,
      discardedSegments: segmentIds.length,
    },
  });
}
