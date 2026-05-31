import { NextResponse } from 'next/server';
import { ExternalContextMediaKind, ExternalContextStatus, Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { writeAuditLog } from '@/lib/audit/log';
import { enqueueCleoStateRefresh } from '@/lib/queue';
import { buildVerifiedDocumentTranscript } from '@/lib/external-context/document-transcript';
import { ExtractionJsonSchema } from '@/types/external-context-extraction';

export const runtime = 'nodejs';

const bodySchema = z.object({
  extraction: ExtractionJsonSchema,
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; ecId: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id: patientId, ecId } = await params;
  const row = await prisma.externalContext.findFirst({
    where: { id: ecId, patientId, orgId: authorizationUser.orgId },
    select: {
      id: true,
      orgId: true,
      patientId: true,
      mediaKind: true,
      status: true,
      verifiedAt: true,
      transcriptClean: true,
      vettedExtractionJson: true,
      deletedAt: true,
      patient: { select: { orgId: true } },
    },
  });
  if (!row) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(row.patient.orgId, authorizationUser.orgId);

  if (row.mediaKind !== ExternalContextMediaKind.DOCUMENT) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Only document rows can be verified here.' } },
      { status: 400 },
    );
  }
  if (row.deletedAt) {
    return NextResponse.json(
      { error: { code: 'gone', message: 'This document has been discarded.' } },
      { status: 410 },
    );
  }
  if (row.status === ExternalContextStatus.READY && row.verifiedAt) {
    return NextResponse.json({
      data: {
        id: row.id,
        status: row.status,
        verifiedAt: row.verifiedAt.toISOString(),
        transcriptClean: row.transcriptClean,
        vettedExtractionJson: row.vettedExtractionJson,
      },
    });
  }
  if (row.status !== ExternalContextStatus.EXTRACTED || row.verifiedAt) {
    return NextResponse.json(
      { error: { code: 'conflict', message: 'Document is not awaiting clinician review.' } },
      { status: 409 },
    );
  }

  const transcriptClean = buildVerifiedDocumentTranscript(parsed.data.extraction);
  const verifiedAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const verified = await tx.externalContext.update({
      where: { id: row.id },
      data: {
        verifiedAt,
        verifiedByOrgUserId: orgUser.id,
        vettedExtractionJson: parsed.data.extraction as unknown as Prisma.InputJsonValue,
        transcriptClean,
        status: ExternalContextStatus.READY,
      },
    });
    await tx.externalContextDocumentPage.updateMany({
      where: { externalContextId: row.id, orgId: authorizationUser.orgId },
      data: { verifiedAt },
    });
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'EXTERNAL_CONTEXT_VERIFIED',
      resourceType: 'ExternalContext',
      resourceId: row.id,
      metadata: {
        patientId: row.patientId,
        verifierOrgUserId: orgUser.id,
        documentType: parsed.data.extraction.documentType,
        diagnosisCount: parsed.data.extraction.diagnoses.length,
        medicationCount: parsed.data.extraction.medications.length,
        allergyCount: parsed.data.extraction.allergies.length,
        labCount: parsed.data.extraction.labs.length,
        vitalCount: parsed.data.extraction.vitals.length,
        procedureCount: parsed.data.extraction.procedures.length,
      },
      tx,
    });
    return verified;
  });

  await enqueueCleoStateRefresh({
    orgId: authorizationUser.orgId,
    patientId: row.patientId,
    clinicianOrgUserId: orgUser.id,
  }).catch((err: unknown) => {
    console.warn('[queue] Cleo state refresh enqueue failed after document verification', {
      externalContextId: row.id,
      error: err instanceof Error ? err.name : 'UnknownError',
    });
  });

  return NextResponse.json({
    data: {
      id: updated.id,
      status: updated.status,
      verifiedAt: updated.verifiedAt?.toISOString() ?? null,
      transcriptClean: updated.transcriptClean,
      vettedExtractionJson: updated.vettedExtractionJson,
    },
  });
}
