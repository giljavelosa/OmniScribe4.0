import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { audioKeyFor, putAudio } from '@/lib/s3/client';
import { enqueueTranscriptionJob } from '@/lib/queue';
import { NoteStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';

import {
  MAX_RECORDING_BYTES,
  WAV_HEADER_BYTES,
  type AutoStopReason,
} from '@/lib/audio/recording-limits';
import {
  releaseRecordingLock,
  validateRecordingLock,
} from '@/lib/recording-lock/claim';

export const runtime = 'nodejs';

// Hard server cap. Mirrors the client-side auto-stop ceiling
// (src/lib/audio/recording-limits.ts) and the proxy buffer
// (next.config.ts `proxyClientMaxBodySize`). 200 MB ≈ 173 min of
// 16 kHz 16-bit mono PCM with WAV header + multipart overhead.
const MAX_AUDIO_BYTES = MAX_RECORDING_BYTES;

/**
 * POST /api/notes/[id]/complete-stream
 *
 * Multipart payload:
 *   - audio              : Blob — the consolidated WAV the browser encoded
 *                           from the AudioWorklet stream
 *   - finalTranscript    : string — JSON of { segments, partial } from the
 *                           Soniox WS for live mode (empty {} in stub mode)
 *
 * Side effects:
 *   1. Upload WAV to S3 (stub: ./tmp/audio/...).
 *   2. Create AudioSegment row + write Note.audioFileKey + Note.transcriptRaw.
 *   3. Transition Note.status RECORDING|PAUSED → TRANSCRIBING.
 *   4. Audit RECORDING_FINALIZED with durationMs + segmentCount.
 *
 * Unit 04 will pick up TRANSCRIBING notes from the queue + clean the
 * transcript + enqueue ai-generation. Unit 03 just lands the durable bits.
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
  if (note.status !== NoteStatus.RECORDING && note.status !== NoteStatus.PAUSED) {
    return NextResponse.json({ error: { code: 'invalid_state' } }, { status: 409 });
  }

  // Body parse: when the proxy buffer truncates the multipart body
  // (e.g. recording exceeds `experimental.proxyClientMaxBodySize` set
  // in next.config.ts), the boundary line is cut and `formData()`
  // throws "expected boundary after body". Without this catch the
  // route 500s with an opaque "Failed to parse body as FormData" —
  // the clinician sees "Couldn't finalize the recording (500)" and
  // assumes the system is broken. Map that case to a clear 413 so
  // the client surface can render a real "recording too large"
  // message + audit the event.
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    await writeAuditLog({
      userId: user.id,
      orgId: orgUser.orgId,
      action: 'RECORDING_FINALIZED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: {
        outcome: 'body_parse_failed',
        message: err instanceof Error ? err.message : 'unknown',
      },
    });
    return NextResponse.json(
      {
        error: {
          code: 'audio_too_large',
          message:
            'Recording is too large to upload in one request. Stop the recording sooner or contact support if this keeps happening.',
        },
      },
      { status: 413 },
    );
  }
  const audioFile = form.get('audio');
  const finalTranscriptRaw = form.get('finalTranscript');
  // Auto-stop reason: the capture-state machine sets this when it
  // hit the 90-min OR 200-MB cap and force-completed the recording.
  // Forwarded into RECORDING_FINALIZED audit metadata so a reviewer
  // can quantify forgotten-recording recovery + tell apart a normal
  // clinician finish from a defensive stop.
  const autoStopRaw = form.get('autoStopReason');
  const autoStopReason: AutoStopReason | null =
    autoStopRaw === 'time_limit' || autoStopRaw === 'size_limit'
      ? autoStopRaw
      : null;

  // Single-concurrent-recording lock (2026-05-25): if the caller's
  // device no longer holds the lock (a takeover happened on another
  // device while this finalize was in flight), refuse the upload.
  // Their audio belongs to a recording another device is now driving;
  // accepting it would scramble the clinical record.
  //
  // The clientNonce is passed via the multipart form — same channel
  // as autoStopReason. Legacy clients that don't pass the nonce skip
  // this check (they hold a server-generated nonce; we can't validate).
  const callerNonceRaw = form.get('clientNonce');
  const callerNonce =
    typeof callerNonceRaw === 'string' && callerNonceRaw.length >= 8
      ? callerNonceRaw
      : null;
  if (callerNonce) {
    const lock = await validateRecordingLock({
      userId: user.id,
      clientNonce: callerNonce,
    });
    if (!lock) {
      await writeAuditLog({
        userId: user.id,
        orgId: orgUser.orgId,
        action: 'RECORDING_FINALIZED',
        resourceType: 'Note',
        resourceId: noteId,
        metadata: { outcome: 'lock_lost' },
      });
      return NextResponse.json(
        {
          error: {
            code: 'recording_lock_lost',
            message:
              'Recording was taken over on another device. The audio from this device is no longer the active recording for this note.',
          },
        },
        { status: 410 },
      );
    }
  }

  const audioBlob = audioFile instanceof Blob ? audioFile : null;
  // "No audio" = field missing, 0 bytes, or a header-only WAV. A real
  // recording is far larger than the 44-byte header.
  const audioMissing = !audioBlob || audioBlob.size <= WAV_HEADER_BYTES;

  if (audioBlob && audioBlob.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: { code: 'audio_too_large' } }, { status: 413 });
  }

  let transcriptRaw: object | null = null;
  if (typeof finalTranscriptRaw === 'string' && finalTranscriptRaw.length > 0) {
    try {
      transcriptRaw = JSON.parse(finalTranscriptRaw) as object;
    } catch {
      return NextResponse.json({ error: { code: 'bad_transcript_json' } }, { status: 400 });
    }
  }

  // Audio is evidence of record — in production a finalize MUST carry it.
  // In dev/non-production we allow a transcript-only finalize so an
  // audio-capture bug (dead mic, worklet hiccup) doesn't hard-block the
  // rest of the pipeline — the realtime transcript is enough to generate
  // the note. The note is flagged audioMissing in the audit either way.
  const isProd = process.env.NODE_ENV === 'production';
  if (audioMissing && isProd) {
    return NextResponse.json(
      { error: { code: 'audio_missing', message: 'No audio was captured for this recording.' } },
      { status: 400 },
    );
  }

  const sampleRate = 16_000;
  let s3Key: string | null = null;
  let durationMs = 0;
  let byteSize = 0;

  if (!audioMissing && audioBlob) {
    // Generate the segment id up-front so the S3 key + the DB row align.
    const segmentId = `seg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    s3Key = audioKeyFor(noteId, segmentId);

    const bytes = Buffer.from(await audioBlob.arrayBuffer());
    byteSize = bytes.byteLength;
    // Rough duration estimate: WAV header (44 bytes) stripped, 2 bytes/sample.
    durationMs = Math.round((Math.max(0, bytes.byteLength - WAV_HEADER_BYTES) / 2 / sampleRate) * 1000);
    const mimeType = audioBlob.type || 'audio/wav';

    // Write the DB row FIRST so that if S3 upload fails we have a soft-deletable
    // record to clean up. Orphan risk is minimized: a failed S3 put leaves a
    // DB row with isDeleted=false that ops can soft-delete; the reverse order
    // (S3 first, DB second) leaves an unreachable S3 object — Rule 7 forbids
    // hard-deleting audio so those objects accumulate forever.
    await prisma.$transaction([
      prisma.audioSegment.create({
        data: { id: segmentId, noteId, segmentIndex: 0, s3Key, durationMs, sampleRate, byteSize, mimeType },
      }),
      prisma.note.update({
        where: { id: noteId },
        data: {
          audioFileKey: s3Key,
          transcriptRaw: transcriptRaw as object | undefined,
          status: NoteStatus.TRANSCRIBING,
        },
      }),
    ]);

    // Upload after the DB commit. On S3 failure, soft-delete the segment row so
    // the missing object doesn't confuse the transcription worker, then surface
    // the error to the browser so the clinician can retry.
    try {
      await putAudio({ key: s3Key, body: bytes, contentType: mimeType });
    } catch (s3Err) {
      await prisma.audioSegment.update({
        where: { id: segmentId },
        data: { isDeleted: true, deletedAt: new Date() },
      }).catch(() => {}); // best-effort; don't shadow the S3 error
      throw new Error(
        `Audio upload failed: ${s3Err instanceof Error ? s3Err.message : String(s3Err)}. ` +
        'Your recording data is safe — please try again.',
      );
    }
  } else {
    // Dev transcript-only path — no S3 upload, no AudioSegment row. The
    // finalize-realtime-transcript worker job works off transcriptRaw, so
    // the note still drafts. audioFileKey stays null.
    await prisma.note.update({
      where: { id: noteId },
      data: {
        transcriptRaw: transcriptRaw as object | undefined,
        status: NoteStatus.TRANSCRIBING,
      },
    });
  }

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'RECORDING_FINALIZED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: {
      durationMs,
      segmentCount: audioMissing ? 0 : 1,
      byteSize,
      captureMode: note.captureMode,
      audioMissing,
      autoStopReason,
    },
  });

  // Release the recording lock now that the audio is safely durable.
  // Legacy clients without a clientNonce skip this — their lock will
  // age out naturally after the 60s staleness window. New clients
  // get an immediate release so the clinician can start a fresh
  // recording without waiting.
  if (callerNonce) {
    const release = await releaseRecordingLock({
      userId: user.id,
      clientNonce: callerNonce,
    });
    if (release.released) {
      await writeAuditLog({
        userId: user.id,
        orgId: orgUser.orgId,
        action: 'RECORDING_LOCK_RELEASED',
        resourceType: 'Note',
        resourceId: noteId,
        metadata: { noteId, lockHeldMs: release.lockHeldMs },
      });
    }
  }

  // Unit 04 hand-off: the transcription worker picks up TRANSCRIBING notes
  // and cleans transcriptRaw → transcriptClean, then enqueues ai-generation.
  const requestId = randomBytes(8).toString('hex');
  await enqueueTranscriptionJob({
    noteId,
    orgId: orgUser.orgId,
    type: 'finalize-realtime-transcript',
    requestId,
  });
  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'TRANSCRIPTION_JOB_ENQUEUED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: { type: 'finalize-realtime-transcript', requestId },
  });

  return NextResponse.json({ data: { ok: true, durationMs, audioMissing } });
}
