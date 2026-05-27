import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * POST /api/notes/[id]/sign — Sprint 0.13 Decision 3 hard sign-block.
 *
 * The route refuses with 409 `pending_router` when the note's encounter
 * is still bound to a CaseManagement in PENDING_ROUTER status. This
 * makes the soft nudge in review-client.tsx an enforced invariant —
 * notes can no longer be signed while routing is unresolved.
 *
 * Companion mitigations for the historical backlog of pre-block stuck
 * signed notes:
 *   - /api/admin/case-management/backfill-stuck-router (sweep)
 *   - /api/notes/[id]/case-router/accept (narrow rescue path —
 *     accepts signed notes whose case is still PENDING_ROUTER)
 */

const noteFindFirst = vi.fn();
const noteUpdate = vi.fn();
const userFindUnique = vi.fn();
const followUpFindMany = vi.fn();
const encounterFindUnique = vi.fn();
const txMock = vi.fn();

const reviewFlagCount = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: {
      findFirst: (...a: unknown[]) => noteFindFirst(...a),
      update: (...a: unknown[]) => noteUpdate(...a),
    },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    followUp: { findMany: (...a: unknown[]) => followUpFindMany(...a) },
    encounter: { findUnique: (...a: unknown[]) => encounterFindUnique(...a) },
    episodeOfCare: { update: vi.fn() },
    copilotPatientState: { findMany: vi.fn().mockResolvedValue([]) },
    reviewFlag: { count: (...a: unknown[]) => reviewFlagCount(...a) },
    $transaction: (cb: (tx: unknown) => unknown) =>
      txMock(cb) ?? cb({ note: { update: (...a: unknown[]) => noteUpdate(...a) } }),
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

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(async () => true),
  },
}));

vi.mock('@/lib/queue', () => ({
  enqueueNoteBriefJob: vi.fn(async () => {}),
  enqueuePostSignArtifactJob: vi.fn(async () => {}),
  enqueueCleoStateRefresh: vi.fn(async () => {}),
}));

vi.mock('@/lib/notes/section-status', () => ({
  readSectionStatus: () => ({ s1: { status: 'edited' } }),
}));

vi.mock('@/lib/notes/derive-progress-strip', () => ({
  deriveProgressStrip: () => [{ sectionId: 's1', state: 'ready', required: true }],
  isReadyForSign: () => true,
}));

import { POST } from '@/app/api/notes/[id]/sign/route';

function authedGuard() {
  return {
    user: { id: 'user_1' },
    orgUser: { orgId: 'org_1' },
    authorizationUser: {
      userId: 'user_1',
      orgUserId: 'ou_caller',
      orgId: 'org_1',
      role: 'CLINICIAN',
      division: 'MEDICAL',
      canManagePatients: false,
    },
  };
}

function noteFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'note_1',
    orgId: 'org_1',
    patientId: 'pat_1',
    encounterId: 'enc_1',
    clinicianOrgUserId: 'ou_caller',
    status: 'DRAFT',
    draftJson: { s1: { content: 'A', updatedAt: '2026-05-23T00:00:00Z' } },
    template: { sectionSchema: { sections: [{ id: 's1', label: 'Section 1', required: true }] } },
    isLateEntry: false,
    lateEntryDaysGap: null,
    dateOfService: new Date('2026-05-23T00:00:00Z'),
    encounter: { caseManagement: { status: 'ACTIVE' } },
    flagAnalysisStartedAt: null,
    flagAnalysisCompletedAt: null,
    ...overrides,
  };
}

function buildRequest() {
  return new Request('http://test.local/api/notes/note_1/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signPin: '1234' }),
  });
}

beforeEach(() => {
  noteFindFirst.mockReset();
  noteUpdate.mockReset();
  userFindUnique.mockReset();
  followUpFindMany.mockReset();
  encounterFindUnique.mockReset();
  txMock.mockReset();
  requireFeatureAccess.mockReset();
  writeAuditLog.mockReset();

  requireFeatureAccess.mockResolvedValue(authedGuard());
  followUpFindMany.mockResolvedValue([]);
  userFindUnique.mockResolvedValue({
    signingPinHash: '$2a$12$hash',
    signUnlockedUntil: null,
  });
  txMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ note: { update: noteUpdate } }),
  );
  noteUpdate.mockResolvedValue({});
  encounterFindUnique.mockResolvedValue({ episodeOfCareId: null });
  reviewFlagCount.mockResolvedValue(0);
});

describe('POST /api/notes/[id]/sign — PENDING_ROUTER hard block', () => {
  it('returns 409 pending_router when the case is still PENDING_ROUTER', async () => {
    noteFindFirst.mockResolvedValueOnce(
      noteFixture({ encounter: { caseManagement: { status: 'PENDING_ROUTER' } } }),
    );

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('pending_router');
    expect(noteUpdate).not.toHaveBeenCalled();
  });

  it('signs normally when the case is ACTIVE', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture());

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(200);
    expect(noteUpdate).toHaveBeenCalled();
  });
});
