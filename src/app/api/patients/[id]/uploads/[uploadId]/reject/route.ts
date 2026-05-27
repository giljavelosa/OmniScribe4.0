/**
 * POST /api/patients/[id]/uploads/[uploadId]/reject
 *
 * Clinician denies a scan — row kept for audit, excluded from standing context.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { writeAuditLog } from '@/lib/audit/log';
import { uploadAwaitingReview } from '@/lib/patient-uploads/display';

export const runtime = 'nodejs';

const bodySchema = z.object({
  captureContext: z.string().max(2000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; uploadId: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;
  const { id: patientId, uploadId } = await params;

  let body: z.infer<typeof bodySchema> = {};
  try {
    const raw = await req.json().catch(() => ({}));
    body = bodySchema.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const upload = await prisma.patientUpload.findFirst({
    where: { id: uploadId, patientId, orgId: authorizationUser.orgId, isDeleted: false },
    select: { id: true, orgId: true, status: true, kind: true, captureContext: true },
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

  const updated = await prisma.patientUpload.update({
    where: { id: uploadId },
    data: {
      status: 'REJECTED',
      rejectedAt: new Date(),
      rejectedByOrgUserId: authorizationUser.orgUserId,
      captureContext: body.captureContext ?? upload.captureContext ?? undefined,
    },
    select: { id: true, status: true, rejectedAt: true },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_UPLOAD_REJECTED',
    resourceType: 'PatientUpload',
    resourceId: uploadId,
    metadata: {
      patientUploadId: uploadId,
      kind: upload.kind,
      hadCaptureContext: !!(body.captureContext ?? upload.captureContext),
    },
  });

  return NextResponse.json({
    data: {
      uploadId: updated.id,
      status: updated.status,
      rejectedAt: updated.rejectedAt?.toISOString() ?? null,
    },
  });
}
