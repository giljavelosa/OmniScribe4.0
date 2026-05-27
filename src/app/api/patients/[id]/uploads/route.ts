/**
 * Sprint 0.19 / Tier 13 — Patient multimedia upload routes.
 *
 *   GET  /api/patients/[id]/uploads        — list non-deleted uploads
 *   POST /api/patients/[id]/uploads        — multipart upload + enqueue
 *
 * Rule 15: writes through `putPatientUpload` (private bucket; no public
 * access). Returned URLs are presigned at read time, never embedded.
 * Rule 7: hard-delete is NOT supported here; the DELETE handler on
 * `/[uploadId]` only soft-deletes (flips `isDeleted`).
 * Rule 8: audit writes are NOT wrapped in swallowing try/catch — a
 * failed audit write fails the request.
 *
 * Body size: bounded by MAX_PATIENT_UPLOAD_BYTES (25 MB default).
 * Allowed MIME types: image/jpeg, image/png, image/webp, application/pdf.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { writeAuditLog } from '@/lib/audit/log';
import {
  patientUploadKeyFor,
  putPatientUpload,
  PATIENT_UPLOADS_BUCKET,
} from '@/lib/s3/client';
import { enqueuePatientUploadExtract } from '@/lib/queue';
import { PatientUploadKind } from '@prisma/client';

export const runtime = 'nodejs';

const MAX_BYTES = Number(process.env.MAX_PATIENT_UPLOAD_BYTES ?? 25 * 1024 * 1024);
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

const kindEnum = z.nativeEnum(PatientUploadKind);

// ---------------- GET ------------------------------------------------

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;
  const { id: patientId } = await params;

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, orgId: authorizationUser.orgId },
    select: { id: true, orgId: true },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const url = new URL(req.url);
  const kindParam = url.searchParams.get('kind');
  const kindFilter = kindParam ? (kindEnum.safeParse(kindParam).success ? (kindParam as PatientUploadKind) : null) : null;

  const uploads = await prisma.patientUpload.findMany({
    where: {
      orgId: authorizationUser.orgId,
      patientId,
      isDeleted: false,
      ...(kindFilter ? { kind: kindFilter } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      kind: true,
      mimeType: true,
      filename: true,
      byteSize: true,
      status: true,
      extractionErrorMessage: true,
      captureContext: true,
      attestedAt: true,
      createdAt: true,
      uploadedBy: { select: { id: true, user: { select: { name: true, email: true } } } },
    },
  });

  const needsReviewCount = uploads.filter(
    (u) =>
      u.status === 'EXTRACTED' ||
      u.status === 'MANUAL_ONLY' ||
      u.status === 'EXTRACTION_FAILED',
  ).length;

  return NextResponse.json({
    data: {
      needsReviewCount,
      uploads: uploads.map((u) => ({
        uploadId: u.id,
        kind: u.kind,
        mimeType: u.mimeType,
        filename: u.filename,
        byteSize: u.byteSize,
        status: u.status,
        extractionError: u.extractionErrorMessage,
        captureContext: u.captureContext,
        attestedAt: u.attestedAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
        uploadedByDisplay: u.uploadedBy.user.name ?? u.uploadedBy.user.email,
      })),
    },
  });
}

// ---------------- POST -----------------------------------------------

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;
  const { id: patientId } = await params;

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, orgId: authorizationUser.orgId },
    select: { id: true, orgId: true },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  // Parse multipart form
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: { code: 'invalid_form' } }, { status: 400 });
  }
  const file = form.get('file');
  const kindRaw = form.get('kind');
  const filenameRaw = form.get('filename');
  const captureContextRaw = form.get('captureContext');
  const supersedesRaw = form.get('supersedesUploadId');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { code: 'file_required' } }, { status: 400 });
  }
  const kindParsed = kindEnum.safeParse(kindRaw);
  if (!kindParsed.success) {
    return NextResponse.json({ error: { code: 'invalid_kind' } }, { status: 400 });
  }
  const kind = kindParsed.data;
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: { code: 'unsupported_mime', message: `Allowed: ${Array.from(ALLOWED_MIME).join(', ')}` } },
      { status: 415 },
    );
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: { code: 'size_exceeded', maxBytes: MAX_BYTES } },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1] ?? 'bin';
  const filename = typeof filenameRaw === 'string' ? filenameRaw.slice(0, 240) : file.name?.slice(0, 240) ?? null;
  const captureContext =
    typeof captureContextRaw === 'string' ? captureContextRaw.trim().slice(0, 2000) || null : null;
  const supersedesUploadId =
    typeof supersedesRaw === 'string' && supersedesRaw.length > 0 ? supersedesRaw : null;

  if (supersedesUploadId) {
    const prior = await prisma.patientUpload.findFirst({
      where: {
        id: supersedesUploadId,
        patientId,
        orgId: authorizationUser.orgId,
        isDeleted: false,
      },
      select: { id: true },
    });
    if (!prior) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'Prior scan not found for this patient.' } },
        { status: 400 },
      );
    }
  }

  // Create the DB row first so we have an id for the S3 key.
  const row = await prisma.patientUpload.create({
    data: {
      orgId: authorizationUser.orgId,
      patientId,
      uploadedByOrgUserId: authorizationUser.orgUserId,
      kind,
      mimeType: file.type,
      filename,
      s3Bucket: PATIENT_UPLOADS_BUCKET,
      s3Key: '', // placeholder; updated immediately below
      byteSize: file.size,
      status: 'PENDING_EXTRACTION',
      captureContext,
      supersedesUploadId,
    },
    select: { id: true },
  });
  const key = patientUploadKeyFor(row.id, ext);
  await putPatientUpload({ key, body: bytes, contentType: file.type });
  await prisma.patientUpload.update({
    where: { id: row.id },
    data: { s3Key: key },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_UPLOAD_CREATED',
    resourceType: 'PatientUpload',
    resourceId: row.id,
    metadata: {
      patientUploadId: row.id,
      kind,
      mimeType: file.type,
      byteSize: file.size,
    },
  });

  // OTHER kind is operator-uploaded for archive only; never auto-
  // extract. Other kinds go straight to the queue.
  if (kind !== 'OTHER') {
    try {
      await enqueuePatientUploadExtract({ orgId: authorizationUser.orgId, uploadId: row.id });
    } catch (e) {
      console.error(`[patient-uploads] enqueue failed for ${row.id}`, e);
    }
  } else {
    await prisma.patientUpload.update({
      where: { id: row.id },
      data: { status: 'MANUAL_ONLY' },
    });
  }

  return NextResponse.json(
    {
      data: {
        uploadId: row.id,
        kind,
        status: kind === 'OTHER' ? 'MANUAL_ONLY' : 'PENDING_EXTRACTION',
      },
    },
    { status: 201 },
  );
}
