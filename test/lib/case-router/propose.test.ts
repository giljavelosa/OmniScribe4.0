import { describe, expect, it } from 'vitest';

import {
  CaseRouterProposalSchema,
  CaseRouterService,
  buildCaseRouterSystemPrompt,
  buildCaseRouterUserMessage,
  type CaseRouterInput,
} from '@/services/copilot/case-router';

/**
 * Sprint 0.13 — case-router agent tests.
 *
 * Three coverage targets per the spec:
 *   1. Stub-mode fallback emits a synthetic LOW-confidence open-new
 *      proposal so the review-screen panel still renders end-to-end.
 *   2. Each of the three primary actions parses correctly through the
 *      Zod schema.
 *   3. The system prompt prefixes the persona block (anti-drift +
 *      "case-routing only" rules).
 */

const patientId = 'pat_test';
const orgId = 'org_test';
const noteId = 'note_test';

function baseInput(overrides: Partial<CaseRouterInput> = {}): CaseRouterInput {
  return {
    noteId,
    orgId,
    patientId,
    assessmentSnippet: 'Right-shoulder pain, likely rotator cuff impingement.',
    planSnippet: 'PT 6 weeks, NSAID PRN.',
    cases: [
      {
        id: 'case_neck',
        primaryIcd: 'M54.81',
        primaryIcdLabel: 'Cervicogenic headache',
        secondaryIcd: null,
        secondaryIcdLabel: null,
        status: 'ACTIVE' as const,
        mirrorsFhirConditionId: null,
        viewerLastActivityAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
        viewerDivisionLastActivityAt: new Date(
          Date.now() - 5 * 86_400_000,
        ).toISOString(),
        lastActivityAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
        viewerDivisionVisitCount: 11,
      },
    ],
    clinicianDivision: 'MEDICAL' as const,
    noteDivision: 'MEDICAL' as const,
    ...overrides,
  };
}

describe('Zod schema — CaseRouterProposalSchema', () => {
  it('parses an "attach" proposal', () => {
    const result = CaseRouterProposalSchema.safeParse({
      action: 'attach',
      caseManagementId: 'case_neck',
      confidence: 'high',
      reasoning: 'Continues your active cervicogenic-headache arc.',
      alternatives: [],
    });
    expect(result.success).toBe(true);
  });

  it('parses an "attach-with-secondary" proposal', () => {
    const result = CaseRouterProposalSchema.safeParse({
      action: 'attach-with-secondary',
      caseManagementId: 'case_neck',
      secondaryIcdAddition: { icd: 'M25.51', icdLabel: 'Right shoulder pain' },
      confidence: 'medium',
      reasoning: 'Visit also surfaces shoulder pain — fits as secondary.',
      alternatives: [
        {
          action: 'open-new',
          newCase: { primaryIcd: 'M25.51', primaryIcdLabel: 'Right shoulder pain' },
          reasoning: 'Open a new case if the shoulder is its own arc.',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('parses an "open-new" proposal', () => {
    const result = CaseRouterProposalSchema.safeParse({
      action: 'open-new',
      newCase: {
        primaryIcd: 'M25.51',
        primaryIcdLabel: 'Right shoulder pain',
      },
      confidence: 'low',
      reasoning: "I'd want a human read on this — pick from these or open new.",
      alternatives: [],
    });
    expect(result.success).toBe(true);
  });

  it('parses model nulls for optional string fields', () => {
    const result = CaseRouterProposalSchema.safeParse({
      action: 'open-new',
      newCase: {
        primaryIcd: 'M75.42',
        primaryIcdLabel: 'Impingement syndrome of left shoulder',
        secondaryIcd: null,
        secondaryIcdLabel: null,
      },
      confidence: 'high',
      reasoning: 'The note describes a distinct shoulder care arc.',
      alternatives: [
        {
          action: 'attach',
          caseManagementId: null,
          reasoning: 'No existing case fits, but the clinician can override.',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('Sprint 0.15: parses an "open-new-from-condition" proposal with fhirCitations', () => {
    const result = CaseRouterProposalSchema.safeParse({
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
      fhirCitations: [
        {
          resourceType: 'Condition',
          fhirId: 'cond_m5481',
          lastUpdated: '2024-08-15T10:00:00Z',
          recorder: 'Dr. Patel',
          recordedDate: '2024-08-15',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('Sprint 0.16: parses a "reconcile" proposal with 4 resolution options', () => {
    const result = CaseRouterProposalSchema.safeParse({
      action: 'reconcile',
      reconcileProposal: {
        driftLogId: 'drift_1',
        caseManagementId: 'case_knee',
        fhirConditionId: 'cond_knee',
        driftKind: 'STATUS',
        summary: 'OmniScribe case ACTIVE; EHR Condition resolved 2025-01-12 by Dr. Park.',
        resolutionOptions: [
          { kind: 'reopen-case', label: 'Reopen as recurrence', reasoning: 'Visit reads like recurrence.' },
          { kind: 'open-new-case', label: 'Open a new case', reasoning: 'Treat as a discrete episode.' },
          { kind: 'close-case', label: 'Close the case', reasoning: 'Sync to EHR.' },
          { kind: 'attach-as-is', label: 'Attach as-is', reasoning: 'Defer reconciliation.' },
        ],
        recommendedOptionIndex: 0,
      },
      confidence: 'medium',
      reasoning: 'EHR shows resolved; visit reads like recurrence.',
      alternatives: [],
    });
    expect(result.success).toBe(true);
  });

  it('Sprint 0.16: rejects a "reconcile" proposal with only 1 resolution option (min 2)', () => {
    const result = CaseRouterProposalSchema.safeParse({
      action: 'reconcile',
      reconcileProposal: {
        driftLogId: 'drift_1',
        caseManagementId: 'case_knee',
        fhirConditionId: 'cond_knee',
        driftKind: 'STATUS',
        summary: 's',
        resolutionOptions: [
          { kind: 'attach-as-is', label: 'a', reasoning: 'r' },
        ],
      },
      confidence: 'medium',
      reasoning: 'x',
      alternatives: [],
    });
    expect(result.success).toBe(false);
  });

  it('Sprint 0.16: rejects a "reconcile" proposal with 5 resolution options (max 4)', () => {
    const result = CaseRouterProposalSchema.safeParse({
      action: 'reconcile',
      reconcileProposal: {
        driftLogId: 'drift_1',
        caseManagementId: 'case_knee',
        fhirConditionId: 'cond_knee',
        driftKind: 'ICD',
        summary: 's',
        resolutionOptions: Array.from({ length: 5 }).map(() => ({
          kind: 'attach-as-is' as const,
          label: 'a',
          reasoning: 'r',
        })),
      },
      confidence: 'medium',
      reasoning: 'x',
      alternatives: [],
    });
    expect(result.success).toBe(false);
  });

  it('Sprint 0.15: rejects an "open-new-from-condition" proposal with null primaryIcd', () => {
    const result = CaseRouterProposalSchema.safeParse({
      action: 'open-new-from-condition',
      newCaseFromCondition: {
        fhirConditionId: 'cond_m5481',
        primaryIcd: null,
        primaryIcdLabel: 'Cervicogenic headache',
        recordedDate: '2024-08-15',
        recorderName: 'Dr. Patel',
      },
      confidence: 'high',
      reasoning: 'x',
      alternatives: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid confidence value', () => {
    const result = CaseRouterProposalSchema.safeParse({
      action: 'attach',
      caseManagementId: 'case_neck',
      confidence: 'extreme',
      reasoning: 'x',
      alternatives: [],
    });
    expect(result.success).toBe(false);
  });

  it('caps alternatives at 3', () => {
    const result = CaseRouterProposalSchema.safeParse({
      action: 'open-new',
      newCase: { primaryIcd: null, primaryIcdLabel: 'Routing in progress' },
      confidence: 'low',
      reasoning: 'unclear',
      alternatives: Array.from({ length: 4 }).map(() => ({
        action: 'attach',
        caseManagementId: 'case_neck',
        reasoning: 'try this',
      })),
    });
    expect(result.success).toBe(false);
  });
});

describe('buildCaseRouterSystemPrompt', () => {
  it('prepends the Miss Cleo persona + anti-drift block', () => {
    const sys = buildCaseRouterSystemPrompt();
    expect(sys).toContain('Miss Cleo');
    expect(sys).toContain('VOICE LOCK');
    expect(sys).toContain('CASE-ROUTING TASK');
    expect(sys).toContain('Source-grounded only');
    // The agent does data routing only — never clinical recommendations.
    expect(sys).toMatch(/clinical advice beyond routing/i);
  });

  it('Sprint 0.15: includes the FHIR-citation guidance block only when fhirAware=true', () => {
    const withFhir = buildCaseRouterSystemPrompt({ fhirAware: true });
    const withoutFhir = buildCaseRouterSystemPrompt({ fhirAware: false });
    // The full guidance block — the "PREFER" verb + the
    // "Copy primaryIcd ... from the Condition" rule — only renders
    // when the worker passed verified Conditions. The OUTPUT FORMAT
    // schema lists the action either way so the model knows it exists.
    expect(withFhir).toContain('EHR DIAGNOSIS LIST');
    expect(withFhir).toMatch(/PREFER the action "open-new-from-condition"/);
    expect(withFhir).toMatch(/Copy primaryIcd \+ primaryIcdLabel from the Condition/);
    expect(withoutFhir).not.toContain('EHR DIAGNOSIS LIST');
    expect(withoutFhir).not.toMatch(/PREFER the action "open-new-from-condition"/);
  });

  it('Sprint 0.16: includes the drift-handling block only when driftAware=true', () => {
    const withDrift = buildCaseRouterSystemPrompt({ driftAware: true });
    const withoutDrift = buildCaseRouterSystemPrompt({ driftAware: false });
    expect(withDrift).toContain('DRIFT DETECTION');
    expect(withDrift).toMatch(/your top action MUST be\s+"reconcile"/);
    expect(withDrift).toMatch(/Confidence for "reconcile" is bounded at "medium"/);
    expect(withoutDrift).not.toContain('DRIFT DETECTION');
    expect(withoutDrift).not.toMatch(/your top action MUST be\s+"reconcile"/);
  });
});

describe('buildCaseRouterUserMessage', () => {
  it('lists existing cases + recency signals', () => {
    const user = buildCaseRouterUserMessage(baseInput());
    expect(user).toContain('case_neck');
    expect(user).toContain('M54.81');
    expect(user).toContain('Cervicogenic headache');
    expect(user).toContain('viewer-division visits: 11');
  });

  it('emits an "open-new is the only viable action" hint when no cases', () => {
    const user = buildCaseRouterUserMessage(baseInput({ cases: [] }));
    expect(user).toMatch(/no existing cases/i);
  });

  it('truncates very long assessment snippets', () => {
    const long = 'x'.repeat(5000);
    const user = buildCaseRouterUserMessage(baseInput({ assessmentSnippet: long }));
    expect(user.length).toBeLessThan(8000);
    expect(user).toContain('truncated');
  });

  it('Sprint 0.16: emits the <drift_signals> block only when driftSignals is non-empty', () => {
    const withDrift = buildCaseRouterUserMessage(
      baseInput({
        driftSignals: [
          {
            driftLogId: 'drift_1',
            caseManagementId: 'case_neck',
            fhirConditionId: 'cond_neck',
            driftKind: 'STATUS',
            caseStatus: 'ACTIVE',
            caseIcd: 'M54.81',
            caseIcdLabel: 'Cervicogenic headache',
            conditionStatus: 'resolved',
            conditionIcd: 'M54.81',
            conditionIcdLabel: 'Cervicogenic headache',
            recordedDate: '2025-01-12',
            recorderName: 'Dr. Park',
          },
        ],
      }),
    );
    expect(withDrift).toContain('<drift_signals');
    expect(withDrift).toContain('drift_1');
    expect(withDrift).toContain('Dr. Park');
    // Non-drift path stays byte-clean.
    expect(buildCaseRouterUserMessage(baseInput())).not.toContain('<drift_signals');
  });

  it('Sprint 0.15: emits the <fhir_conditions> block only when fhirConditions is non-empty', () => {
    const withFhir = buildCaseRouterUserMessage(
      baseInput({
        fhirConditions: [
          {
            fhirId: 'cond_m5481',
            icd: 'M54.81',
            icdLabel: 'Cervicogenic headache',
            clinicalStatus: 'active',
            recordedDate: '2024-08-15',
            recorderName: 'Dr. Patel',
            lastUpdated: '2024-08-15T10:00:00Z',
          },
        ],
      }),
    );
    expect(withFhir).toContain('<fhir_conditions');
    expect(withFhir).toContain('cond_m5481');
    expect(withFhir).toContain('Dr. Patel');
    // Non-FHIR path stays byte-clean — no FHIR block at all.
    const noFhir = buildCaseRouterUserMessage(baseInput());
    expect(noFhir).not.toContain('<fhir_conditions');
  });
});

describe('CaseRouterService.propose — stub fallback', () => {
  it('returns a synthetic LOW-confidence open-new when the LLM is in stub mode', async () => {
    const stubLLM = {
      generate: async () => ({
        text: '',
        model: 'stub',
        latencyMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        stub: true,
      }),
      generateStream: async function* () {},
    };
    const svc = new CaseRouterService(stubLLM as never);
    const result = await svc.propose(baseInput());
    expect(result.stub).toBe(true);
    expect(result.modelVersion).toBe('stub');
    expect(result.proposal.confidence).toBe('low');
    expect(result.proposal.action).toBe('open-new');
    expect(result.proposal.reasoning).toMatch(/stub mode/i);
    // Each existing case gets surfaced as an alternative so the clinician
    // can still pick from them in the LOW-confidence fallback.
    expect(result.proposal.alternatives).toHaveLength(1);
    expect(result.proposal.alternatives[0]?.caseManagementId).toBe('case_neck');
  });

  it('returns a synthetic LOW fallback when the model output fails parsing', async () => {
    const llm = {
      generate: async () => ({
        text: 'not JSON at all',
        model: 'sonnet',
        latencyMs: 100,
        tokensIn: 100,
        tokensOut: 5,
      }),
      generateStream: async function* () {},
    };
    const svc = new CaseRouterService(llm as never);
    const result = await svc.propose(baseInput());
    expect(result.stub).toBe(false);
    expect(result.modelVersion).toBe('fallback');
    expect(result.fallbackCause).toMatch(/parse:/);
    expect(result.proposal.confidence).toBe('low');
  });

  it('parses a well-formed Sonnet attach response', async () => {
    const llm = {
      generate: async () => ({
        text: JSON.stringify({
          action: 'attach',
          caseManagementId: 'case_neck',
          confidence: 'high',
          reasoning: 'Continues the cervicogenic-headache arc.',
          alternatives: [],
        }),
        model: 'sonnet-id',
        latencyMs: 250,
        tokensIn: 1200,
        tokensOut: 100,
      }),
      generateStream: async function* () {},
    };
    const svc = new CaseRouterService(llm as never);
    const result = await svc.propose(baseInput());
    expect(result.stub).toBe(false);
    expect(result.modelVersion).toBe('sonnet');
    expect(result.proposal.action).toBe('attach');
    expect(result.proposal.caseManagementId).toBe('case_neck');
    expect(result.proposal.confidence).toBe('high');
  });

  it('falls back to LOW when Sonnet hallucinates an unknown caseManagementId', async () => {
    const llm = {
      generate: async () => ({
        text: JSON.stringify({
          action: 'attach',
          caseManagementId: 'case_made_up',
          confidence: 'high',
          reasoning: 'Continues the made-up arc.',
          alternatives: [],
        }),
        model: 'sonnet-id',
        latencyMs: 100,
        tokensIn: 50,
        tokensOut: 5,
      }),
      generateStream: async function* () {},
    };
    const svc = new CaseRouterService(llm as never);
    const result = await svc.propose(baseInput());
    expect(result.modelVersion).toBe('fallback');
    expect(result.fallbackCause).toMatch(/unknown_caseManagementId/);
    expect(result.proposal.confidence).toBe('low');
  });

  it('Sprint 0.15: falls back when the model emits an unknown fhirConditionId', async () => {
    const llm = {
      generate: async () => ({
        text: JSON.stringify({
          action: 'open-new-from-condition',
          newCaseFromCondition: {
            fhirConditionId: 'cond_hallucinated',
            primaryIcd: 'M54.81',
            primaryIcdLabel: 'Cervicogenic headache',
            recordedDate: '2024-08-15',
            recorderName: 'Dr. Made-Up',
          },
          confidence: 'high',
          reasoning: 'x',
          alternatives: [],
        }),
        model: 'sonnet-id',
        latencyMs: 100,
        tokensIn: 50,
        tokensOut: 5,
      }),
      generateStream: async function* () {},
    };
    const svc = new CaseRouterService(llm as never);
    const result = await svc.propose(
      baseInput({
        fhirConditions: [
          {
            fhirId: 'cond_real_one',
            icd: 'I10',
            icdLabel: 'Essential hypertension',
            clinicalStatus: 'active',
            recordedDate: '2024-08-15',
            recorderName: 'Dr. Patel',
            lastUpdated: '2024-08-15T10:00:00Z',
          },
        ],
      }),
    );
    expect(result.modelVersion).toBe('fallback');
    expect(result.fallbackCause).toMatch(/unknown_fhirConditionId/);
    expect(result.proposal.confidence).toBe('low');
  });

  it('Sprint 0.16: falls back when the model emits a reconcile with an unknown driftLogId', async () => {
    const llm = {
      generate: async () => ({
        text: JSON.stringify({
          action: 'reconcile',
          reconcileProposal: {
            driftLogId: 'drift_made_up',
            caseManagementId: 'case_neck',
            fhirConditionId: 'cond_neck',
            driftKind: 'STATUS',
            summary: 's',
            resolutionOptions: [
              { kind: 'reopen-case', label: 'a', reasoning: 'r' },
              { kind: 'attach-as-is', label: 'b', reasoning: 'r' },
            ],
          },
          confidence: 'medium',
          reasoning: 'x',
          alternatives: [],
        }),
        model: 'sonnet-id',
        latencyMs: 100,
        tokensIn: 50,
        tokensOut: 5,
      }),
      generateStream: async function* () {},
    };
    const svc = new CaseRouterService(llm as never);
    const result = await svc.propose(
      baseInput({
        driftSignals: [
          {
            driftLogId: 'drift_real',
            caseManagementId: 'case_neck',
            fhirConditionId: 'cond_neck',
            driftKind: 'STATUS',
            caseStatus: 'ACTIVE',
            caseIcd: 'M54.81',
            caseIcdLabel: 'Cervicogenic headache',
            conditionStatus: 'resolved',
            conditionIcd: 'M54.81',
            conditionIcdLabel: 'Cervicogenic headache',
            recordedDate: '2025-01-12',
            recorderName: 'Dr. Park',
          },
        ],
      }),
    );
    expect(result.modelVersion).toBe('fallback');
    expect(result.fallbackCause).toMatch(/unknown_driftLogId/);
  });

  it('Sprint 0.16: coerces "high" confidence DOWN to "medium" on a reconcile proposal (spec decision 7)', async () => {
    const llm = {
      generate: async () => ({
        text: JSON.stringify({
          action: 'reconcile',
          reconcileProposal: {
            driftLogId: 'drift_real',
            caseManagementId: 'case_neck',
            fhirConditionId: 'cond_neck',
            driftKind: 'STATUS',
            summary: 's',
            resolutionOptions: [
              { kind: 'reopen-case', label: 'a', reasoning: 'r' },
              { kind: 'attach-as-is', label: 'b', reasoning: 'r' },
            ],
            recommendedOptionIndex: 0,
          },
          confidence: 'high', // out-of-bounds for reconcile.
          reasoning: 'x',
          alternatives: [],
        }),
        model: 'sonnet-id',
        latencyMs: 100,
        tokensIn: 50,
        tokensOut: 5,
      }),
      generateStream: async function* () {},
    };
    const svc = new CaseRouterService(llm as never);
    const result = await svc.propose(
      baseInput({
        driftSignals: [
          {
            driftLogId: 'drift_real',
            caseManagementId: 'case_neck',
            fhirConditionId: 'cond_neck',
            driftKind: 'STATUS',
            caseStatus: 'ACTIVE',
            caseIcd: 'M54.81',
            caseIcdLabel: 'Cervicogenic headache',
            conditionStatus: 'resolved',
            conditionIcd: 'M54.81',
            conditionIcdLabel: 'Cervicogenic headache',
            recordedDate: '2025-01-12',
            recorderName: 'Dr. Park',
          },
        ],
      }),
    );
    expect(result.modelVersion).toBe('sonnet');
    expect(result.proposal.confidence).toBe('medium');
    expect(result.proposal.action).toBe('reconcile');
  });

  it('Sprint 0.15: accepts a well-formed open-new-from-condition with a known fhirConditionId', async () => {
    const llm = {
      generate: async () => ({
        text: JSON.stringify({
          action: 'open-new-from-condition',
          newCaseFromCondition: {
            fhirConditionId: 'cond_real_one',
            primaryIcd: 'I10',
            primaryIcdLabel: 'Essential hypertension',
            recordedDate: '2024-08-15',
            recorderName: 'Dr. Patel',
          },
          confidence: 'high',
          reasoning: 'EHR shows Dr. Patel recorded I10 on 2024-08-15.',
          alternatives: [],
        }),
        model: 'sonnet-id',
        latencyMs: 100,
        tokensIn: 50,
        tokensOut: 5,
      }),
      generateStream: async function* () {},
    };
    const svc = new CaseRouterService(llm as never);
    const result = await svc.propose(
      baseInput({
        fhirConditions: [
          {
            fhirId: 'cond_real_one',
            icd: 'I10',
            icdLabel: 'Essential hypertension',
            clinicalStatus: 'active',
            recordedDate: '2024-08-15',
            recorderName: 'Dr. Patel',
            lastUpdated: '2024-08-15T10:00:00Z',
          },
        ],
      }),
    );
    expect(result.proposal.action).toBe('open-new-from-condition');
    expect(result.proposal.newCaseFromCondition?.fhirConditionId).toBe('cond_real_one');
    expect(result.modelVersion).toBe('sonnet');
  });

  it('strips a markdown fence around the JSON before parsing', async () => {
    const llm = {
      generate: async () => ({
        text: '```json\n' + JSON.stringify({
          action: 'open-new',
          newCase: { primaryIcd: 'M25.51', primaryIcdLabel: 'Right shoulder pain' },
          confidence: 'medium',
          reasoning: 'Visit is about a new shoulder problem.',
          alternatives: [],
        }) + '\n```',
        model: 'sonnet-id',
        latencyMs: 100,
        tokensIn: 50,
        tokensOut: 5,
      }),
      generateStream: async function* () {},
    };
    const svc = new CaseRouterService(llm as never);
    const result = await svc.propose(baseInput());
    expect(result.modelVersion).toBe('sonnet');
    expect(result.proposal.action).toBe('open-new');
  });
});
