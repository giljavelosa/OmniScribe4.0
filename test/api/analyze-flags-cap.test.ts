import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * POST /api/notes/[id]/analyze-flags — Sprint 0 lockdown cap.
 *
 * Spec: context/specs/sprint-0-flag-analysis-lockdown.md (decision L-3).
 *
 * `Note.flagAnalysisRunCount` is capped at FLAG_ANALYSIS_RUN_CAP (=2).
 * The route refuses 409 `analysis_cap_reached` past the cap so the UI
 * can render the locked-state copy and the worker doesn't burn LLM
 * tokens defensively. A `FLAGS_ANALYSIS_CAP_REACHED` audit row is
 * written on every refused attempt so the auditor lens can measure
 * how often clinicians try to re-analyze past the cap.
 */

const noteFindFirst = vi.fn();
const noteUpdate = vi.fn();
const writeAuditLog = vi.fn();
const enqueueAiGenerationJob = vi.fn();
const requireFeatureAccess = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: {
      findFirst: (...a: unknown[]) => noteFindFirst(...a),
      update: (...a: unknown[]) => noteUpdate(...a),
    },
  },
}));

vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));

vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

vi.mock('@/lib/queue', () => ({
  enqueueAiGenerationJob: (...a: unknown[]) => enqueueAiGenerationJob(...a),
}));

vi.mock('@/lib/phi-access', () => ({
  assertOrgScoped: vi.fn(),
}));

import { POST } from '@/app/api/notes/[id]/analyze-flags/route';

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
    status: 'DRAFT',
    flagAnalysisRunCount: 0,
    ...overrides,
  };
}

function buildRequest() {
  return new Request('http://test.local/api/notes/note_1/analyze-flags', {
    method: 'POST',
  });
}

beforeEach(() => {
  noteFindFirst.mockReset();
  noteUpdate.mockReset();
  writeAuditLog.mockReset();
  enqueueAiGenerationJob.mockReset();
  requireFeatureAccess.mockReset();

  requireFeatureAccess.mockResolvedValue(authedGuard());
  noteUpdate.mockResolvedValue({});
  writeAuditLog.mockResolvedValue(undefined);
  enqueueAiGenerationJob.mockResolvedValue(undefined);
});

describe('POST /api/notes/[id]/analyze-flags — Sprint 0 cap', () => {
  it('accepts the request when runCount < cap', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture({ flagAnalysisRunCount: 1 }));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(202);

    expect(enqueueAiGenerationJob).toHaveBeenCalledTimes(1);
    // Lifecycle stamp + audit row both fire on the happy path.
    expect(noteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          flagAnalysisStartedAt: expect.any(Date),
          flagAnalysisCompletedAt: null,
        }),
      }),
    );
    const enqueued = writeAuditLog.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'FLAGS_ANALYZER_ENQUEUED',
    );
    expect(enqueued).toBeDefined();
  });

  it('refuses 409 analysis_cap_reached when runCount === cap', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture({ flagAnalysisRunCount: 2 }));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error.code).toBe('analysis_cap_reached');
    expect(body.data.runCount).toBe(2);
    expect(body.data.cap).toBe(2);

    // Worker NOT enqueued.
    expect(enqueueAiGenerationJob).not.toHaveBeenCalled();
    // Lifecycle stamps not touched (no false "started" row).
    expect(noteUpdate).not.toHaveBeenCalled();
    // Cap-reached audit row fires.
    const capRow = writeAuditLog.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'FLAGS_ANALYSIS_CAP_REACHED',
    );
    expect(capRow).toBeDefined();
    expect(
      (capRow![0] as { metadata: Record<string, unknown> }).metadata.runCount,
    ).toBe(2);
  });

  it('refuses 409 not_reviewable when note is SIGNED (existing gate preserved)', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture({ status: 'SIGNED' }));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error.code).toBe('not_reviewable');
    expect(enqueueAiGenerationJob).not.toHaveBeenCalled();
  });

  it('returns 404 when the note does not exist', async () => {
    noteFindFirst.mockResolvedValueOnce(null);

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_missing' }) });
    expect(res.status).toBe(404);
  });
});
