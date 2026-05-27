/**
 * Sprint 0.19 / Tier 13 — single PatientUpload routes.
 *
 *   GET     /api/patients/[id]/uploads/[uploadId]   — detail + presigned URL
 *   DELETE  /api/patients/[id]/uploads/[uploadId]   — soft-delete (rule 7)
 *
 * Hard-deleting the S3 object is NOT supported here; isDeleted is the
 * one supported lifecycle endpoint.
 */
import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { writeAuditLog } from '@/lib/audit/log';
import { getPresignedPatientUploadUrl } from '@/lib/s3/client';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; uploadId: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;
  const { id: patientId, uploadId } = await params;

  const upload = await prisma.patientUpload.findFirst({
    where: {
      id: uploadId,
      patientId,
      orgId: authorizationUser.orgId,
      isDeleted: false,
    },
    select: {
      id: true,
      orgId: true,
      patientId: true,
      kind: true,
      mimeType: true,
      filename: true,
      s3Key: true,
      byteSize: true,
      status: true,
      ocrText: true,
      extractedJson: true,
      extractionErrorMessage: true,
      captureContext: true,
      attestedJson: true,
      attestedAt: true,
      supersedesUploadId: true,
      createdAt: true,
    },
  });
  if (!upload) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(upload.orgId, authorizationUser.orgId);

  // Production → presigned S3 URL (direct browser fetch, no Next round-trip).
  // Dev stub mode → /api/.../file route, because a `file://` URL is
  // cross-origin-blocked by the browser when the page is on
  // `http://localhost` and the `<img>` would render as a broken-image
  // icon. The /file route is auth-gated + org-scoped identically to
  // this metadata GET.
  const isStubMode = !process.env.S3_PATIENT_UPLOADS_BUCKET;
  const url = isStubMode
    ? `/api/patients/${patientId}/uploads/${uploadId}/file`
    : await getPresignedPatientUploadUrl(upload.s3Key, 300).catch(() => null);
  return NextResponse.json({
    data: {
      uploadId: upload.id,
      patientId: upload.patientId,
      kind: upload.kind,
      mimeType: upload.mimeType,
      filename: upload.filename,
      byteSize: upload.byteSize,
      status: upload.status,
      ocrText: upload.ocrText,
      extractedJson: upload.extractedJson,
      extractionError: upload.extractionErrorMessage,
      captureContext: upload.captureContext,
      attestedJson: upload.attestedJson,
      attestedAt: upload.attestedAt?.toISOString() ?? null,
      supersedesUploadId: upload.supersedesUploadId,
      createdAt: upload.createdAt.toISOString(),
      presignedUrl: url,
    },
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; uploadId: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;
  const { id: patientId, uploadId } = await params;

  const upload = await prisma.patientUpload.findFirst({
    where: { id: uploadId, patientId, orgId: authorizationUser.orgId },
    select: { id: true, orgId: true, kind: true, isDeleted: true },
  });
  if (!upload) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(upload.orgId, authorizationUser.orgId);

  if (upload.isDeleted) {
    return NextResponse.json({ data: { uploadId, isDeleted: true } });
  }

  await prisma.patientUpload.update({
    where: { id: uploadId },
    data: { isDeleted: true, deletedAt: new Date() },
  });
  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_UPLOAD_DELETED',
    resourceType: 'PatientUpload',
    resourceId: uploadId,
    metadata: { patientUploadId: uploadId, kind: upload.kind, reason: 'clinician_request' },
  });

  return NextResponse.json({ data: { uploadId, isDeleted: true } });
}
