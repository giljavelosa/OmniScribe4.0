import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ExternalContextMediaKind, ExternalContextSource, ExternalContextStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { writeAuditLog } from '@/lib/audit/log';
import {
  externalContextAudioKeyFor,
  externalContextDocumentKeyFor,
  putAudio,
  putPrivateObject,
  verifyObjectExists,
} from '@/lib/s3/client';
import {
  enqueueExternalContextExtractionJob,
  enqueueExternalContextTranscriptionJob,
} from '@/lib/queue';
import {
  validateDateOfRecord,
  MAX_TRANSCRIPT_BYTES,
  MAX_AUDIO_BYTES,
  ALLOWED_AUDIO_MIME,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_FILES,
  ALLOWED_DOCUMENT_MIME,
  ALLOWED_ROUTER_V2_DOCUMENT_MIME,
  extensionFromMime,
  extensionFromDocumentMime,
} from '@/lib/external-context/validation';
import { isFileRouterV2Enabled } from '@/services/external-context/file-router';
import { buildVerifiedDocumentDomainSummaries } from '@/lib/external-context/verified-chart-facts';

export const runtime = 'nodejs';

/**
 * POST /api/patients/[id]/external-context
 *
 * Adds a prior-visit ExternalContext row. Two modes:
 *
 *   - Paste mode (application/json) — clinician-typed transcript stored
 *     directly. status = READY, no audio, no worker hop.
 *   - Upload mode (multipart/form-data) — audio bytes go to S3, status =
 *     PENDING_TRANSCRIPTION, BullMQ enqueues the
 *     external-context-transcription worker to run Soniox batch + clean.
 *
 * Audit: EXTERNAL_CONTEXT_ADDED. PHI-fenced metadata only.
 *
 * Spec: context/specs/external-context-upload.md §Endpoints.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const { id: patientId } = await params;
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, orgId: authorizationUser.orgId, isDeleted: false },
    select: { id: true, orgId: true, createdAt: true },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    return handleUploadMode({
      req,
      patientId: patient.id,
      patientCreatedAt: patient.createdAt,
      orgId: orgUser.orgId,
      userId: user.id,
      orgUserId: orgUser.id,
    });
  }
  return handlePasteMode({
    req,
    patientId: patient.id,
    patientCreatedAt: patient.createdAt,
    orgId: orgUser.orgId,
    userId: user.id,
    orgUserId: orgUser.id,
  });
}

/**
 * GET /api/patients/[id]/external-context — list view (most recent first by
 * dateOfRecord). Excludes the transcript body; load that via the detail
 * endpoint. No audit on list reads (consistent with patient-list endpoints).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const { id: patientId } = await params;
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, orgId: authorizationUser.orgId, isDeleted: false },
    select: { id: true, orgId: true },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  const rows = await prisma.externalContext.findMany({
    where: {
      patientId: patient.id,
      orgId: authorizationUser.orgId,
      deletedAt: null,
    },
    orderBy: { dateOfRecord: 'desc' },
    select: {
      id: true,
      dateOfRecord: true,
      source: true,
      sourceLabel: true,
      status: true,
      mediaKind: true,
      verifiedAt: true,
      pageCount: true,
      vettedExtractionJson: true,
      addedAt: true,
      audioFileKey: true,
      episodeOfCareId: true,
      _count: { select: { documentPages: true } },
      extractionBatches: {
        orderBy: { batchIndex: 'asc' },
        select: {
          id: true,
          batchIndex: true,
          pageStart: true,
          pageEnd: true,
          status: true,
          extractedAt: true,
          reviewedAt: true,
        },
      },
      addedBy: {
        select: {
          id: true,
          user: { select: { email: true, name: true } },
        },
      },
    },
  });
  const verifiedDocumentDomains = buildVerifiedDocumentDomainSummaries(rows);
  const verifiedDomainByContextId = new Map(
    verifiedDocumentDomains.map((summary) => [summary.externalContextId, summary]),
  );

  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      dateOfRecord: r.dateOfRecord.toISOString(),
      source: r.source,
      sourceLabel: r.sourceLabel,
      status: r.status,
      mediaKind: r.mediaKind,
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
      pageCount: r.pageCount,
      indexedPageCount: r._count.documentPages,
      domainSummary: verifiedDomainByContextId.get(r.id) ?? null,
      extractionBatches: r.extractionBatches.map((batch) => ({
        id: batch.id,
        batchIndex: batch.batchIndex,
        pageStart: batch.pageStart,
        pageEnd: batch.pageEnd,
        status: batch.status,
        extractedAt: batch.extractedAt?.toISOString() ?? null,
        reviewedAt: batch.reviewedAt?.toISOString() ?? null,
      })),
      addedAt: r.addedAt.toISOString(),
      hasAudio: !!r.audioFileKey,
      episodeOfCareId: r.episodeOfCareId,
      addedBy: {
        orgUserId: r.addedBy.id,
        email: r.addedBy.user.email,
        name: r.addedBy.user.name,
      },
    })),
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const PasteBodySchema = z.object({
  mode: z.literal('paste'),
  dateOfRecord: z.string().min(1),
  source: z.nativeEnum(ExternalContextSource),
  sourceLabel: z.string().max(500).optional().nullable(),
  episodeOfCareId: z.string().min(1).optional().nullable(),
  transcript: z.string().min(1),
});

async function handlePasteMode(args: {
  req: Request;
  patientId: string;
  patientCreatedAt: Date;
  orgId: string;
  userId: string;
  orgUserId: string;
}) {
  let body: unknown;
  try {
    body = await args.req.json();
  } catch {
    return NextResponse.json({ error: { code: 'bad_request', message: 'Invalid JSON' } }, { status: 400 });
  }

  const parsed = PasteBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: parsed.error.message } },
      { status: 400 },
    );
  }
  const { transcript, dateOfRecord, source, sourceLabel, episodeOfCareId } = parsed.data;

  const dateValidation = validateDateOfRecord(dateOfRecord, args.patientCreatedAt);
  if (!dateValidation.ok) {
    return NextResponse.json(
      { error: { code: 'invalid_date', message: dateValidation.error } },
      { status: 400 },
    );
  }

  const byteLength = Buffer.byteLength(transcript, 'utf8');
  if (byteLength > MAX_TRANSCRIPT_BYTES) {
    return NextResponse.json(
      {
        error: {
          code: 'too_large',
          message: `Transcript is too long. Maximum ${MAX_TRANSCRIPT_BYTES / 1024} KB.`,
        },
      },
      { status: 413 },
    );
  }

  if (episodeOfCareId) {
    const episodeOk = await prisma.episodeOfCare.findFirst({
      where: {
        id: episodeOfCareId,
        patientId: args.patientId,
        orgId: args.orgId,
      },
      select: { id: true },
    });
    if (!episodeOk) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Episode of care not found for this patient.' } },
        { status: 400 },
      );
    }
  }

  const created = await prisma.externalContext.create({
    data: {
      orgId: args.orgId,
      patientId: args.patientId,
      episodeOfCareId: episodeOfCareId ?? null,
      dateOfRecord: dateValidation.parsed,
      source,
      sourceLabel: sourceLabel ?? null,
      transcriptClean: transcript,
      transcriptRaw: undefined,
      audioFileKey: null,
      mediaKind: ExternalContextMediaKind.PASTE,
      status: ExternalContextStatus.READY,
      addedByOrgUserId: args.orgUserId,
    },
  });

  await writeAuditLog({
    userId: args.userId,
    orgId: args.orgId,
    action: 'EXTERNAL_CONTEXT_ADDED',
    resourceType: 'ExternalContext',
    resourceId: created.id,
    metadata: {
      dateOfRecord: dateValidation.parsed.toISOString().slice(0, 10),
      source,
      mode: 'paste',
      hasEpisodeLink: !!episodeOfCareId,
      transcriptLength: transcript.length,
    },
  });

  return NextResponse.json({
    data: {
      id: created.id,
      dateOfRecord: created.dateOfRecord.toISOString(),
      source: created.source,
      sourceLabel: created.sourceLabel,
      status: created.status,
      addedAt: created.addedAt.toISOString(),
      hasAudio: false,
      episodeOfCareId: created.episodeOfCareId,
    },
  });
}

async function handleUploadMode(args: {
  req: Request;
  patientId: string;
  patientCreatedAt: Date;
  orgId: string;
  userId: string;
  orgUserId: string;
}) {
  const form = await args.req.formData();

  const mode = String(form.get('mode') ?? '');
  const dateOfRecord = String(form.get('dateOfRecord') ?? '');
  const sourceRaw = String(form.get('source') ?? '');
  const sourceLabel = form.get('sourceLabel') ? String(form.get('sourceLabel')) : null;
  const episodeOfCareId = form.get('episodeOfCareId') ? String(form.get('episodeOfCareId')) : null;
  const audio = form.get('audio');

  if (!dateOfRecord) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'dateOfRecord is required.' } },
      { status: 400 },
    );
  }
  const dateValidation = validateDateOfRecord(dateOfRecord, args.patientCreatedAt);
  if (!dateValidation.ok) {
    return NextResponse.json(
      { error: { code: 'invalid_date', message: dateValidation.error } },
      { status: 400 },
    );
  }
  if (!Object.values(ExternalContextSource).includes(sourceRaw as ExternalContextSource)) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Invalid source.' } },
      { status: 400 },
    );
  }
  const source = sourceRaw as ExternalContextSource;

  if (episodeOfCareId) {
    const episodeOk = await prisma.episodeOfCare.findFirst({
      where: {
        id: episodeOfCareId,
        patientId: args.patientId,
        orgId: args.orgId,
      },
      select: { id: true },
    });
    if (!episodeOk) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Episode of care not found for this patient.' } },
        { status: 400 },
      );
    }
  }

  if (mode === 'document') {
    return handleDocumentUpload({
      form,
      patientId: args.patientId,
      orgId: args.orgId,
      orgUserId: args.orgUserId,
      userId: args.userId,
      dateOfRecord: dateValidation.parsed,
      source,
      sourceLabel,
      episodeOfCareId,
    });
  }

  if (!(audio instanceof Blob)) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'audio is required.' } },
      { status: 400 },
    );
  }
  if (audio.size === 0 || audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: { code: 'bad_size' } }, { status: 413 });
  }
  const mime = audio.type || 'audio/wav';
  if (!ALLOWED_AUDIO_MIME.has(mime)) {
    return NextResponse.json(
      { error: { code: 'bad_mime', message: `Unsupported audio type: ${mime}` } },
      { status: 415 },
    );
  }

  // Create the row first so the S3 key can be deterministic on the id.
  const created = await prisma.externalContext.create({
    data: {
      orgId: args.orgId,
      patientId: args.patientId,
      episodeOfCareId: episodeOfCareId ?? null,
      dateOfRecord: dateValidation.parsed,
      source,
      sourceLabel,
      transcriptClean: '',
      transcriptRaw: undefined,
      audioFileKey: null, // filled below after S3 put succeeds
      mediaKind: ExternalContextMediaKind.AUDIO,
      status: ExternalContextStatus.PENDING_TRANSCRIPTION,
      addedByOrgUserId: args.orgUserId,
    },
  });

  const ext = extensionFromMime(mime);
  const s3Key = externalContextAudioKeyFor(created.id, ext);
  const bytes = Buffer.from(await audio.arrayBuffer());
  await putAudio({ key: s3Key, body: bytes, contentType: mime });
  await verifyObjectExists(s3Key);

  await prisma.externalContext.update({
    where: { id: created.id },
    data: { audioFileKey: s3Key },
  });

  const requestId = randomBytes(8).toString('hex');
  await enqueueExternalContextTranscriptionJob({
    externalContextId: created.id,
    orgId: args.orgId,
    requestId,
  });

  await writeAuditLog({
    userId: args.userId,
    orgId: args.orgId,
    action: 'EXTERNAL_CONTEXT_ADDED',
    resourceType: 'ExternalContext',
    resourceId: created.id,
    metadata: {
      dateOfRecord: dateValidation.parsed.toISOString().slice(0, 10),
      source,
      mode: 'upload',
      hasEpisodeLink: !!episodeOfCareId,
      audioByteSize: bytes.byteLength,
      mime,
      requestId,
    },
  });

  return NextResponse.json({
    data: {
      id: created.id,
      dateOfRecord: created.dateOfRecord.toISOString(),
      source: created.source,
      sourceLabel: created.sourceLabel,
      status: ExternalContextStatus.PENDING_TRANSCRIPTION,
      addedAt: created.addedAt.toISOString(),
      hasAudio: true,
      episodeOfCareId: created.episodeOfCareId,
    },
  });
}

async function handleDocumentUpload(args: {
  form: FormData;
  patientId: string;
  orgId: string;
  orgUserId: string;
  userId: string;
  dateOfRecord: Date;
  source: ExternalContextSource;
  sourceLabel: string | null;
  episodeOfCareId: string | null;
}) {
  const rawFiles = [
    ...args.form.getAll('documents'),
    ...args.form.getAll('document'),
  ].filter(isFileEntry);

  if (rawFiles.length === 0) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'At least one PDF or image is required.' } },
      { status: 400 },
    );
  }
  if (rawFiles.length > MAX_DOCUMENT_FILES) {
    return NextResponse.json(
      {
        error: {
          code: 'too_many_files',
          message: `Upload at most ${MAX_DOCUMENT_FILES} documents at a time.`,
        },
      },
      { status: 413 },
    );
  }

  const files = rawFiles.map((file) => ({
    blob: file,
    mime: normalizeDocumentMime(file.type || 'application/octet-stream', file.name),
  }));
  const allowedMime = isFileRouterV2Enabled()
    ? ALLOWED_ROUTER_V2_DOCUMENT_MIME
    : ALLOWED_DOCUMENT_MIME;
  for (const file of files) {
    if (file.blob.size === 0 || file.blob.size > MAX_DOCUMENT_BYTES) {
      return NextResponse.json(
        {
          error: {
            code: 'bad_size',
            message: `Each document must be smaller than ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`,
          },
        },
        { status: 413 },
      );
    }
    if (!allowedMime.has(file.mime)) {
      return NextResponse.json(
        { error: { code: 'bad_mime', message: `Unsupported document type: ${file.mime}` } },
        { status: 415 },
      );
    }
  }

  const created = await prisma.externalContext.create({
    data: {
      orgId: args.orgId,
      patientId: args.patientId,
      episodeOfCareId: args.episodeOfCareId ?? null,
      dateOfRecord: args.dateOfRecord,
      source: args.source,
      sourceLabel: args.sourceLabel,
      transcriptClean: '',
      transcriptRaw: undefined,
      audioFileKey: null,
      mediaKind: ExternalContextMediaKind.DOCUMENT,
      status: ExternalContextStatus.PENDING_EXTRACTION,
      addedByOrgUserId: args.orgUserId,
    },
  });

  const documentFileKeys: string[] = [];
  const documentMimeTypes: string[] = [];
  let totalByteSize = 0;

  for (const [index, file] of files.entries()) {
    const bytes = Buffer.from(await file.blob.arrayBuffer());
    totalByteSize += bytes.byteLength;
    const key = externalContextDocumentKeyFor(
      created.id,
      index,
      extensionFromDocumentMime(file.mime),
    );
    await putPrivateObject({ key, body: bytes, contentType: file.mime });
    await verifyObjectExists(key);
    documentFileKeys.push(key);
    documentMimeTypes.push(file.mime);
  }

  await prisma.externalContext.update({
    where: { id: created.id },
    data: { documentFileKeys, documentMimeTypes },
  });

  const requestId = randomBytes(8).toString('hex');
  await enqueueExternalContextExtractionJob({
    externalContextId: created.id,
    orgId: args.orgId,
    requestId,
  });

  await writeAuditLog({
    userId: args.userId,
    orgId: args.orgId,
    action: 'EXTERNAL_CONTEXT_ADDED',
    resourceType: 'ExternalContext',
    resourceId: created.id,
    metadata: {
      dateOfRecord: args.dateOfRecord.toISOString().slice(0, 10),
      source: args.source,
      mode: 'document',
      hasEpisodeLink: !!args.episodeOfCareId,
      documentCount: documentFileKeys.length,
      totalByteSize,
      mimeTypes: documentMimeTypes,
      requestId,
    },
  });

  return NextResponse.json({
    data: {
      id: created.id,
      dateOfRecord: created.dateOfRecord.toISOString(),
      source: created.source,
      sourceLabel: created.sourceLabel,
      status: ExternalContextStatus.PENDING_EXTRACTION,
      mediaKind: ExternalContextMediaKind.DOCUMENT,
      verifiedAt: null,
      addedAt: created.addedAt.toISOString(),
      hasAudio: false,
      episodeOfCareId: created.episodeOfCareId,
    },
  });
}

function normalizeDocumentMime(mime: string, fileName?: string): string {
  const normalized = mime === 'image/jpg' ? 'image/jpeg' : mime;
  if (normalized !== 'application/octet-stream' || !fileName) return normalized;
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'txt':
      return 'text/plain';
    case 'csv':
      return 'text/csv';
    case 'json':
      return 'application/json';
    case 'xml':
      return 'application/xml';
    case 'rtf':
      return 'application/rtf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    default:
      return normalized;
  }
}

function isFileEntry(value: FormDataEntryValue): value is File {
  return typeof File !== 'undefined' && value instanceof File;
}
