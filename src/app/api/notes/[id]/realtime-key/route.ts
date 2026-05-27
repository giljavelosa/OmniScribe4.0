import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { mintEphemeralKey } from '@/services/transcription';
import { NoteStatus } from '@prisma/client';
import {
  claimRecordingLock,
  clientNoncePrefix,
} from '@/lib/recording-lock/claim';

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
 *
 * Single-concurrent-recording lock (2026-05-25)
 * ---------------------------------------------
 * Every successful mint claims (or refreshes, on re-mint from the same
 * device) `ActiveRecordingLock` for the calling user. A different
 * device claiming for the same user with a fresh existing lock gets a
 * 409 `recording_locked` and metadata about the active lock; the
 * client surfaces a takeover AlertDialog and re-calls with
 * `takeover: true` to displace.
 *
 * The body is OPTIONAL for backward compatibility with older clients
 * (which used GET-style POST with no body). Without `clientNonce` the
 * server generates one on-the-fly so the lock still claims, but the
 * client can never refresh from a different request — practically
 * meaning legacy clients hold the lock for a single 60s window then
 * lose it. New clients always pass a stable nonce.
 */

const bodySchema = z
  .object({
    clientNonce: z.string().min(8).max(64).optional(),
    takeover: z.boolean().optional(),
  })
  .optional();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const { id } = await params;

  // Body is optional — accept silent failure on parse so we don't
  // regress callers that POST with no body (the legacy capture-state
  // pattern). New clients pass `{ clientNonce, takeover }`.
  let body: { clientNonce?: string; takeover?: boolean } = {};
  try {
    const json = await req.clone().json();
    body = bodySchema.parse(json) ?? {};
  } catch {
    body = {};
  }
  const clientNonce =
    body.clientNonce ??
    `legacy-${user.id.slice(0, 6)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const takeover = body.takeover === true;

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

  // Claim or refresh the per-user recording lock BEFORE minting the
  // Soniox key. If a different device already holds an active lock,
  // refuse with 409 + metadata so the client can offer takeover.
  const claim = await claimRecordingLock({
    userId: user.id,
    orgId: orgUser.orgId,
    noteId: note.id,
    clientNonce,
    takeover,
  });

  if (!claim.ok) {
    await writeAuditLog({
      userId: user.id,
      orgId: orgUser.orgId,
      action: 'RECORDING_LOCK_REJECTED',
      resourceType: 'Note',
      resourceId: note.id,
      metadata: {
        attemptedNoteId: note.id,
        activeNoteId: claim.activeNoteId,
        activeLockAgeMs: claim.activeLockAgeMs,
        clientNoncePrefix: clientNoncePrefix(clientNonce),
      },
    });
    return NextResponse.json(
      {
        error: {
          code: 'recording_locked',
          message:
            'Another device is currently recording on this account. End that recording or take over from this device.',
        },
        meta: {
          activeNoteId: claim.activeNoteId,
          activeClaimedAt: claim.activeClaimedAt.toISOString(),
          activeLockAgeMs: claim.activeLockAgeMs,
        },
      },
      { status: 409 },
    );
  }

  // Audit the lock lifecycle BEFORE minting the key so a downstream
  // mint failure leaves a coherent trail (we won't mint a key that
  // wasn't accompanied by a lock claim).
  if (claim.action === 'claimed') {
    await writeAuditLog({
      userId: user.id,
      orgId: orgUser.orgId,
      action: 'RECORDING_LOCK_CLAIMED',
      resourceType: 'Note',
      resourceId: note.id,
      metadata: {
        noteId: note.id,
        clientNoncePrefix: clientNoncePrefix(clientNonce),
      },
    });
  } else if (claim.action === 'takeover') {
    await writeAuditLog({
      userId: user.id,
      orgId: orgUser.orgId,
      action: 'RECORDING_LOCK_TAKEOVER',
      resourceType: 'Note',
      resourceId: note.id,
      metadata: {
        newNoteId: note.id,
        previousNoteId: claim.previousNoteId,
        previousLockAgeMs: claim.previousLockAgeMs,
        displaceReason: claim.displaceReason,
        clientNoncePrefix: clientNoncePrefix(clientNonce),
      },
    });
  } else {
    // 'refreshed' — high-volume; we still audit but with smaller metadata
    // (just the heartbeat age). Anti-regression rule 8: never swallow.
    const ageMs = Math.max(
      0,
      Date.now() - claim.lock.lastHeartbeatAt.getTime(),
    );
    await writeAuditLog({
      userId: user.id,
      orgId: orgUser.orgId,
      action: 'RECORDING_LOCK_REFRESHED',
      resourceType: 'Note',
      resourceId: note.id,
      metadata: {
        noteId: note.id,
        clientNoncePrefix: clientNoncePrefix(clientNonce),
        ageMs,
      },
    });
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
    metadata: { expiresInSeconds: 60, stub: mint.stub, keyMode: mint.keyMode },
  });

  return NextResponse.json({
    data: {
      apiKey: mint.apiKey,
      websocketUrl: mint.websocketUrl,
      config: mint.config,
      expiresAt: mint.expiresAt,
      stub: mint.stub,
      keyMode: mint.keyMode,
      noteStatus: nextStatus,
      // Echo the nonce we used so the client knows what was claimed
      // (relevant when the server fell back to a generated nonce
      // because the legacy client didn't pass one).
      clientNonce,
    },
  });
}
