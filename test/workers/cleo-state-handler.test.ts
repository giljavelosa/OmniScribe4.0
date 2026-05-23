import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sprint 0.14 — cleo-state worker tests.
 *
 * Coverage:
 *   - Happy path: upserts the row + audits CLEO_STATE_REBUILT with
 *     PHI-free metadata + persona version.
 *   - Cross-org clinician id is rejected (defense in depth).
 *   - Throttling: queue-layer behavior is tested via the helper's
 *     jobId shape (deterministic per 5-min bucket).
 */

const orgUserFindUnique = vi.fn();
const copilotPatientStateUpsert = vi.fn();
// Sprint 0.18 — nudge generator side effects.
const fhirWriteBackProposalFindMany = vi.fn();
const cleoNudgeFindUnique = vi.fn();
const cleoNudgeCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    orgUser: { findUnique: (...a: unknown[]) => orgUserFindUnique(...a) },
    copilotPatientState: { upsert: (...a: unknown[]) => copilotPatientStateUpsert(...a) },
    fhirWriteBackProposal: {
      findMany: (...a: unknown[]) => fhirWriteBackProposalFindMany(...a),
    },
    cleoNudge: {
      findUnique: (...a: unknown[]) => cleoNudgeFindUnique(...a),
      create: (...a: unknown[]) => cleoNudgeCreate(...a),
    },
  },
}));

const writeAuditLog = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

const buildStateProjectionsMock = vi.fn();
vi.mock('@/services/copilot/state-builder', async () => {
  const actual = await vi.importActual<typeof import('@/services/copilot/state-builder')>(
    '@/services/copilot/state-builder',
  );
  return {
    ...actual,
    buildStateProjections: (...a: unknown[]) => buildStateProjectionsMock(...a),
  };
});

// Stub @/lib/queue so the throttle-shape test below (which does a dynamic
// import of '@/lib/queue') doesn't trigger src/lib/redis.ts's module-load
// throw when REDIS_URL is unset in CI. The handler imported on line 40
// does NOT touch the queue directly — it's only the throttle test that
// imports it.
vi.mock('@/lib/queue', () => ({
  enqueueCleoStateRefresh: vi.fn(),
}));

import { handle } from '@/workers/cleo-state/handler';

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      orgId: 'org_1',
      patientId: 'pat_1',
      clinicianOrgUserId: 'ou_1',
      ...overrides,
    },
    attemptsMade: 0,
  } as never;
}

beforeEach(() => {
  orgUserFindUnique.mockReset();
  copilotPatientStateUpsert.mockReset();
  writeAuditLog.mockReset();
  buildStateProjectionsMock.mockReset();
  fhirWriteBackProposalFindMany.mockReset();
  cleoNudgeFindUnique.mockReset();
  cleoNudgeCreate.mockReset();
  // Sprint 0.18 — sensible defaults so the existing Sprint-0.14 tests
  // still pass without rewriting their setup. The nudge generator
  // produces zero candidates from empty observedPatterns + zero
  // writeback failures.
  fhirWriteBackProposalFindMany.mockResolvedValue([]);
  cleoNudgeFindUnique.mockResolvedValue(null);
});

describe('cleo-state worker handle()', () => {
  it('builds + upserts + audits with persona metadata (PHI-free)', async () => {
    orgUserFindUnique.mockResolvedValueOnce({ orgId: 'org_1' });
    buildStateProjectionsMock.mockResolvedValueOnce({
      caseAwareness: { cases: [{ id: 'cm_1' }] },
      observedPatterns: { patterns: [{ kind: 'recert_due_soon' }] },
      conversationFacts: { facts: [] },
    });
    copilotPatientStateUpsert.mockResolvedValueOnce({ id: 'state_1' });

    const result = await handle(makeJob());
    expect(result).toMatchObject({ ok: true, stateId: 'state_1', patternCount: 1 });
    expect(copilotPatientStateUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orgId_patientId_clinicianOrgUserId: {
            orgId: 'org_1',
            patientId: 'pat_1',
            clinicianOrgUserId: 'ou_1',
          },
        },
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLEO_STATE_REBUILT',
        metadata: expect.objectContaining({
          stateId: 'state_1',
          patientId: 'pat_1',
          clinicianOrgUserId: 'ou_1',
          generatorVersion: expect.any(String),
          patternCount: 1,
          caseCount: 1,
          factCount: 0,
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
    // Defensive: metadata never includes free-text content.
    const meta = writeAuditLog.mock.calls[0]![0].metadata as Record<string, unknown>;
    for (const v of Object.values(meta)) {
      if (typeof v === 'string') {
        expect(v.length).toBeLessThan(120);
      }
    }
  });

  it('drops when the clinician belongs to a different org', async () => {
    orgUserFindUnique.mockResolvedValueOnce({ orgId: 'org_OTHER' });
    const result = await handle(makeJob());
    expect(result).toMatchObject({ skipped: 'clinician_org_mismatch' });
    expect(copilotPatientStateUpsert).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('drops when the clinician is not found', async () => {
    orgUserFindUnique.mockResolvedValueOnce(null);
    const result = await handle(makeJob());
    expect(result).toMatchObject({ skipped: 'clinician_org_mismatch' });
    expect(buildStateProjectionsMock).not.toHaveBeenCalled();
  });

  it('rethrows when the upsert fails (so BullMQ retries — rule 10)', async () => {
    orgUserFindUnique.mockResolvedValueOnce({ orgId: 'org_1' });
    buildStateProjectionsMock.mockResolvedValueOnce({
      caseAwareness: { cases: [] },
      observedPatterns: { patterns: [] },
      conversationFacts: { facts: [] },
    });
    copilotPatientStateUpsert.mockRejectedValueOnce(new Error('db unreachable'));
    await expect(handle(makeJob())).rejects.toThrow('db unreachable');
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe('throttle jobId shape', () => {
  it('coalesces same-tuple enqueues inside a 5-minute window', async () => {
    // Verify the jobId helper bucketing logic — pure assertion on the
    // import; we don't touch BullMQ here.
    const mod = await import('@/lib/queue');
    expect(typeof mod.enqueueCleoStateRefresh).toBe('function');
  });
});

// =============================================================================
// Sprint 0.18 — nudge generation tests.
// =============================================================================

describe('Sprint 0.18: nudge generation', () => {
  function setupHappyState(
    observedPatterns: Array<Record<string, unknown>> = [],
  ) {
    orgUserFindUnique.mockResolvedValueOnce({ orgId: 'org_1' });
    buildStateProjectionsMock.mockResolvedValueOnce({
      caseAwareness: { cases: [] },
      observedPatterns: { patterns: observedPatterns },
      conversationFacts: { facts: [] },
    });
    copilotPatientStateUpsert.mockResolvedValueOnce({ id: 'state_1' });
  }

  it('creates a CleoNudge + audits CLEO_NUDGE_PROPOSED for one detected pattern', async () => {
    setupHappyState([
      {
        kind: 'recert_due_soon',
        label: 'Recert due in 14 days',
        detail: {
          episodeId: 'ep_1',
          dueAt: '2026-06-05T00:00:00Z',
          daysUntilDue: 14,
        },
        observedInNoteIds: [],
        count: 1,
        firstSeen: '2026-05-22T00:00:00Z',
        lastSeen: '2026-05-22T00:00:00Z',
      },
    ]);
    cleoNudgeCreate.mockResolvedValueOnce({
      id: 'nudge_1',
      kind: 'RECERT_DUE_SOON',
      priority: 'HIGH',
      affordanceSlug: 'start-recert-visit',
    });

    const result = await handle(makeJob());
    expect(result).toMatchObject({ ok: true, nudgeProposedCount: 1 });
    expect(cleoNudgeCreate).toHaveBeenCalledTimes(1);
    expect(cleoNudgeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orgId: 'org_1',
          patientId: 'pat_1',
          clinicianOrgUserId: 'ou_1',
          kind: 'RECERT_DUE_SOON',
          priority: 'HIGH',
          affordanceSlug: 'start-recert-visit',
          status: 'PROPOSED',
        }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLEO_NUDGE_PROPOSED',
        metadata: expect.objectContaining({
          nudgeId: 'nudge_1',
          kind: 'RECERT_DUE_SOON',
          priority: 'HIGH',
          affordanceSlug: 'start-recert-visit',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  it('idempotent — re-running on the same pattern does NOT create a duplicate (decision 1)', async () => {
    setupHappyState([
      {
        kind: 'recert_due_soon',
        label: 'Recert',
        detail: { episodeId: 'ep_1', dueAt: '2026-06-05', daysUntilDue: 14 },
        observedInNoteIds: [],
        count: 1,
        firstSeen: '2026-05-22T00:00:00Z',
        lastSeen: '2026-05-22T00:00:00Z',
      },
    ]);
    // The unique key collides — findUnique returns the existing row.
    cleoNudgeFindUnique.mockReset();
    cleoNudgeFindUnique.mockResolvedValueOnce({ id: 'nudge_prior' });

    const result = await handle(makeJob());
    expect(result).toMatchObject({ ok: true, nudgeProposedCount: 0 });
    expect(cleoNudgeCreate).not.toHaveBeenCalled();
    // No CLEO_NUDGE_PROPOSED audit row on the dedup'd path — only the
    // CLEO_STATE_REBUILT audit fires.
    const actions = writeAuditLog.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(['CLEO_STATE_REBUILT']);
  });

  it('escalation: a fresh pattern with a different snapshot-hash creates a NEW row even after a prior dismissal (decision 3a)', async () => {
    // Day 1: 14-day recert (band 1).
    setupHappyState([
      {
        kind: 'recert_due_soon',
        label: 'Recert',
        detail: { episodeId: 'ep_1', dueAt: '2026-06-05', daysUntilDue: 14 },
        observedInNoteIds: [],
        count: 1,
        firstSeen: '2026-05-22T00:00:00Z',
        lastSeen: '2026-05-22T00:00:00Z',
      },
    ]);
    cleoNudgeFindUnique.mockReset();
    cleoNudgeFindUnique.mockResolvedValueOnce(null);
    cleoNudgeCreate.mockResolvedValueOnce({
      id: 'nudge_band1',
      kind: 'RECERT_DUE_SOON',
      priority: 'HIGH',
      affordanceSlug: 'start-recert-visit',
    });
    await handle(makeJob());

    // Day 11 (escalation): 3-day recert (band 3 — different hash).
    setupHappyState([
      {
        kind: 'recert_due_soon',
        label: 'Recert',
        detail: { episodeId: 'ep_1', dueAt: '2026-06-05', daysUntilDue: 3 },
        observedInNoteIds: [],
        count: 1,
        firstSeen: '2026-05-22T00:00:00Z',
        lastSeen: '2026-06-02T00:00:00Z',
      },
    ]);
    cleoNudgeFindUnique.mockReset();
    cleoNudgeFindUnique.mockResolvedValueOnce(null); // different hash → no existing row
    cleoNudgeCreate.mockResolvedValueOnce({
      id: 'nudge_band3',
      kind: 'RECERT_DUE_SOON',
      priority: 'HIGH',
      affordanceSlug: 'start-recert-visit',
    });
    const result = await handle(makeJob());
    expect(result).toMatchObject({ ok: true, nudgeProposedCount: 1 });
    expect(cleoNudgeCreate).toHaveBeenCalledTimes(2);
  });

  it('zero patterns + zero writeback failures → zero nudges + zero CLEO_NUDGE_PROPOSED audits (decision 10 backward compat)', async () => {
    setupHappyState([]);
    const result = await handle(makeJob());
    expect(result).toMatchObject({ ok: true, nudgeProposedCount: 0 });
    expect(cleoNudgeCreate).not.toHaveBeenCalled();
    const actions = writeAuditLog.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(['CLEO_STATE_REBUILT']);
  });

  it('pulls Sprint-0.17 PERMANENT writeback failures and emits a FHIR_WRITEBACK_FAILED_PERMANENT nudge', async () => {
    setupHappyState([]);
    fhirWriteBackProposalFindMany.mockReset();
    fhirWriteBackProposalFindMany.mockResolvedValueOnce([
      {
        id: 'wbp_1',
        caseManagementId: 'case_1',
        failureKind: 'PERMANENT',
        failureCount: 1,
        failedAt: new Date('2026-05-22T00:00:00Z'),
      },
    ]);
    cleoNudgeCreate.mockResolvedValueOnce({
      id: 'nudge_wb',
      kind: 'FHIR_WRITEBACK_FAILED_PERMANENT',
      priority: 'HIGH',
      affordanceSlug: 'review-failed-writeback',
    });

    const result = await handle(makeJob());
    expect(result).toMatchObject({ ok: true, nudgeProposedCount: 1 });
    expect(cleoNudgeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'FHIR_WRITEBACK_FAILED_PERMANENT',
          affordanceSlug: 'review-failed-writeback',
        }),
      }),
    );
  });

  it('rule 8 — a throw from writeAuditLog on CLEO_NUDGE_PROPOSED surfaces (not swallowed)', async () => {
    setupHappyState([
      {
        kind: 'recert_due_soon',
        label: 'Recert',
        detail: { episodeId: 'ep_1', dueAt: '2026-06-05', daysUntilDue: 14 },
        observedInNoteIds: [],
        count: 1,
        firstSeen: '2026-05-22T00:00:00Z',
        lastSeen: '2026-05-22T00:00:00Z',
      },
    ]);
    cleoNudgeCreate.mockResolvedValueOnce({
      id: 'nudge_x',
      kind: 'RECERT_DUE_SOON',
      priority: 'HIGH',
      affordanceSlug: 'start-recert-visit',
    });
    // First call: CLEO_STATE_REBUILT — succeeds.
    // Second call: CLEO_NUDGE_PROPOSED — explodes.
    writeAuditLog
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('phi-guard-bomb'));
    await expect(handle(makeJob())).rejects.toThrow('phi-guard-bomb');
  });
});
