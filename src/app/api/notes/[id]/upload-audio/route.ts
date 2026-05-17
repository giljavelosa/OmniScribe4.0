import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { audioKeyFor, putAudio } from '@/lib/s3/client';
import { NoteStatus, CaptureMode } from '@prisma/client';

export const runtime = 'nodejs';

const MAX_AUDIO_BYTES = 200 * 1024 * 1024; // 200 MB for uploads
const ALLOWED_MIME = new Set(['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/webm', 'audio/ogg']);

/**
 * POST /api/notes/[id]/upload-audio — multipart upload of an existing audio
 * file. Sets captureMode = UPLOADED, transitions PREPARING → TRANSCRIBING,
 * and enqueues nothing yet (Unit 04 picks up TRANSCRIBING notes from the
 * Soniox batch path).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_CREATE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

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

  const form = await req.formData();
  const audioFile = form.get('audio');
  if (!(audioFile instanceof Blob)) {
    return NextResponse.json({ error: { code: 'bad_request', message: 'audio missing' } }, { status: 400 });
  }
  if (audioFile.size === 0 || audioFile.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: { code: 'bad_size' } }, { status: 413 });
  }
  const mime = audioFile.type || 'audio/wav';
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: { code: 'bad_mime', message: `Unsupported audio type: ${mime}` } }, { status: 415 });
  }

  const segmentId = `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const s3Key = audioKeyFor(noteId, segmentId);
  const bytes = Buffer.from(await audioFile.arrayBuffer());
  await putAudio({ key: s3Key, body: bytes, contentType: mime });

  await prisma.$transaction([
    prisma.audioSegment.create({
      data: {
        id: segmentId,
        noteId,
        segmentIndex: 0,
        s3Key,
        durationMs: 0, // unknown without ffprobe; Unit 04 fills this in
        sampleRate: 0,
        byteSize: bytes.byteLength,
      },
    }),
    prisma.note.update({
      where: { id: noteId },
      data: {
        captureMode: CaptureMode.UPLOADED,
        audioFileKey: s3Key,
        status: NoteStatus.TRANSCRIBING,
      },
    }),
  ]);

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'AUDIO_UPLOADED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: { byteSize: bytes.byteLength, mime },
  });

  return NextResponse.json({ data: { ok: true, segmentId } });
}
