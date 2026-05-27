import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { getPatientUploadBytes } from '@/lib/s3/client';

export const runtime = 'nodejs';

/**
 * GET /api/patients/[id]/uploads/[uploadId]/file — auth-gated bytes for
 * in-browser preview.
 *
 * Why this exists
 * ---------------
 * In production the upload's "presigned URL" is a real time-bounded S3
 * GET — the browser fetches it directly, no Next.js round-trip. In dev
 * stub mode (no `S3_PATIENT_UPLOADS_BUCKET`) the presigned helper used
 * to return `file://…/tmp/patient-uploads/…` so a developer could grep
 * the bytes from disk. Browsers refuse to load `file://` URLs from an
 * `http://localhost` page (cross-origin / sandbox), so the preview
 * `<img>` in <ScanReviewSheet> rendered as a broken-image icon and the
 * clinician couldn't see the actual scan.
 *
 * This route plugs that hole: in stub mode the upload-detail GET points
 * the browser at this URL instead of `file://`, the route streams the
 * bytes back through the same auth + org-scope gates as the metadata
 * GET, and the `<img>` paints normally. In production we still go
 * direct-to-S3.
 *
 * Auth
 * ----
 *  - Same `NOTE_REVIEW` feature gate as the metadata GET.
 *  - `assertOrgScoped` enforces tenant isolation.
 *  - Soft-deleted uploads return 404 — keeps deleted scans out of UI
 *    even if a stale URL still exists in someone's tab.
 *
 * Caching
 * -------
 * Cache-Control: private, max-age=60. Short window so a clinician
 * who reloads the sheet doesn't hit S3/disk every keystroke, but
 * not so long that a same-day rejection still serves bytes after
 * the row is soft-deleted.
 */
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
    select: { id: true, orgId: true, mimeType: true, s3Key: true, byteSize: true },
  });
  if (!upload) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(upload.orgId, authorizationUser.orgId);

  let bytes: Buffer;
  try {
    bytes = await getPatientUploadBytes(upload.s3Key);
  } catch (err) {
    console.error(`[uploads/file] failed to read ${upload.s3Key}`, err);
    return NextResponse.json({ error: { code: 'read_failed' } }, { status: 500 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': upload.mimeType,
      'Content-Length': String(upload.byteSize),
      'Cache-Control': 'private, max-age=60',
      // Defense in depth: scans are PHI; never let a search engine
      // or shared-cache CDN pick up the bytes even if the URL leaks.
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
