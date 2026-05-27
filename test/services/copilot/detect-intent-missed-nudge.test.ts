/**
 * Unit 48 PR5 — detect-intent-missed-nudge detector tests.
 *
 * Coverage:
 *   - Exits silently when encounter.intent !== UNSPECIFIED
 *   - Skips when proposer would return UNSPECIFIED
 *   - Skips when proposer returns low confidence
 *   - Skips when proposed pair isn't in SUPPORTED_INTENT_PAIRS
 *   - Skips (idempotent) when a CleoNudge already exists for this
 *     encounter
 *   - Upserts a CleoNudge with the correct kind / priority / surface
 *     / snapshot hash / snapshot json when all conditions met
 *
 * Mocks Prisma + writeAuditLog. The proposer itself is real (pure
 * deterministic function from PR1) so we don't have to re-mock its
 * branches.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EncounterIntent } from '@prisma/client';

// =============================================================================
// Mocks — Prisma + audit. Defined BEFORE the import of the SUT.
// =============================================================================

const cleoNudgeFindUnique = vi.fn();
const cleoNudgeCreate = vi.fn();
const episodeFindFirst = vi.fn();
const scheduleFindFirst = vi.fn();
const noteFindMany = vi.fn();
const patientFindFirst = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    cleoNudge: {
      findUnique: (...a: unknown[]) => cleoNudgeFindUnique(...a),
      create: (...a: unknown[]) => cleoNudgeCreate(...a),
    },
    episodeOfCare: {
      findFirst: (...a: unknown[]) => episodeFindFirst(...a),
    },
    schedule: {
      findFirst: (...a: unknown[]) => scheduleFindFirst(...a),
    },
    note: {
      findMany: (...a: unknown[]) => noteFindMany(...a),
    },
    patient: {
      findFirst: (...a: unknown[]) => patientFindFirst(...a),
    },
  },
}));

const writeAuditLog = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

// Sibling mocks the detector depends on transitively. Persona module
// has a side effect on import (validates env). Stub to a constant.
vi.mock('@/services/copilot/persona', () => ({
  PERSONA_VERSION: 'miss-cleo-v1',
}));

// Import AFTER the mocks above.
import { detectIntentMissedNudge } from '@/services/copilot/detect-intent-missed-nudge';

// =============================================================================
// Helpers.
// =============================================================================

const NOW = new Date('2026-05-26T12:00:00Z');
const MS_PER_DAY = 86_400_000;
function daysAgo(d: number) {
  return new Date(NOW.getTime() - d * MS_PER_DAY);
}

function baseArgs(over: Partial<Parameters<typeof detectIntentMissedNudge>[0]> = {}) {
  return {
    orgId: 'org_1',
    patientId: 'pt_1',
    clinicianOrgUserId: 'ou_1',
    division: 'REHAB' as const,
    encounterId: 'enc_1',
    currentIntent: EncounterIntent.UNSPECIFIED,
    noteId: 'nt_curr',
    scheduleId: null,
    episodeId: 'ep_1',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  // Default-happy projections — tests override per-case.
  episodeFindFirst.mockResolvedValue({
    id: 'ep_1',
    status: 'ACTIVE',
    visitsCompleted: 10,
    startedAt: daysAgo(45),
    recertDueAt: null,
  });
  scheduleFindFirst.mockResolvedValue(null);
  // Build a prior-note stream that triggers REHAB_PROGRESS_NOTE
  // (>=10 visits since last progress note OR >=30 days):
  noteFindMany.mockResolvedValue([
    {
      signedAt: daysAgo(35),
      encounter: { intent: EncounterIntent.REHAB_INITIAL_EVAL },
    },
    ...Array.from({ length: 10 }, (_, i) => ({
      signedAt: daysAgo(30 - i * 2),
      encounter: { intent: EncounterIntent.REHAB_DAILY_NOTE },
    })),
  ]);
  patientFindFirst.mockResolvedValue({ dob: daysAgo(365 * 50) });
  cleoNudgeFindUnique.mockResolvedValue(null);
  cleoNudgeCreate.mockResolvedValue({ id: 'nudge_1' });
});

// =============================================================================
// Tests.
// =============================================================================

describe('detectIntentMissedNudge — exits + skips', () => {
  it('exits silently when currentIntent !== UNSPECIFIED', async () => {
    await detectIntentMissedNudge(
      baseArgs({ currentIntent: EncounterIntent.REHAB_DAILY_NOTE }),
    );
    expect(cleoNudgeCreate).not.toHaveBeenCalled();
    expect(episodeFindFirst).not.toHaveBeenCalled();
  });

  it('skips when no prior signed notes (proposer → REHAB_INITIAL_EVAL, NOT in supported pairs)', async () => {
    noteFindMany.mockResolvedValue([]);
    await detectIntentMissedNudge(baseArgs());
    expect(cleoNudgeCreate).not.toHaveBeenCalled();
  });

  it('skips when MULTI division (proposer → UNSPECIFIED + low)', async () => {
    await detectIntentMissedNudge(baseArgs({ division: 'MULTI' }));
    expect(cleoNudgeCreate).not.toHaveBeenCalled();
  });

  it('skips when an INTENT_PROPOSAL_MISSED row already exists for this encounter (idempotent)', async () => {
    cleoNudgeFindUnique.mockResolvedValue({ id: 'existing_nudge' });
    await detectIntentMissedNudge(baseArgs());
    expect(cleoNudgeCreate).not.toHaveBeenCalled();
  });

  it("doesn't throw on internal error — failure-tolerant", async () => {
    episodeFindFirst.mockRejectedValue(new Error('DB hiccup'));
    // Must not throw — the prepare page render must continue.
    await expect(detectIntentMissedNudge(baseArgs())).resolves.toBeUndefined();
    expect(cleoNudgeCreate).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Upsert path — the happy case.
// =============================================================================

describe('detectIntentMissedNudge — creates nudge', () => {
  it('upserts a CleoNudge with the correct kind / priority / surface', async () => {
    await detectIntentMissedNudge(baseArgs());
    expect(cleoNudgeCreate).toHaveBeenCalledTimes(1);
    const call = cleoNudgeCreate.mock.calls[0]![0];
    expect(call.data.kind).toBe('INTENT_PROPOSAL_MISSED');
    expect(call.data.priority).toBe('MEDIUM');
    expect(call.data.eligibleSurfaces).toBe('VISIT_PREPARE');
    expect(call.data.affordanceSlug).toBe('apply-intent-proposal');
    expect(call.data.status).toBe('PROPOSED');
  });

  it('hash includes the encounterId + proposedIntent for per-encounter idempotency', async () => {
    await detectIntentMissedNudge(baseArgs());
    const call = cleoNudgeCreate.mock.calls[0]![0];
    expect(call.data.sourcePatternSnapshotHash).toBe(
      `intent-missed:enc_1:${EncounterIntent.REHAB_PROGRESS_NOTE}`,
    );
  });

  it('snapshot json carries the projected intent + reason + division', async () => {
    await detectIntentMissedNudge(baseArgs());
    const call = cleoNudgeCreate.mock.calls[0]![0];
    const snap = call.data.sourcePatternSnapshotJson;
    expect(snap.encounterId).toBe('enc_1');
    expect(snap.noteId).toBe('nt_curr');
    expect(snap.proposedIntent).toBe(EncounterIntent.REHAB_PROGRESS_NOTE);
    expect(snap.division).toBe('REHAB');
    expect(snap.confidence).toMatch(/high|medium/);
    expect(typeof snap.reason).toBe('string');
    expect(snap.proposedIntentLabel).toBe('Progress Note');
  });

  it('emits a CLEO_NUDGE_PROPOSED audit on create', async () => {
    await detectIntentMissedNudge(baseArgs());
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    const audit = writeAuditLog.mock.calls[0]![0];
    expect(audit.action).toBe('CLEO_NUDGE_PROPOSED');
    expect(audit.resourceType).toBe('CleoNudge');
    expect(audit.metadata.kind).toBe('INTENT_PROPOSAL_MISSED');
    expect(audit.metadata.proposedIntent).toBe(EncounterIntent.REHAB_PROGRESS_NOTE);
    expect(audit.metadata.encounterId).toBe('enc_1');
    expect(audit.metadata.personaVersion).toBe('miss-cleo-v1');
  });
});
