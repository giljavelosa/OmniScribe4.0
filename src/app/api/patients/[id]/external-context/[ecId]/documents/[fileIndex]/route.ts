import { NextResponse } from 'next/server';

import { writeAuditLog } from '@/lib/audit/log';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { prisma } from '@/lib/prisma';
import { getObjectBytes } from '@/lib/s3/client';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; ecId: string; fileIndex: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id: patientId, ecId, fileIndex } = await params;
  const parsedIndex = Number(fileIndex);
  if (!Number.isInteger(parsedIndex) || parsedIndex < 0) {
    return NextResponse.json({ error: { code: 'invalid_file_index' } }, { status: 400 });
  }

  const row = await prisma.externalContext.findFirst({
    where: {
      id: ecId,
      patientId,
      orgId: authorizationUser.orgId,
      deletedAt: null,
    },
    select: {
      id: true,
      patient: { select: { orgId: true } },
      documentFileKeys: true,
      documentMimeTypes: true,
    },
  });
  if (!row) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(row.patient.orgId, authorizationUser.orgId);

  const key = row.documentFileKeys[parsedIndex];
  if (!key) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'EXTERNAL_CONTEXT_VIEWED',
    resourceType: 'ExternalContext',
    resourceId: ecId,
    metadata: {
      surface: 'document-preview',
      fileIndex: parsedIndex,
      mimeType: row.documentMimeTypes[parsedIndex] ?? null,
    },
  });

  const bytes = await getObjectBytes(key).catch(() => null);
  if (!bytes) {
    return NextResponse.json({ error: { code: 'source_file_unavailable' } }, { status: 404 });
  }

  const mimeType = row.documentMimeTypes[parsedIndex] ?? 'application/octet-stream';
  const body = new Blob([new Uint8Array(bytes)], { type: mimeType });

  return new NextResponse(body, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `inline; filename="document-${parsedIndex + 1}"`,
      'Content-Length': String(bytes.byteLength),
      'Content-Type': mimeType,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
