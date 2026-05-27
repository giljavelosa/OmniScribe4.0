import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * GET /api/patients/[id]/uploads/[uploadId]/file — auth-gated bytes
 * for in-browser scan preview.
 *
 * Reported 2026-05-25: <ScanReviewSheet>'s `<img src={presignedUrl}>`
 * rendered as a broken-image icon in dev because the s3 stub helper
 * returned `file://…` URLs, which browsers refuse to load from an
 * `http://localhost` origin (cross-origin / sandbox). This route is
 * the dev-mode fallback the metadata GET points the browser at.
 *
 * Pinning down:
 *   - Soft-deleted uploads → 404 (don't serve audit-only bytes
 *     after a clinician deletes a scan, even if the URL leaks).
 *   - Cross-tenant access → blocked by the same org-scope gate as
 *     the metadata GET.
 *   - Content-Type / Content-Length / Cache-Control headers — the
 *     `<img>` tag relies on the right MIME being set; the cache
 *     header keeps the bytes in the browser for one minute so a
 *     re-open doesn't hit S3/disk again.
 */

const noteFindFirst = vi.fn();
const requireFeatureAccess = vi.fn();
const getPatientUploadBytes = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    patientUpload: { findFirst: (...a: unknown[]) => noteFindFirst(...a) },
  },
}));

vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));

vi.mock('@/lib/phi-access', () => ({
  assertOrgScoped: vi.fn(),
}));

vi.mock('@/lib/s3/client', () => ({
  getPatientUploadBytes: (...a: unknown[]) => getPatientUploadBytes(...a),
}));

import { GET } from '@/app/api/patients/[id]/uploads/[uploadId]/file/route';

function authedGuard() {
  return {
    user: { id: 'user_1' },
    orgUser: { orgId: 'org_1' },
    authorizationUser: {
      userId: 'user_1',
      orgUserId: 'ou_caller',
      orgId: 'org_1',
      role: 'CLINICIAN',
    },
  };
}

function uploadFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'upload_1',
    orgId: 'org_1',
    mimeType: 'image/jpeg',
    s3Key: 'patient-uploads/upload_1.jpeg',
    byteSize: 12_345,
    ...overrides,
  };
}

beforeEach(() => {
  noteFindFirst.mockReset();
  requireFeatureAccess.mockReset();
  getPatientUploadBytes.mockReset();
  requireFeatureAccess.mockResolvedValue(authedGuard());
});

describe('GET /api/patients/[id]/uploads/[uploadId]/file', () => {
  it('streams bytes with the upload mime + cache + no-index headers', async () => {
    noteFindFirst.mockResolvedValueOnce(uploadFixture());
    getPatientUploadBytes.mockResolvedValueOnce(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

    const res = await GET(
      new Request('http://test.local/api/patients/pat/uploads/upload_1/file'),
      { params: Promise.resolve({ id: 'pat', uploadId: 'upload_1' }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('content-length')).toBe('12345');
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
    // Defense in depth: PHI shouldn't be picked up by a cache or
    // search engine even if a presigned URL leaks.
    expect(res.headers.get('x-robots-tag')).toMatch(/noindex/i);
  });

  it('returns 404 for a soft-deleted upload (`isDeleted` is in the WHERE)', async () => {
    // Prisma's findFirst returns null for soft-deleted rows because
    // the route includes `isDeleted: false` in its WHERE clause.
    noteFindFirst.mockResolvedValueOnce(null);

    const res = await GET(
      new Request('http://test.local/api/patients/pat/uploads/deleted/file'),
      { params: Promise.resolve({ id: 'pat', uploadId: 'deleted' }) },
    );
    expect(res.status).toBe(404);
    expect(getPatientUploadBytes).not.toHaveBeenCalled();
  });

  it('queries Prisma with the org-scope predicate (cross-tenant blocked)', async () => {
    noteFindFirst.mockResolvedValueOnce(null);

    await GET(
      new Request('http://test.local/api/patients/pat/uploads/upload_1/file'),
      { params: Promise.resolve({ id: 'pat', uploadId: 'upload_1' }) },
    );

    expect(noteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'upload_1',
          patientId: 'pat',
          orgId: 'org_1',
          isDeleted: false,
        }),
      }),
    );
  });

  it('returns 500 read_failed when S3 / stub fetch throws', async () => {
    noteFindFirst.mockResolvedValueOnce(uploadFixture());
    getPatientUploadBytes.mockRejectedValueOnce(new Error('disk gone'));

    const res = await GET(
      new Request('http://test.local/api/patients/pat/uploads/upload_1/file'),
      { params: Promise.resolve({ id: 'pat', uploadId: 'upload_1' }) },
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('read_failed');
  });
});
