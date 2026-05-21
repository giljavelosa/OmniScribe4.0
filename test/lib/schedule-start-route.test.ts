import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * POST /api/schedules/[id]/start — picker integration tests.
 *
 * Confirms the route:
 *   - Accepts an optional body with `episodeOfCareId` + `pickerSource` and
 *     threads both into startVisit().
 *   - When no body is sent and `schedule.episodeOfCareId` is set, inherits
 *     that link with source=inherited-schedule.
 *   - When no body is sent and the schedule has no pre-link, calls startVisit
 *     without an episode id so its auto-link path runs.
 *   - Returns the existing encounter+note pair when a prior start has
 *     happened (idempotency / Resume case).
 */

const scheduleFindFirst = vi.fn();
const encounterFindUnique = vi.fn();
const noteFindFirst = vi.fn();
const orgUserFindUnique = vi.fn();
const siteFindMany = vi.fn();
const orgUserSiteFindMany = vi.fn();
const txMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    schedule: { findFirst: (...a: unknown[]) => scheduleFindFirst(...a) },
    encounter: { findUnique: (...a: unknown[]) => encounterFindUnique(...a) },
    note: { findFirst: (...a: unknown[]) => noteFindFirst(...a) },
    // Multi-site enrollment: getClinicianSiteIds reads orgUser + orgUserSite.
    // Default to a CLINICIAN enrolled at the schedule.siteId so picker-only
    // tests don't trip the new `site_not_enrolled` guard.
    orgUser: { findUnique: (...a: unknown[]) => orgUserFindUnique(...a) },
    site: { findMany: (...a: unknown[]) => siteFindMany(...a) },
    orgUserSite: { findMany: (...a: unknown[]) => orgUserSiteFindMany(...a) },
    $transaction: (cb: (tx: unknown) => Promise<unknown>) => txMock(cb),
  },
}));

const requireFeatureAccess = vi.fn();
vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));

const writeAuditLog = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

const startVisit = vi.fn();
vi.mock('@/lib/encounters/start', () => ({
  startVisit: (...a: unknown[]) => startVisit(...a),
}));

// Seat gate: bypass — these tests predate Wave 7 billing and don't test
// seat enforcement. checkClinicianSeat always passes here.
vi.mock('@/lib/authz/seat', () => ({
  checkClinicianSeat: vi.fn(async () => ({ ok: true })),
  seatRequiredResponse: vi.fn(),
}));

import { POST } from '@/app/api/schedules/[id]/start/route';

beforeEach(() => {
  scheduleFindFirst.mockReset();
  encounterFindUnique.mockReset();
  noteFindFirst.mockReset();
  orgUserFindUnique.mockReset();
  siteFindMany.mockReset();
  orgUserSiteFindMany.mockReset();
  txMock.mockReset();
  requireFeatureAccess.mockReset();
  writeAuditLog.mockReset();
  startVisit.mockReset();
  // Default site-scope: caller is a CLINICIAN enrolled at site_1, matching the
  // schedule fixtures below. Individual tests can override these mocks.
  orgUserFindUnique.mockResolvedValue({ role: 'CLINICIAN', orgId: 'org_1' });
  orgUserSiteFindMany.mockResolvedValue([{ siteId: 'site_1' }]);
});

function authedGuard() {
  return {
    user: { id: 'user_1' },
    orgUser: {},
    authorizationUser: {
      userId: 'user_1',
      orgUserId: 'ou_1',
      orgId: 'org_1',
      role: 'CLINICIAN',
      division: 'MULTI',
      platformRole: 'NONE',
      canManagePatients: true,
    },
  };
}

function makeReq(body: unknown | undefined): Request {
  const init: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new Request('http://localhost/api/schedules/sched_1/start', init);
}

const paramsFor = (id = 'sched_1') => Promise.resolve({ id });

describe('POST /api/schedules/[id]/start — episode picker integration', () => {
  it('threads body.episodeOfCareId + body.pickerSource into startVisit', async () => {
    requireFeatureAccess.mockResolvedValueOnce(authedGuard());
    scheduleFindFirst.mockResolvedValueOnce({
      id: 'sched_1',
      orgId: 'org_1',
      patientId: 'pat_1',
      clinicianOrgUserId: 'ou_1',
      siteId: 'site_1',
      roomId: null,
      episodeOfCareId: null,
    });
    txMock.mockImplementation(async (cb) =>
      cb({
        encounter: { findUnique: vi.fn().mockResolvedValue(null) },
        note: { findFirst: vi.fn().mockResolvedValue(null) },
      }),
    );
    startVisit.mockResolvedValueOnce({
      encounter: { id: 'enc_1' },
      note: { id: 'note_1' },
    });

    const res = await POST(
      makeReq({ episodeOfCareId: 'ep_chosen', pickerSource: 'picker' }),
      { params: paramsFor() },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { encounterId: 'enc_1', noteId: 'note_1' },
    });
    expect(startVisit).toHaveBeenCalledOnce();
    const arg = startVisit.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      orgId: 'org_1',
      patientId: 'pat_1',
      scheduleId: 'sched_1',
      episodeOfCareId: 'ep_chosen',
      pickerSource: 'picker',
    });
  });

  it('threads episodeOfCareId=null + pickerSource=manual-skip when the body chose "skip"', async () => {
    requireFeatureAccess.mockResolvedValueOnce(authedGuard());
    scheduleFindFirst.mockResolvedValueOnce({
      id: 'sched_1',
      orgId: 'org_1',
      patientId: 'pat_1',
      clinicianOrgUserId: 'ou_1',
      siteId: 'site_1',
      roomId: null,
      // Schedule HAS a pre-link, but the body explicitly skips — body wins.
      episodeOfCareId: 'ep_schedule_default',
    });
    txMock.mockImplementation(async (cb) =>
      cb({
        encounter: { findUnique: vi.fn().mockResolvedValue(null) },
        note: { findFirst: vi.fn().mockResolvedValue(null) },
      }),
    );
    startVisit.mockResolvedValueOnce({
      encounter: { id: 'enc_2' },
      note: { id: 'note_2' },
    });

    await POST(
      makeReq({ episodeOfCareId: null, pickerSource: 'manual-skip' }),
      { params: paramsFor() },
    );
    const arg = startVisit.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.episodeOfCareId).toBeUndefined();
    expect(arg.pickerSource).toBe('manual-skip');
  });

  it('inherits schedule.episodeOfCareId with source=inherited-schedule when no body is sent', async () => {
    requireFeatureAccess.mockResolvedValueOnce(authedGuard());
    scheduleFindFirst.mockResolvedValueOnce({
      id: 'sched_1',
      orgId: 'org_1',
      patientId: 'pat_1',
      clinicianOrgUserId: 'ou_1',
      siteId: 'site_1',
      roomId: null,
      episodeOfCareId: 'ep_prelink',
    });
    txMock.mockImplementation(async (cb) =>
      cb({
        encounter: { findUnique: vi.fn().mockResolvedValue(null) },
        note: { findFirst: vi.fn().mockResolvedValue(null) },
      }),
    );
    startVisit.mockResolvedValueOnce({
      encounter: { id: 'enc_3' },
      note: { id: 'note_3' },
    });

    await POST(makeReq(undefined), { params: paramsFor() });
    const arg = startVisit.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.episodeOfCareId).toBe('ep_prelink');
    expect(arg.pickerSource).toBe('inherited-schedule');
  });

  it('passes undefined episodeOfCareId when no body and no schedule pre-link (auto-link path)', async () => {
    requireFeatureAccess.mockResolvedValueOnce(authedGuard());
    scheduleFindFirst.mockResolvedValueOnce({
      id: 'sched_1',
      orgId: 'org_1',
      patientId: 'pat_1',
      clinicianOrgUserId: 'ou_1',
      siteId: 'site_1',
      roomId: null,
      episodeOfCareId: null,
    });
    txMock.mockImplementation(async (cb) =>
      cb({
        encounter: { findUnique: vi.fn().mockResolvedValue(null) },
        note: { findFirst: vi.fn().mockResolvedValue(null) },
      }),
    );
    startVisit.mockResolvedValueOnce({
      encounter: { id: 'enc_4' },
      note: { id: 'note_4' },
    });

    await POST(makeReq(undefined), { params: paramsFor() });
    const arg = startVisit.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.episodeOfCareId).toBeUndefined();
    expect(arg.pickerSource).toBeUndefined();
  });

  it('returns the existing encounter+note pair without calling startVisit (Resume path)', async () => {
    requireFeatureAccess.mockResolvedValueOnce(authedGuard());
    scheduleFindFirst.mockResolvedValueOnce({
      id: 'sched_1',
      orgId: 'org_1',
      patientId: 'pat_1',
      clinicianOrgUserId: 'ou_1',
      siteId: 'site_1',
      roomId: null,
      episodeOfCareId: null,
    });
    txMock.mockImplementation(async (cb) =>
      cb({
        encounter: {
          findUnique: vi.fn().mockResolvedValue({ id: 'enc_existing' }),
        },
        note: {
          findFirst: vi.fn().mockResolvedValue({ id: 'note_existing' }),
        },
      }),
    );

    const res = await POST(makeReq(undefined), { params: paramsFor() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { encounterId: 'enc_existing', noteId: 'note_existing' },
    });
    expect(startVisit).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('400s when the body is malformed JSON-but-not-the-schema', async () => {
    requireFeatureAccess.mockResolvedValueOnce(authedGuard());
    const req = new Request('http://localhost/api/schedules/sched_1/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickerSource: 'definitely-not-a-valid-source' }),
    });
    const res = await POST(req, { params: paramsFor() });
    expect(res.status).toBe(400);
  });
});
