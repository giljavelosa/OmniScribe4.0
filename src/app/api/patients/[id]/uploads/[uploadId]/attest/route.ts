/**
 * POST /api/patients/[id]/uploads/[uploadId]/attest
 *
 * Clinician accepts a scan — promotes EXTRACTED / MANUAL_ONLY /
 * EXTRACTION_FAILED rows to ATTESTED. attestedJson defaults to
 * extractedJson when omitted.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { writeAuditLog } from '@/lib/audit/log';
import { uploadAwaitingReview } from '@/lib/patient-uploads/display';
import { enqueueCleoStateRefresh } from '@/lib/queue';

export const runtime = 'nodejs';

const bodySchema = z.object({
  captureContext: z.string().max(2000).optional(),
  attestedJson: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; uploadId: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;
  const { id: patientId, uploadId } = await params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const upload = await prisma.patientUpload.findFirst({
    where: { id: uploadId, patientId, orgId: authorizationUser.orgId, isDeleted: false },
    select: {
      id: true,
      orgId: true,
      patientId: true,
      status: true,
      extractedJson: true,
      captureContext: true,
    },
  });
  if (!upload) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(upload.orgId, authorizationUser.orgId);

  if (!uploadAwaitingReview(upload.status)) {
    return NextResponse.json(
      { error: { code: 'invalid_status', message: 'This scan is not awaiting review.' } },
      { status: 409 },
    );
  }

  const attestedJson =
    body.attestedJson ??
    (upload.extractedJson && typeof upload.extractedJson === 'object'
      ? (upload.extractedJson as Record<string, unknown>)
      : {});

  const fieldCount =
    attestedJson && typeof attestedJson === 'object' ? Object.keys(attestedJson).length : 0;

  const updated = await prisma.patientUpload.update({
    where: { id: uploadId },
    data: {
      status: 'ATTESTED',
      attestedJson: attestedJson as never,
      attestedAt: new Date(),
      attestedByOrgUserId: authorizationUser.orgUserId,
      captureContext: body.captureContext ?? upload.captureContext ?? undefined,
      rejectedAt: null,
      rejectedByOrgUserId: null,
    },
    select: { id: true, status: true, kind: true, attestedAt: true },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_UPLOAD_ATTESTED',
    resourceType: 'PatientUpload',
    resourceId: uploadId,
    metadata: {
      patientUploadId: uploadId,
      kind: updated.kind,
      attestedFieldCount: fieldCount,
      hadCaptureContext: !!(body.captureContext ?? upload.captureContext),
    },
  });

  try {
    await enqueueCleoStateRefresh({
      orgId: authorizationUser.orgId,
      patientId: upload.patientId,
      clinicianOrgUserId: authorizationUser.orgUserId,
    });
  } catch (e) {
    console.error(`[patient-uploads] cleo-state enqueue failed for ${uploadId}`, e);
  }

  return NextResponse.json({
    data: {
      uploadId: updated.id,
      status: updated.status,
      attestedAt: updated.attestedAt?.toISOString() ?? null,
    },
  });
}
