import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * POST /api/notes/[id]/sign — flag-analysis race protection.
 *
 * Regression context
 * ------------------
 * Reported 2026-05-25: a clinician clicked "Analyze for flags" on /review
 * then immediately navigated to /sign and signed. The polling UI had
 * displayed "no new flags surfaced" while the worker was still running,
 * because the polling stopped at "count unchanged after 36 s". RED flags
 * arrived AFTER the note was signed — surfacing on an immutable artifact
 * (rule-3 violation: signed notes' compliance posture is whatever was
 * decided AT sign time).
 *
 * Two new sign-time blocks close the race:
 *   - 409 `flag_analysis_pending` if the analyzer started but hasn't
 *     stamped completedAt yet (within the stale window).
 *   - 409 `open_red_flags` if any RED ReviewFlag is OPEN. RESOLVED +
 *     DISMISSED don't block — the clinician already attested.
 *
 * Companion fix in the worker (test/workers/analyze-flags-handler.test.ts)
 * re-checks note.status before each section's write tx so flags can't be
 * inserted on a SIGNED note even if a sign sneaks past the gate.
 */

const noteFindFirst = vi.fn();
const noteUpdate = vi.fn();
const userFindUnique = vi.fn();
const followUpFindMany = vi.fn();
const encounterFindUnique = vi.fn();
const reviewFlagCount = vi.fn();
const txMock = vi.fn();

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

vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: vi.fn(async () => {}),
}));

vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn(async () => true) },
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
    draftJson: { s1: { content: 'A', updatedAt: '2026-05-25T00:00:00Z' } },
    template: { sectionSchema: { sections: [{ id: 's1', label: 'Section 1', required: true }] } },
    isLateEntry: false,
    lateEntryDaysGap: null,
    dateOfService: new Date('2026-05-25T00:00:00Z'),
    encounter: { caseManagement: { status: 'ACTIVE' } },
    flagAnalysisStartedAt: null,
    flagAnalysisCompletedAt: null,
    ...overrides,
  };
}

function buildRequest(body: Record<string, unknown> = { signPin: '1234' }) {
  return new Request('http://test.local/api/notes/note_1/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  noteFindFirst.mockReset();
  noteUpdate.mockReset();
  userFindUnique.mockReset();
  followUpFindMany.mockReset();
  encounterFindUnique.mockReset();
  reviewFlagCount.mockReset();
  txMock.mockReset();
  requireFeatureAccess.mockReset();

  requireFeatureAccess.mockResolvedValue(authedGuard());
  followUpFindMany.mockResolvedValue([]);
  userFindUnique.mockResolvedValue({
    signingPinHash: '$2a$12$hash',
    signUnlockedUntil: new Date(Date.now() + 5 * 60 * 1000),
  });
  txMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ note: { update: noteUpdate } }),
  );
  noteUpdate.mockResolvedValue({});
  encounterFindUnique.mockResolvedValue({ episodeOfCareId: null });
  reviewFlagCount.mockResolvedValue(0);
});

describe('POST /api/notes/[id]/sign — flag_analysis_pending', () => {
  it('returns 409 flag_analysis_pending when an analyze run is in flight', async () => {
    // Started 5 s ago, no completion yet → pending (within stale window).
    noteFindFirst.mockResolvedValueOnce(
      noteFixture({
        flagAnalysisStartedAt: new Date(Date.now() - 5_000),
        flagAnalysisCompletedAt: null,
      }),
    );

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('flag_analysis_pending');
    // The route must NOT have moved on to the RED-flag check or the tx.
    expect(reviewFlagCount).not.toHaveBeenCalled();
    expect(noteUpdate).not.toHaveBeenCalled();
  });

  it('proceeds when completedAt is after startedAt (analysis finished)', async () => {
    noteFindFirst.mockResolvedValueOnce(
      noteFixture({
        flagAnalysisStartedAt: new Date(Date.now() - 30_000),
        flagAnalysisCompletedAt: new Date(Date.now() - 5_000),
      }),
    );

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(200);
    expect(noteUpdate).toHaveBeenCalled();
  });

  it('proceeds when neither timestamp is set (analysis never run — opt-in)', async () => {
    // Pre-existing notes + new notes that never had Analyze clicked. The
    // gate is about an in-flight run, not about *requiring* a run.
    noteFindFirst.mockResolvedValueOnce(noteFixture());

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(200);
    expect(noteUpdate).toHaveBeenCalled();
  });

  it('proceeds when a stale pending is older than the 10-minute window (worker died)', async () => {
    // Defense against a permanently-stuck pending state: a crashed
    // worker leaves completedAt unset; the helper downgrades to
    // completed after 10 minutes so sign isn't blocked forever.
    noteFindFirst.mockResolvedValueOnce(
      noteFixture({
        flagAnalysisStartedAt: new Date(Date.now() - 11 * 60 * 1000),
        flagAnalysisCompletedAt: null,
      }),
    );

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(200);
    expect(noteUpdate).toHaveBeenCalled();
  });
});

describe('POST /api/notes/[id]/sign — open_red_flags', () => {
  it('returns 409 open_red_flags when a RED OPEN flag exists', async () => {
    noteFindFirst.mockResolvedValueOnce(
      noteFixture({
        flagAnalysisStartedAt: new Date(Date.now() - 30_000),
        flagAnalysisCompletedAt: new Date(Date.now() - 5_000),
      }),
    );
    reviewFlagCount.mockResolvedValueOnce(2);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('open_red_flags');
    expect(body.data.openRedCount).toBe(2);
    expect(noteUpdate).not.toHaveBeenCalled();
  });

  it('counts only severity=RED status=OPEN — RESOLVED + DISMISSED do not block', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture());
    // Mock returns 0; verify the where-clause used to compute it.
    reviewFlagCount.mockResolvedValueOnce(0);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(200);
    expect(reviewFlagCount).toHaveBeenCalledWith({
      where: { noteId: 'note_1', severity: 'RED', status: 'OPEN' },
    });
  });

  it('proceeds normally when zero RED flags are OPEN', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture());
    reviewFlagCount.mockResolvedValueOnce(0);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(200);
    expect(noteUpdate).toHaveBeenCalled();
  });
});

describe('POST /api/notes/[id]/sign — block ordering', () => {
  it('flag_analysis_pending is checked BEFORE open_red_flags (faster fail)', async () => {
    // Both conditions hold — pending should win because the count
    // shouldn't even be queried while analysis is still running. This
    // also avoids a window where a partial set of OPEN flags shows up
    // mid-run and we report the wrong number.
    noteFindFirst.mockResolvedValueOnce(
      noteFixture({
        flagAnalysisStartedAt: new Date(Date.now() - 5_000),
        flagAnalysisCompletedAt: null,
      }),
    );
    reviewFlagCount.mockResolvedValueOnce(99);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error.code).toBe('flag_analysis_pending');
    expect(reviewFlagCount).not.toHaveBeenCalled();
  });
});
