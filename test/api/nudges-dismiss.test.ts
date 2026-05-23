import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * Sprint 0.18 — POST /api/nudges/[id]/dismiss tests.
 *
 * `@/lib/queue` is mocked so `src/lib/redis.ts` doesn't throw at
 * module-load when REDIS_URL is unset in CI (per Sprint-0.16/17 test
 * mocking note).
 */

const nudgeFindUnique = vi.fn();
const nudgeUpdate = vi.fn();
const writeAuditLog = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    cleoNudge: {
      findUnique: (...a: unknown[]) => nudgeFindUnique(...a),
      update: (...a: unknown[]) => nudgeUpdate(...a),
    },
  },
}));
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));
vi.mock('@/lib/queue', () => ({
  enqueueCleoStateRefresh: vi.fn(),
  enqueueFhirWriteback: vi.fn(),
}));
vi.mock('@/lib/phi-access', () => ({ assertOrgScoped: vi.fn() }));

const requireFeatureAccess = vi.fn();
vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));

import { POST } from '@/app/api/nudges/[id]/dismiss/route';

function authed() {
  requireFeatureAccess.mockResolvedValueOnce({
    user: { id: 'user_1' },
    authorizationUser: { orgId: 'org_1', orgUserId: 'ou_1', role: 'CLINICIAN' },
    orgUser: { id: 'ou_1', orgId: 'org_1' },
  });
}

function buildReq(body: unknown) {
  return new Request('http://test.local/api/nudges/n_1/dismiss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  nudgeFindUnique.mockReset();
  nudgeUpdate.mockReset();
  writeAuditLog.mockReset();
  requireFeatureAccess.mockReset();
});

describe('POST /api/nudges/[id]/dismiss', () => {
  it('happy path: PROPOSED → DISMISSED + audit with surface metadata', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce({
      id: 'n_1',
      orgId: 'org_1',
      status: 'PROPOSED',
      kind: 'CASE_FHIR_STATUS_DRIFT',
      priority: 'HIGH',
    });
    nudgeUpdate.mockResolvedValueOnce({});
    const res = await POST(
      buildReq({ surface: 'CHART' }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(200);
    expect(nudgeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DISMISSED',
          dismissedByUserId: 'user_1',
        }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLEO_NUDGE_DISMISSED',
        metadata: expect.objectContaining({
          nudgeId: 'n_1',
          kind: 'CASE_FHIR_STATUS_DRIFT',
          priority: 'HIGH',
          surface: 'CHART',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  it('SHOWN → DISMISSED also allowed', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce({
      id: 'n_1',
      orgId: 'org_1',
      status: 'SHOWN',
      kind: 'GOAL_STALLED',
      priority: 'MEDIUM',
    });
    nudgeUpdate.mockResolvedValueOnce({});
    const res = await POST(
      buildReq({ surface: 'VISIT_PREPARE' }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(200);
  });

  it('idempotent: already DISMISSED → 200, no second update, no second audit', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce({
      id: 'n_1',
      orgId: 'org_1',
      status: 'DISMISSED',
      kind: 'GOAL_STALLED',
      priority: 'MEDIUM',
    });
    const res = await POST(
      buildReq({ surface: 'CHART' }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(200);
    expect(nudgeUpdate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('409 invalid_state on ACTED (terminal)', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce({
      id: 'n_1',
      orgId: 'org_1',
      status: 'ACTED',
      kind: 'GOAL_STALLED',
      priority: 'MEDIUM',
    });
    const res = await POST(
      buildReq({ surface: 'CHART' }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(409);
  });

  it('404 when nudge does not exist', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce(null);
    const res = await POST(
      buildReq({ surface: 'CHART' }),
      { params: Promise.resolve({ id: 'n_missing' }) },
    );
    expect(res.status).toBe(404);
  });

  it('400 bad_request when body is missing surface', async () => {
    authed();
    const res = await POST(
      buildReq({}),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(400);
  });
});
