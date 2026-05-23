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

import { POST } from '@/app/api/nudges/[id]/act/route';

function authed() {
  requireFeatureAccess.mockResolvedValueOnce({
    user: { id: 'user_1' },
    authorizationUser: { orgId: 'org_1', orgUserId: 'ou_1', role: 'CLINICIAN' },
    orgUser: { id: 'ou_1', orgId: 'org_1' },
  });
}

function buildReq(body: unknown) {
  return new Request('http://test.local/api/nudges/n_1/act', {
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

describe('POST /api/nudges/[id]/act', () => {
  it('happy path: PROPOSED → ACTED + audit records the affordance slug', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce({
      id: 'n_1',
      orgId: 'org_1',
      status: 'PROPOSED',
      kind: 'CASE_FHIR_STATUS_DRIFT',
      priority: 'HIGH',
      patientId: 'pat_1',
    });
    nudgeUpdate.mockResolvedValueOnce({});
    const res = await POST(
      buildReq({ affordanceSlug: 'open-reconcile-flow' }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      ok: true,
      status: 'ACTED',
      affordanceSlug: 'open-reconcile-flow',
    });
    expect(nudgeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ACTED',
          actedByUserId: 'user_1',
          actedAction: 'open-reconcile-flow',
        }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLEO_NUDGE_ACTED',
        metadata: expect.objectContaining({
          nudgeId: 'n_1',
          affordanceSlug: 'open-reconcile-flow',
          kind: 'CASE_FHIR_STATUS_DRIFT',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  it('idempotent: already ACTED → 200 with status, no second audit', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce({
      id: 'n_1',
      orgId: 'org_1',
      status: 'ACTED',
      kind: 'CASE_FHIR_STATUS_DRIFT',
      priority: 'HIGH',
      patientId: 'pat_1',
    });
    const res = await POST(
      buildReq({ affordanceSlug: 'open-reconcile-flow' }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(200);
    expect(nudgeUpdate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('409 invalid_state on DISMISSED (terminal)', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce({
      id: 'n_1',
      orgId: 'org_1',
      status: 'DISMISSED',
      kind: 'CASE_FHIR_STATUS_DRIFT',
      priority: 'HIGH',
      patientId: 'pat_1',
    });
    const res = await POST(
      buildReq({ affordanceSlug: 'open-reconcile-flow' }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(409);
  });

  it('SNOOZED → ACTED allowed (clinician acts on a snoozed nudge directly)', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce({
      id: 'n_1',
      orgId: 'org_1',
      status: 'SNOOZED',
      kind: 'CASE_FHIR_STATUS_DRIFT',
      priority: 'HIGH',
      patientId: 'pat_1',
    });
    nudgeUpdate.mockResolvedValueOnce({});
    const res = await POST(
      buildReq({ affordanceSlug: 'open-reconcile-flow' }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(200);
  });

  it('400 bad_request on unrecognized affordance slug', async () => {
    authed();
    const res = await POST(
      buildReq({ affordanceSlug: 'generic-open' }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(400);
  });

  it('404 when nudge does not exist', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce(null);
    const res = await POST(
      buildReq({ affordanceSlug: 'open-reconcile-flow' }),
      { params: Promise.resolve({ id: 'n_missing' }) },
    );
    expect(res.status).toBe(404);
  });
});
