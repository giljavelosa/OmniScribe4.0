import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POST /api/encounters — late-entry charting (spec §API).
 *
 * Verifies the route accepts an optional `dateOfService`, validates it
 * against the 30-day floor + today ceiling, and passes the computed
 * isLateEntry/lateEntryDaysGap through to startVisit. Mocks all of auth,
 * prisma, and startVisit so we exercise the validation branch without
 * touching Postgres.
 */

const mockAuth = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

const orgUserFindUnique = vi.fn();
const patientFindFirst = vi.fn();
const caseManagementFindFirst = vi.fn();
const siteFindMany = vi.fn();
const orgUserSiteFindMany = vi.fn();
const txFn = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    orgUser: { findUnique: (...a: unknown[]) => orgUserFindUnique(...a) },
    patient: { findFirst: (...a: unknown[]) => patientFindFirst(...a) },
    caseManagement: { findFirst: (...a: unknown[]) => caseManagementFindFirst(...a) },
    site: { findMany: (...a: unknown[]) => siteFindMany(...a) },
    orgUserSite: { findMany: (...a: unknown[]) => orgUserSiteFindMany(...a) },
    $transaction: (cb: (tx: unknown) => unknown) => txFn(cb),
  },
}));

const startVisitMock = vi.fn();
vi.mock('@/lib/encounters/start', () => ({
  startVisit: (...a: unknown[]) => startVisitMock(...a),
}));

vi.mock('@/lib/audit/impersonation', () => ({
  assertNotImpersonating: vi.fn(async () => ({ ok: true })),
}));

// Seat gate: bypass — these tests predate Wave 7 billing and don't test
// seat enforcement. checkClinicianSeat always passes here.
vi.mock('@/lib/authz/seat', () => ({
  checkClinicianSeat: vi.fn(async () => ({ ok: true })),
  seatRequiredResponse: vi.fn(),
}));

// Visit-bank gate: bypass — capacity enforcement is covered in capacity-gate.test.ts.
vi.mock('@/lib/billing/capacity-gate', () => ({
  checkVisitCapacity: vi.fn(async () => ({ ok: true, available: 100 })),
  visitCapacityRequiredResponse: vi.fn(),
}));

import { POST } from '@/app/api/encounters/route';

function session() {
  return {
    user: {
      id: 'u1',
      email: 'u@x.com',
      orgId: 'org_1',
      orgUserId: 'ou_caller',
      role: 'CLINICIAN' as const,
      division: 'MEDICAL' as const,
      platformRole: 'NONE' as const,
      canManagePatients: false,
    },
  };
}

function primeMocksForSuccess() {
  mockAuth.mockResolvedValueOnce(session());
  orgUserFindUnique.mockResolvedValueOnce({
    id: 'ou_caller',
    orgId: 'org_1',
    role: 'CLINICIAN',
    division: 'MEDICAL',
    isActive: true,
    canManagePatients: false,  });
  patientFindFirst.mockResolvedValueOnce({ id: 'pat_1', siteId: 's_one' });
  caseManagementFindFirst.mockResolvedValueOnce({ id: 'case_1', status: 'ACTIVE' });
  orgUserFindUnique.mockResolvedValueOnce({ role: 'CLINICIAN', orgId: 'org_1' });
  orgUserSiteFindMany.mockResolvedValueOnce([{ siteId: 's_one' }]);
  txFn.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  startVisitMock.mockResolvedValueOnce({ encounter: { id: 'enc_1' }, note: { id: 'note_1' } });
}

function buildRequest(body: unknown) {
  return new Request('http://test.local/api/encounters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

beforeEach(() => {
  mockAuth.mockReset();
  orgUserFindUnique.mockReset();
  patientFindFirst.mockReset();
  caseManagementFindFirst.mockReset();
  siteFindMany.mockReset();
  orgUserSiteFindMany.mockReset();
  caseManagementFindFirst.mockReset();
  txFn.mockReset();
  startVisitMock.mockReset();
});

const baseBody = { patientId: 'pat_1', caseManagementId: 'case_1' };

describe('POST /api/encounters — late-entry validation', () => {
  it('without dateOfService → normal flow, late-entry args stay false/null', async () => {
    primeMocksForSuccess();

    const res = await POST(buildRequest(baseBody));
    expect(res.status).toBe(200);
    const callArgs = startVisitMock.mock.calls[0]?.[0] as {
      isLateEntry?: boolean;
      lateEntryDaysGap?: number | null;
      dateOfService?: Date | null;
    };
    expect(callArgs.isLateEntry).toBe(false);
    expect(callArgs.lateEntryDaysGap).toBeNull();
    expect(callArgs.dateOfService).toBeNull();
  });

  it('with today as dateOfService → isLateEntry=false (same-day visit is not a late entry)', async () => {
    primeMocksForSuccess();

    const res = await POST(buildRequest({ ...baseBody, dateOfService: isoDaysAgo(0) }));
    expect(res.status).toBe(200);
    const callArgs = startVisitMock.mock.calls[0]?.[0] as {
      isLateEntry?: boolean;
      lateEntryDaysGap?: number | null;
    };
    expect(callArgs.isLateEntry).toBe(false);
    expect(callArgs.lateEntryDaysGap).toBeNull();
  });

  it('with 14 days ago → isLateEntry=true, gap=14', async () => {
    primeMocksForSuccess();

    const res = await POST(
      buildRequest({ ...baseBody, dateOfService: isoDaysAgo(14) }),
    );
    expect(res.status).toBe(200);
    const callArgs = startVisitMock.mock.calls[0]?.[0] as {
      isLateEntry?: boolean;
      lateEntryDaysGap?: number | null;
    };
    expect(callArgs.isLateEntry).toBe(true);
    expect(callArgs.lateEntryDaysGap).toBe(14);
  });

  it('with 60 days ago → 400 date_of_service_too_old (startVisit never called)', async () => {
    primeMocksForSuccess();

    const res = await POST(
      buildRequest({ ...baseBody, dateOfService: isoDaysAgo(60) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('date_of_service_too_old');
    expect(startVisitMock).not.toHaveBeenCalled();
  });

  it('with future date → 400 date_of_service_future', async () => {
    primeMocksForSuccess();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const res = await POST(
      buildRequest({ ...baseBody, dateOfService: tomorrow.toISOString() }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('date_of_service_future');
    expect(startVisitMock).not.toHaveBeenCalled();
  });
});
