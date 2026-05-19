import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { mintEphemeralKey } from '@/services/transcription';
import { NoteStatus } from '@prisma/client';

export const runtime = 'nodejs';

/**
 * POST /api/notes/[id]/realtime-key
 *
 * Mints an ephemeral STT-WS-only key for the browser to open a direct WS
 * to Soniox (rule 11 — long-lived key never reaches the client). On first
 * mint the note flips PREPARING → RECORDING.
 *
 * Idempotent vs. status: callable from PREPARING / RECORDING / PAUSED so the
 * browser can refresh the key mid-session without flipping a terminal state.
 *
 * Rule 12: returned config locks { enable_speaker_diarization: true,
 * audio_format: 'pcm_s16le' } and 16,000 Hz mono.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const { id } = await params;

  const note = await prisma.note.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    select: { id: true, orgId: true, status: true, clinicianOrgUserId: true },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(note.orgId, authorizationUser.orgId);

  // Defense in depth: a clinician may only mint keys for their own notes.
  // (PHI scoping helper canAccessClinicianOwnedResource will land for richer
  // surfaces in later units; this gate is the explicit Unit-03 version.)
  if (note.clinicianOrgUserId !== authorizationUser.orgUserId && authorizationUser.role !== 'ORG_ADMIN') {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const captureReady = new Set<NoteStatus>([NoteStatus.PREPARING, NoteStatus.RECORDING, NoteStatus.PAUSED]);
  if (!captureReady.has(note.status)) {
    return NextResponse.json(
      { error: { code: 'invalid_state', message: `Note status ${note.status} is not capture-ready.` } },
      { status: 409 },
    );
  }

  const mint = await mintEphemeralKey({ noteId: note.id, ttlSeconds: 60 });

  // First mint = transition into RECORDING. Subsequent re-mints on
  // RECORDING/PAUSED leave the status alone.
  let nextStatus = note.status;
  if (note.status === NoteStatus.PREPARING) {
    await prisma.note.update({
      where: { id: note.id },
      data: { status: NoteStatus.RECORDING },
    });
    nextStatus = NoteStatus.RECORDING;
    await writeAuditLog({
      userId: user.id,
      orgId: orgUser.orgId,
      action: 'RECORDING_STARTED',
      resourceType: 'Note',
      resourceId: note.id,
    });
  }

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'REALTIME_KEY_ISSUED',
    resourceType: 'Note',
    resourceId: note.id,
    metadata: { expiresInSeconds: 60, stub: mint.stub },
  });

  return NextResponse.json({
    data: {
      apiKey: mint.apiKey,
      websocketUrl: mint.websocketUrl,
      config: mint.config,
      expiresAt: mint.expiresAt,
      stub: mint.stub,
      noteStatus: nextStatus,
    },
  });
}
