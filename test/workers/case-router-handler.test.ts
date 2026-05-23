import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * Sprint 0.13 — case-router worker tests.
 *
 * Coverage targets:
 *   - The handler writes a CaseRouterRun row with the proposal JSON +
 *     persona-versioned audit metadata.
 *   - Notes that have already been signed are skipped (routing is locked
 *     at sign time; the panel hides; the worker no-ops).
 *   - Stub-mode produces a synthetic LOW-confidence run so the panel
 *     still renders (rule 9 in the spec).
 */

const noteFindFirst = vi.fn();
const orgUserFindUnique = vi.fn();
const caseManagementFindMany = vi.fn();
const caseRouterRunUpsert = vi.fn();
const copilotPatientStateFindUnique = vi.fn();
const orgEhrConnectionCount = vi.fn();
const patientFhirIdentityFindFirst = vi.fn();
const fhirCachedResourceFindMany = vi.fn();
const writeAuditLog = vi.fn();
const proposeMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: { findFirst: (...a: unknown[]) => noteFindFirst(...a) },
    orgUser: { findUnique: (...a: unknown[]) => orgUserFindUnique(...a) },
    caseManagement: { findMany: (...a: unknown[]) => caseManagementFindMany(...a) },
    caseRouterRun: { upsert: (...a: unknown[]) => caseRouterRunUpsert(...a) },
    // Sprint 0.14 — the case-router handler reads CopilotPatientState to
    // optionally enrich the agent's system prompt with a "Prior cross-
    // visit context" block. Tests default to "no state" → backward
    // compatible Sprint-0.13 behavior.
    copilotPatientState: {
      findUnique: (...a: unknown[]) => copilotPatientStateFindUnique(...a),
    },
    // Sprint 0.15 — FHIR-routing gate (org-level) + FHIR fetcher inputs
    // (patient-level + cache). Tests default to "FHIR disabled" so
    // existing Sprint-0.13 / 0.14 expectations stay byte-identical.
    orgEhrConnection: {
      count: (...a: unknown[]) => orgEhrConnectionCount(...a),
    },
    patientFhirIdentity: {
      findFirst: (...a: unknown[]) => patientFhirIdentityFindFirst(...a),
    },
    fhirCachedResource: {
      findMany: (...a: unknown[]) => fhirCachedResourceFindMany(...a),
    },
  },
}));

vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

vi.mock('@/services/copilot/case-router', async () => {
  const actual = await vi.importActual<typeof import('@/services/copilot/case-router')>(
    '@/services/copilot/case-router',
  );
  class MockCaseRouterService {
    async propose(...a: unknown[]) {
      return proposeMock(...a);
    }
  }
  return {
    ...actual,
    CaseRouterService: MockCaseRouterService,
  };
});

vi.mock('@/lib/professions', () => ({
  divisionForProfession: () => 'MEDICAL',
}));

import { handle } from '@/workers/case-router/handler';

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    data: { noteId: 'note_1', orgId: 'org_1', ...overrides },
    attemptsMade: 0,
  } as never;
}

beforeEach(() => {
  noteFindFirst.mockReset();
  orgUserFindUnique.mockReset();
  caseManagementFindMany.mockReset();
  caseRouterRunUpsert.mockReset();
  copilotPatientStateFindUnique.mockReset();
  orgEhrConnectionCount.mockReset();
  patientFhirIdentityFindFirst.mockReset();
  fhirCachedResourceFindMany.mockReset();
  writeAuditLog.mockReset();
  proposeMock.mockReset();
  // Sprint 0.14 default: no state row → backward-compatible Sprint-0.13
  // behavior. Tests that exercise the priorCrossVisitContext block can
  // override per-test.
  copilotPatientStateFindUnique.mockResolvedValue(null);
  // Sprint 0.15 default: FHIR disabled at the org gate → no FHIR
  // fetcher call, no FHIR audits. Backward-compatible posture (decision
  // 10). Tests that exercise the FHIR path override per-test.
  orgEhrConnectionCount.mockResolvedValue(0);
  patientFhirIdentityFindFirst.mockResolvedValue(null);
  fhirCachedResourceFindMany.mockResolvedValue([]);
});

describe('case-router worker handler', () => {
  it('writes a CaseRouterRun + audits CASE_ROUTER_PROPOSED with persona metadata', async () => {
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_1',
      orgId: 'org_1',
      patientId: 'pat_1',
      status: 'DRAFT',
      division: 'MEDICAL',
      draftJson: {
        assessment: { content: 'Right-shoulder impingement.' },
        plan: { content: 'PT 6 weeks.' },
      },
      finalJson: null,
      patient: { id: 'pat_1' },
      encounter: {
        id: 'enc_1',
        caseManagementId: 'case_pending',
        clinicianOrgUserId: 'ou_1',
      },
    });
    orgUserFindUnique.mockResolvedValueOnce({
      professionType: 'MD',
      division: 'MEDICAL',
    });
    caseManagementFindMany.mockResolvedValueOnce([]);
    proposeMock.mockResolvedValueOnce({
      proposal: {
        action: 'open-new',
        newCase: { primaryIcd: 'M25.51', primaryIcdLabel: 'Right shoulder pain' },
        confidence: 'high',
        reasoning: 'Visit is about a new shoulder problem.',
        alternatives: [],
      },
      modelVersion: 'sonnet',
      modelId: 'us.anthropic.claude-sonnet-4-5',
      stub: false,
    });
    caseRouterRunUpsert.mockResolvedValueOnce({ id: 'run_1' });

    const result = await handle(makeJob());
    expect(result).toMatchObject({ ok: true, caseRouterRunId: 'run_1' });
    expect(caseRouterRunUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { noteId: 'note_1' },
        create: expect.objectContaining({
          orgId: 'org_1',
          noteId: 'note_1',
          confidence: 'HIGH',
          modelVersion: 'sonnet',
        }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_ROUTER_PROPOSED',
        metadata: expect.objectContaining({
          caseRouterRunId: 'run_1',
          confidence: 'high',
          modelVersion: 'sonnet',
          action: 'open-new',
          alternativesCount: 0,
          stub: false,
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  it('skips when the note is already SIGNED', async () => {
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_signed',
      orgId: 'org_1',
      patientId: 'pat_1',
      status: 'SIGNED',
      division: 'MEDICAL',
      draftJson: null,
      finalJson: { sections: [] },
      patient: { id: 'pat_1' },
      encounter: { id: 'enc_1', caseManagementId: 'case_x', clinicianOrgUserId: 'ou_1' },
    });

    const result = await handle(makeJob({ noteId: 'note_signed' }));
    expect(result).toMatchObject({ skipped: 'note_signed' });
    expect(proposeMock).not.toHaveBeenCalled();
    expect(caseRouterRunUpsert).not.toHaveBeenCalled();
  });

  it('drops gracefully when the note disappears', async () => {
    noteFindFirst.mockResolvedValueOnce(null);
    const result = await handle(makeJob({ noteId: 'note_gone' }));
    expect(result).toMatchObject({ skipped: 'not_found' });
  });

  it('persists a stub fallback so the review panel still renders end-to-end', async () => {
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_stub',
      orgId: 'org_1',
      patientId: 'pat_1',
      status: 'DRAFT',
      division: 'MEDICAL',
      draftJson: null,
      finalJson: null,
      patient: { id: 'pat_1' },
      encounter: { id: 'enc_1', caseManagementId: 'case_pending', clinicianOrgUserId: 'ou_1' },
    });
    orgUserFindUnique.mockResolvedValueOnce({
      professionType: 'MD',
      division: 'MEDICAL',
    });
    caseManagementFindMany.mockResolvedValueOnce([]);
    proposeMock.mockResolvedValueOnce({
      proposal: {
        action: 'open-new',
        newCase: { primaryIcd: null, primaryIcdLabel: 'Routing in progress' },
        confidence: 'low',
        reasoning: 'Auto-route unavailable in stub mode — pick manually.',
        alternatives: [],
      },
      modelVersion: 'stub',
      modelId: 'stub',
      stub: true,
    });
    caseRouterRunUpsert.mockResolvedValueOnce({ id: 'run_stub' });

    const result = await handle(makeJob({ noteId: 'note_stub' }));
    expect(result).toMatchObject({ ok: true, confidence: 'low' });
    expect(caseRouterRunUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          confidence: 'LOW',
          modelVersion: 'stub',
        }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          stub: true,
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });

  // ===========================================================================
  // Sprint 0.15 — FHIR-citation paths.
  // ===========================================================================

  it('Sprint 0.15: FHIR-disabled org sees byte-identical Sprint-0.14 behavior (no FHIR audit, no fetcher calls)', async () => {
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_no_fhir',
      orgId: 'org_1',
      patientId: 'pat_1',
      status: 'DRAFT',
      division: 'MEDICAL',
      draftJson: null,
      finalJson: null,
      patient: { id: 'pat_1' },
      encounter: { id: 'enc_1', caseManagementId: 'case_pending', clinicianOrgUserId: 'ou_1' },
    });
    orgUserFindUnique.mockResolvedValueOnce({ professionType: 'MD', division: 'MEDICAL' });
    caseManagementFindMany.mockResolvedValueOnce([]);
    proposeMock.mockResolvedValueOnce({
      proposal: {
        action: 'open-new',
        newCase: { primaryIcd: null, primaryIcdLabel: 'Routing in progress' },
        confidence: 'low',
        reasoning: 'unclear',
        alternatives: [],
      },
      modelVersion: 'sonnet',
      modelId: 'sonnet',
      stub: false,
    });
    caseRouterRunUpsert.mockResolvedValueOnce({ id: 'run_no_fhir' });

    // Org gate returns false → fetcher should never be called.
    orgEhrConnectionCount.mockResolvedValueOnce(0);

    await handle(makeJob({ noteId: 'note_no_fhir' }));

    expect(patientFhirIdentityFindFirst).not.toHaveBeenCalled();
    expect(fhirCachedResourceFindMany).not.toHaveBeenCalled();
    // No CASE_ROUTER_FHIR_CITED / _UNAVAILABLE audit when FHIR is off.
    expect(writeAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CASE_ROUTER_FHIR_CITED' }),
    );
    expect(writeAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CASE_ROUTER_FHIR_UNAVAILABLE' }),
    );
    // The CASE_ROUTER_PROPOSED row records "no FHIR offered" — auditor lens.
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_ROUTER_PROPOSED',
        metadata: expect.objectContaining({
          fhirConditionInputCount: 0,
        }),
      }),
    );
  });

  it('Sprint 0.15: emits CASE_ROUTER_FHIR_CITED when fetcher returns Conditions + proposal carries citations', async () => {
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_fhir',
      orgId: 'org_1',
      patientId: 'pat_fhir',
      status: 'DRAFT',
      division: 'MEDICAL',
      draftJson: null,
      finalJson: null,
      patient: { id: 'pat_fhir' },
      encounter: { id: 'enc_fhir', caseManagementId: 'case_pending', clinicianOrgUserId: 'ou_1' },
    });
    orgUserFindUnique.mockResolvedValueOnce({ professionType: 'MD', division: 'MEDICAL' });
    caseManagementFindMany.mockResolvedValueOnce([]);

    // FHIR enabled at the org + verified patient link + one fresh active
    // Condition in cache.
    orgEhrConnectionCount.mockResolvedValueOnce(1);
    patientFhirIdentityFindFirst.mockResolvedValueOnce({
      id: 'pfi_1',
      fhirPatientId: 'fhir-pat-1',
    });
    fhirCachedResourceFindMany.mockResolvedValueOnce([
      {
        fhirResourceId: 'cond_m5481',
        resource: {
          raw: {
            resourceType: 'Condition',
            id: 'cond_m5481',
            meta: { lastUpdated: '2024-08-15T12:00:00Z' },
            recorder: { display: 'Dr. Patel' },
          },
          simplified: {
            code: 'M54.81',
            display: 'Cervicogenic headache',
            clinicalStatus: 'active',
            onsetDate: '2024-08-15',
            recordedDate: '2024-08-15',
          },
        },
        fetchedAt: new Date(),
      },
    ]);

    proposeMock.mockResolvedValueOnce({
      proposal: {
        action: 'open-new-from-condition',
        newCaseFromCondition: {
          fhirConditionId: 'cond_m5481',
          primaryIcd: 'M54.81',
          primaryIcdLabel: 'Cervicogenic headache',
          recordedDate: '2024-08-15',
          recorderName: 'Dr. Patel',
        },
        confidence: 'high',
        reasoning: 'EHR shows Dr. Patel recorded M54.81 on 2024-08-15.',
        alternatives: [],
      },
      modelVersion: 'sonnet',
      modelId: 'sonnet',
      stub: false,
    });
    caseRouterRunUpsert.mockResolvedValueOnce({ id: 'run_fhir' });

    await handle(makeJob({ noteId: 'note_fhir' }));

    // FHIR-cited audit fires with PHI-free metadata + persona version.
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_ROUTER_FHIR_CITED',
        metadata: expect.objectContaining({
          caseRouterRunId: 'run_fhir',
          citationCount: 1,
          fhirIds: ['cond_m5481'],
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
    // The proposalJson stored in CaseRouterRun carries fhirCitations.
    expect(caseRouterRunUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          proposalJson: expect.objectContaining({
            action: 'open-new-from-condition',
            fhirCitations: expect.arrayContaining([
              expect.objectContaining({
                resourceType: 'Condition',
                fhirId: 'cond_m5481',
                recorder: 'Dr. Patel',
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it('Sprint 0.15: emits CASE_ROUTER_FHIR_UNAVAILABLE on cache failure + still ships the proposal (rule 10 reserved)', async () => {
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_degraded',
      orgId: 'org_1',
      patientId: 'pat_degraded',
      status: 'DRAFT',
      division: 'MEDICAL',
      draftJson: null,
      finalJson: null,
      patient: { id: 'pat_degraded' },
      encounter: { id: 'enc_d', caseManagementId: 'case_pending', clinicianOrgUserId: 'ou_1' },
    });
    orgUserFindUnique.mockResolvedValueOnce({ professionType: 'MD', division: 'MEDICAL' });
    caseManagementFindMany.mockResolvedValueOnce([]);

    // FHIR enabled at org, link verified, but the cache read throws.
    orgEhrConnectionCount.mockResolvedValueOnce(1);
    patientFhirIdentityFindFirst.mockResolvedValueOnce({
      id: 'pfi_1',
      fhirPatientId: 'fhir-pat-1',
    });
    fhirCachedResourceFindMany.mockRejectedValueOnce(new Error('cache exploded'));

    // Agent still ships a native proposal — graceful degradation.
    proposeMock.mockResolvedValueOnce({
      proposal: {
        action: 'open-new',
        newCase: { primaryIcd: null, primaryIcdLabel: 'Routing in progress' },
        confidence: 'low',
        reasoning: 'unclear',
        alternatives: [],
      },
      modelVersion: 'sonnet',
      modelId: 'sonnet',
      stub: false,
    });
    caseRouterRunUpsert.mockResolvedValueOnce({ id: 'run_d' });

    const result = await handle(makeJob({ noteId: 'note_degraded' }));

    // Routing decision still ships.
    expect(result).toMatchObject({ ok: true, caseRouterRunId: 'run_d' });
    // CASE_ROUTER_FHIR_UNAVAILABLE fires with the structured error kind.
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_ROUTER_FHIR_UNAVAILABLE',
        metadata: expect.objectContaining({
          caseRouterRunId: 'run_d',
          patientId: 'pat_degraded',
          errorKind: 'cache_error',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
    // CASE_ROUTER_FHIR_CITED does NOT fire — no citations in this run.
    expect(writeAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CASE_ROUTER_FHIR_CITED' }),
    );
  });

  it('Sprint 0.15: non-FHIR-linked patient on a FHIR-enabled org → no audit, byte-identical behavior', async () => {
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_not_linked',
      orgId: 'org_1',
      patientId: 'pat_not_linked',
      status: 'DRAFT',
      division: 'MEDICAL',
      draftJson: null,
      finalJson: null,
      patient: { id: 'pat_not_linked' },
      encounter: { id: 'enc_n', caseManagementId: 'case_pending', clinicianOrgUserId: 'ou_1' },
    });
    orgUserFindUnique.mockResolvedValueOnce({ professionType: 'MD', division: 'MEDICAL' });
    caseManagementFindMany.mockResolvedValueOnce([]);

    // FHIR enabled at org, but THIS patient has no verified link → the
    // fetcher returns `{ ok: false, errorKind: 'not_linked' }`. Per
    // decision 10 we suppress the unavailable audit in that case.
    orgEhrConnectionCount.mockResolvedValueOnce(1);
    patientFhirIdentityFindFirst.mockResolvedValueOnce(null);

    proposeMock.mockResolvedValueOnce({
      proposal: {
        action: 'open-new',
        newCase: { primaryIcd: null, primaryIcdLabel: 'Routing in progress' },
        confidence: 'low',
        reasoning: 'unclear',
        alternatives: [],
      },
      modelVersion: 'sonnet',
      modelId: 'sonnet',
      stub: false,
    });
    caseRouterRunUpsert.mockResolvedValueOnce({ id: 'run_n' });

    await handle(makeJob({ noteId: 'note_not_linked' }));

    // Neither FHIR audit fires — non-linked patient is the baseline,
    // not a degraded state.
    expect(writeAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CASE_ROUTER_FHIR_UNAVAILABLE' }),
    );
    expect(writeAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CASE_ROUTER_FHIR_CITED' }),
    );
    // The fetcher WAS called (org gate passed) but the patient query
    // returned null and we stopped there.
    expect(patientFhirIdentityFindFirst).toHaveBeenCalled();
    expect(fhirCachedResourceFindMany).not.toHaveBeenCalled();
  });

  it('rethrows on agent failure so BullMQ retries (rule 10), with a PHI-free audit row', async () => {
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_err',
      orgId: 'org_1',
      patientId: 'pat_1',
      status: 'DRAFT',
      division: 'MEDICAL',
      draftJson: null,
      finalJson: null,
      patient: { id: 'pat_1' },
      encounter: { id: 'enc_1', caseManagementId: 'case_pending', clinicianOrgUserId: 'ou_1' },
    });
    orgUserFindUnique.mockResolvedValueOnce({
      professionType: 'MD',
      division: 'MEDICAL',
    });
    caseManagementFindMany.mockResolvedValueOnce([]);
    proposeMock.mockRejectedValueOnce(new Error('bedrock unreachable'));

    await expect(handle(makeJob({ noteId: 'note_err' }))).rejects.toThrow('bedrock unreachable');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CASE_ROUTER_PROPOSED',
        metadata: expect.objectContaining({
          outcome: 'agent_threw',
          errorClass: 'Error',
          personaVersion: 'miss-cleo-v1',
        }),
      }),
    );
  });
});
