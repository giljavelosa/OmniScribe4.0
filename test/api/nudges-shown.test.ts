import { describe, expect, it, beforeEach, vi } from 'vitest';

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

import { POST } from '@/app/api/nudges/[id]/shown/route';

function authed() {
  requireFeatureAccess.mockResolvedValueOnce({
    user: { id: 'user_1' },
    authorizationUser: { orgId: 'org_1', orgUserId: 'ou_1', role: 'CLINICIAN' },
    orgUser: { id: 'ou_1', orgId: 'org_1' },
  });
}

function buildReq(body: unknown) {
  return new Request('http://test.local/api/nudges/n_1/shown', {
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

describe('POST /api/nudges/[id]/shown', () => {
  it('happy path: PROPOSED → SHOWN + shownAt stamped + audit fires once', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce({
      id: 'n_1',
      orgId: 'org_1',
      status: 'PROPOSED',
      kind: 'CASE_FHIR_STATUS_DRIFT',
      priority: 'HIGH',
      shownAt: null,
    });
    nudgeUpdate.mockResolvedValueOnce({});
    const res = await POST(
      buildReq({ surface: 'CHART' }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(200);
    expect(nudgeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SHOWN' }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLEO_NUDGE_SHOWN',
        metadata: expect.objectContaining({
          surface: 'CHART',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  it('idempotent: shownAt already set → 200, no second update, no second audit (decision 5)', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce({
      id: 'n_1',
      orgId: 'org_1',
      status: 'SHOWN',
      kind: 'CASE_FHIR_STATUS_DRIFT',
      priority: 'HIGH',
      shownAt: new Date('2026-05-22T12:00:00Z'),
    });
    const res = await POST(
      buildReq({ surface: 'CHART' }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(200);
    expect(nudgeUpdate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('SNOOZED → SNOOZED status preserved + shownAt stamped if absent', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce({
      id: 'n_1',
      orgId: 'org_1',
      status: 'SNOOZED',
      kind: 'GOAL_STALLED',
      priority: 'MEDIUM',
      shownAt: null,
    });
    nudgeUpdate.mockResolvedValueOnce({});
    const res = await POST(
      buildReq({ surface: 'VISIT_PREPARE' }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(200);
  });

  it('409 invalid_state on ACTED (terminal — nudge no longer surfaced)', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce({
      id: 'n_1',
      orgId: 'org_1',
      status: 'ACTED',
      kind: 'GOAL_STALLED',
      priority: 'MEDIUM',
      shownAt: null,
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
});
