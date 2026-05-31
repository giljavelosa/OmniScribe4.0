import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { LLMService } from '@/services/llm';

const mocks = vi.hoisted(() => ({
  runTool: vi.fn(),
}));

vi.mock('@/services/copilot/tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/copilot/tools')>();
  return {
    ...actual,
    runTool: (...args: unknown[]) => mocks.runTool(...args),
  };
});

import {
  runAgent,
  shouldPreloadVerifiedExternalContext,
} from '@/services/copilot/agent';

function scriptedLlm(response: string): LLMService {
  return {
    async generate() {
      return {
        text: response,
        model: 'sonnet',
        latencyMs: 1,
        tokensIn: 10,
        tokensOut: 20,
      };
    },
    async *generateStream() {
      throw new Error('not used');
    },
  };
}

beforeEach(() => {
  mocks.runTool.mockReset();
});

describe('verified document prefetch for Cleo', () => {
  it('preloads verified uploaded records for lab questions', () => {
    expect(shouldPreloadVerifiedExternalContext('what was the last creatinine lab value?')).toBe(true);
    expect(shouldPreloadVerifiedExternalContext('show me page 5 of the scanned document')).toBe(true);
    expect(shouldPreloadVerifiedExternalContext('given his kidney function, what losartan dose is usual?')).toBe(true);
    expect(shouldPreloadVerifiedExternalContext('what was the plan last visit?')).toBe(false);
  });

  it('corrects a note-only false negative when verified document labs contain the answer', async () => {
    mocks.runTool.mockResolvedValueOnce({
      ok: true,
      rowCount: 1,
      data: {
        documents: [
          {
            id: 'doc-verified',
            dateOfRecord: '2026-05-30',
            sourceLabel: 'Outside provider',
            documentType: 'progress_note',
            labs: [
              {
                name: 'Creatinine',
                value: '1.42',
                unit: null,
                referenceRange: null,
                abnormalFlag: 'high',
                collectedDate: null,
                sourcePage: 4,
                confidence: 'high',
              },
            ],
            textMatches: [
              {
                term: 'creatinine',
                sourcePage: 24,
                text: [
                  'Page 24',
                  'Recent Laboratory Results - CBC, Chemistry, Renal Function - 05/21/2026',
                  'Creatinine',
                  '1.42',
                  'H',
                  '0.70-1.30',
                  'mg/dL',
                  '05/21/2026',
                ].join('\n'),
              },
            ],
          },
        ],
      },
    });

    const llm = scriptedLlm(JSON.stringify({
      action: 'answer',
      text: "I don't see any creatinine lab values in this patient's visit note.",
      sources: [{ kind: 'note', id: 'note-1', label: 'Visit note' }],
    }));

    const out = await runAgent(
      {
        patientId: 'pat-1',
        noteId: 'note-1',
        history: [],
        question: 'what was the last creatinine lab value?',
      },
      { orgId: 'org-1' },
      llm,
    );

    expect(mocks.runTool).toHaveBeenCalledWith(
      'lookupVerifiedExternalContext',
      { patientId: 'pat-1', query: 'what was the last creatinine lab value?' },
      expect.objectContaining({ orgId: 'org-1' }),
    );
    expect(out.toolCalls[0]).toMatchObject({
      tool: 'lookupVerifiedExternalContext',
      resultOk: true,
      rowCount: 1,
    });
    expect(out.answer.text).toContain('Creatinine was 1.42 mg/dL');
    expect(out.answer.text).toContain('reference range 0.70-1.30');
    expect(out.answer.text).toContain('05/21/2026');
    expect(out.answer.text).toContain('page 24');
    expect(out.answer.sources).toEqual([
      { kind: 'document', id: 'doc-verified', label: 'Outside provider · page 24' },
    ]);
  });

  it('answers page requests directly from verified document page text', async () => {
    mocks.runTool.mockResolvedValueOnce({
      ok: true,
      rowCount: 1,
      data: {
        documents: [
          {
            id: 'doc-verified',
            dateOfRecord: '2026-05-30',
            sourceLabel: 'Outside provider',
            documentType: 'progress_note',
            labs: [],
            pages: [
              {
                fileIndex: 0,
                pageNumber: 5,
                text: 'Medication Reconciliation Continued and Clinical Timeline\nHydralazine\nInsulin glargine\nMetformin XR',
                characterCount: 94,
              },
            ],
            textMatches: [],
          },
        ],
      },
    });

    const llm = scriptedLlm(JSON.stringify({
      action: 'answer',
      text: 'This response should not be needed.',
      sources: [{ kind: 'patient', id: 'pat-1', label: 'Patient' }],
    }));

    const out = await runAgent(
      {
        patientId: 'pat-1',
        noteId: 'note-1',
        history: [],
        question: 'show me page 5 of the scanned document',
      },
      { orgId: 'org-1' },
      llm,
    );

    expect(mocks.runTool).toHaveBeenCalledWith(
      'lookupVerifiedExternalContext',
      {
        patientId: 'pat-1',
        query: 'show me page 5 of the scanned document',
        pageNumber: 5,
      },
      expect.objectContaining({ orgId: 'org-1' }),
    );
    expect(out.iterations).toBe(0);
    expect(out.answer.text).toContain('Page 5 from the verified uploaded document');
    expect(out.answer.text).toContain('Medication Reconciliation Continued');
    expect(out.answer.sources).toEqual([
      { kind: 'document', id: 'doc-verified', label: 'Outside provider · page 5' },
    ]);
  });

  it('answers requested lab values from verified page text when structured labs are sparse', async () => {
    mocks.runTool.mockResolvedValueOnce({
      ok: true,
      rowCount: 1,
      data: {
        documents: [
          {
            id: 'doc-verified',
            dateOfRecord: '2026-05-30',
            sourceLabel: 'Outside provider',
            documentType: 'lab_report',
            labs: [],
            textMatches: [
              {
                term: 'creatinine',
                sourcePage: 252,
                text: [
                  'LABORATORY REPORT',
                  'Date:',
                  '2024-10-08',
                  'Analyte',
                  'Result',
                  'Flag',
                  'Units',
                  'Reference',
                  'BUN',
                  '51',
                  'H',
                  'mg/dL',
                  '7-20',
                  'Creatinine',
                  '1.52',
                  'H',
                  'mg/dL',
                  '0.6-1.1',
                  'eGFR',
                  '32',
                  'L',
                  'mL/min',
                  '>60',
                ].join('\n'),
              },
            ],
          },
        ],
      },
    });

    const llm = scriptedLlm(JSON.stringify({
      action: 'answer',
      text: 'This response should not be needed.',
      sources: [{ kind: 'patient', id: 'pat-1', label: 'Patient' }],
    }));

    const out = await runAgent(
      {
        patientId: 'pat-1',
        noteId: null,
        history: [],
        question: 'what was the last creatinine value?',
      },
      { orgId: 'org-1' },
      llm,
    );

    expect(out.iterations).toBe(0);
    expect(out.answer.text).toContain('Creatinine was 1.52 mg/dL');
    expect(out.answer.text).toContain('flagged high');
    expect(out.answer.text).toContain('reference range 0.6-1.1');
    expect(out.answer.text).toContain('page 252');
    expect(out.answer.sources).toEqual([
      { kind: 'document', id: 'doc-verified', label: 'Outside provider · page 252' },
    ]);
  });

  it('answers patient-cockpit questions from verified uploaded records when no signed note exists', async () => {
    mocks.runTool.mockResolvedValueOnce({
      ok: true,
      rowCount: 1,
      data: {
        documents: [
          {
            id: 'doc-verified',
            dateOfRecord: '2026-05-30',
            sourceLabel: 'Mock outside packet',
            documentType: 'progress_note',
            summary: 'Synthetic packet summary.',
            diagnoses: [
              {
                text: 'Heart transplant recipient / orthotopic heart transplant',
                icdHint: 'Z94.1',
                status: 'active',
                sourcePage: 2,
                confidence: 'high',
              },
            ],
            medications: [
              {
                name: 'Tacrolimus',
                dose: '2 mg every morning and 1.5 mg every evening',
                route: 'PO',
                frequency: null,
                status: 'current',
                sourcePage: 3,
                confidence: 'high',
              },
              {
                name: 'Mycophenolate mofetil',
                dose: '1000 mg',
                route: 'PO',
                frequency: 'twice daily',
                status: 'current',
                sourcePage: 3,
                confidence: 'high',
              },
            ],
            allergies: [],
            labs: [],
            procedures: [],
            textMatches: [],
          },
        ],
      },
    });

    const llm = scriptedLlm(JSON.stringify({
      action: 'answer',
      text: 'This response should not be needed.',
      sources: [{ kind: 'patient', id: 'pat-1', label: 'Patient' }],
    }));

    const out = await runAgent(
      {
        patientId: 'pat-1',
        noteId: null,
        history: [],
        question: 'what medications were listed in the uploaded packet?',
      },
      { orgId: 'org-1' },
      llm,
    );

    expect(out.iterations).toBe(0);
    expect(out.answer.text).toContain('Tacrolimus');
    expect(out.answer.text).toContain('Mycophenolate mofetil');
    expect(out.answer.text).toContain('page 3');
    expect(out.answer.sources).toEqual([
      { kind: 'document', id: 'doc-verified', label: 'Mock outside packet · page 3' },
    ]);
  });

  it('does not hallucinate absent medication answers from verified uploaded records', async () => {
    mocks.runTool.mockResolvedValueOnce({
      ok: true,
      rowCount: 1,
      data: {
        documents: [
          {
            id: 'doc-verified',
            dateOfRecord: '2026-05-30',
            sourceLabel: 'Mock outside packet',
            documentType: 'progress_note',
            summary: 'Synthetic packet summary.',
            diagnoses: [],
            medications: [
              {
                name: 'Amlodipine',
                dose: '10 mg',
                route: 'PO',
                frequency: 'daily',
                status: 'current',
                sourcePage: 4,
                confidence: 'high',
              },
            ],
            allergies: [],
            labs: [],
            procedures: [],
            textMatches: [],
          },
        ],
      },
    });

    const llm = scriptedLlm(JSON.stringify({
      action: 'answer',
      text: 'This response should not be needed.',
      sources: [{ kind: 'patient', id: 'pat-1', label: 'Patient' }],
    }));

    const out = await runAgent(
      {
        patientId: 'pat-1',
        noteId: null,
        history: [],
        question: 'is warfarin listed in the uploaded records?',
      },
      { orgId: 'org-1' },
      llm,
    );

    expect(out.iterations).toBe(0);
    expect(out.answer.text).toMatch(/did not find matching text/i);
    expect(out.answer.text).not.toContain('Amlodipine');
    expect(out.answer.sources).toEqual([
      { kind: 'document', id: 'doc-verified', label: 'Mock outside packet' },
    ]);
  });

  it('does not treat broad uploaded-record text matches as proof of an absent named medication', async () => {
    mocks.runTool.mockResolvedValueOnce({
      ok: true,
      rowCount: 1,
      data: {
        documents: [
          {
            id: 'doc-verified',
            dateOfRecord: '2026-05-30',
            sourceLabel: 'Mock outside packet',
            documentType: 'progress_note',
            summary: 'Synthetic packet summary.',
            diagnoses: [],
            medications: [],
            allergies: [],
            labs: [],
            procedures: [],
            textMatches: [
              {
                term: 'listed',
                sourcePage: 55,
                text: 'Page 55\nReviewed prior records, imaging, and outside laboratory data with the patient.',
              },
            ],
          },
        ],
      },
    });

    const llm = scriptedLlm(JSON.stringify({
      action: 'answer',
      text: 'This response should not be needed.',
      sources: [{ kind: 'patient', id: 'pat-1', label: 'Patient' }],
    }));

    const out = await runAgent(
      {
        patientId: 'pat-1',
        noteId: null,
        history: [],
        question: 'is warfarin listed in the uploaded records?',
      },
      { orgId: 'org-1' },
      llm,
    );

    expect(out.iterations).toBe(0);
    expect(out.answer.text).toMatch(/did not find matching text/i);
    expect(out.answer.text).not.toContain('Page 55');
    expect(out.answer.sources).toEqual([
      { kind: 'document', id: 'doc-verified', label: 'Mock outside packet' },
    ]);
  });
});
