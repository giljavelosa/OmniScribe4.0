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

import { POST } from '@/app/api/nudges/[id]/snooze/route';

function authed() {
  requireFeatureAccess.mockResolvedValueOnce({
    user: { id: 'user_1' },
    authorizationUser: { orgId: 'org_1', orgUserId: 'ou_1', role: 'CLINICIAN' },
    orgUser: { id: 'ou_1', orgId: 'org_1' },
  });
}

function buildReq(body: unknown) {
  return new Request('http://test.local/api/nudges/n_1/snooze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const inOneDay = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  nudgeFindUnique.mockReset();
  nudgeUpdate.mockReset();
  writeAuditLog.mockReset();
  requireFeatureAccess.mockReset();
});

describe('POST /api/nudges/[id]/snooze', () => {
  it('happy path: PROPOSED → SNOOZED with snoozeUntil + audit', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce({
      id: 'n_1',
      orgId: 'org_1',
      status: 'PROPOSED',
      kind: 'TOPIC_MENTIONED_UNADDRESSED',
      priority: 'LOW',
    });
    nudgeUpdate.mockResolvedValueOnce({});
    const until = inOneDay();
    const res = await POST(
      buildReq({ until, surface: 'VISIT_PREPARE' }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(200);
    expect(nudgeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SNOOZED',
          snoozedByUserId: 'user_1',
        }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLEO_NUDGE_SNOOZED',
        metadata: expect.objectContaining({
          nudgeId: 'n_1',
          snoozeUntilIso: until,
          surface: 'VISIT_PREPARE',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  it('400 bad_request when `until` is in the past', async () => {
    authed();
    const res = await POST(
      buildReq({
        until: new Date(Date.now() - 1000).toISOString(),
        surface: 'CHART',
      }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(400);
  });

  it('400 bad_request when `until` is > 30 days out', async () => {
    authed();
    const res = await POST(
      buildReq({
        until: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
        surface: 'CHART',
      }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(400);
  });

  it('409 invalid_state on ACTED', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce({
      id: 'n_1',
      orgId: 'org_1',
      status: 'ACTED',
      kind: 'TOPIC_MENTIONED_UNADDRESSED',
      priority: 'LOW',
    });
    const res = await POST(
      buildReq({ until: inOneDay(), surface: 'CHART' }),
      { params: Promise.resolve({ id: 'n_1' }) },
    );
    expect(res.status).toBe(409);
  });

  it('404 when nudge does not exist', async () => {
    authed();
    nudgeFindUnique.mockResolvedValueOnce(null);
    const res = await POST(
      buildReq({ until: inOneDay(), surface: 'CHART' }),
      { params: Promise.resolve({ id: 'n_missing' }) },
    );
    expect(res.status).toBe(404);
  });
});
