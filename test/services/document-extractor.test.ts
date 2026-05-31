import { describe, expect, it } from 'vitest';

import { DocumentExtractor } from '@/services/external-context/document-extractor';
import type { GenerateOptions, GenerateResult, LLMService } from '@/services/llm';

const envelope = {
  ocrText: 'Outside lab report. Creatinine 1.0.',
  extraction: {
    documentType: 'lab_report',
    summary: 'Outside lab report with one creatinine value.',
    diagnoses: [],
    medications: [],
    allergies: [],
    labs: [
      {
        name: 'Creatinine',
        value: '1.0',
        unit: 'mg/dL',
        referenceRange: null,
        abnormalFlag: 'normal',
        collectedDate: null,
        sourcePage: 1,
        confidence: 'high',
        verbatim: 'Creatinine 1.0.',
      },
    ],
    vitals: [],
    procedures: [],
    documentDateGuess: null,
    extractionNotes: null,
  },
};

function envelopeForPage(sourcePage: number, name: string) {
  return {
    ...envelope,
    ocrText: `Page ${sourcePage} OCR. ${name}.`,
    extraction: {
      ...envelope.extraction,
      summary: `Page ${sourcePage} summary.`,
      labs: [
        {
          ...envelope.extraction.labs[0]!,
          name,
          sourcePage,
          verbatim: `${name} 1.0.`,
        },
      ],
    },
  };
}

describe('DocumentExtractor', () => {
  it('calls the LLM abstraction with image blocks and parses the envelope', async () => {
    const llm = new ScriptedLlm([JSON.stringify(envelope)]);
    const extractor = new DocumentExtractor(llm);

    const result = await extractor.extract({
      orgId: 'org_1',
      externalContextId: 'ec_1',
      sourceLabel: 'Lab photo',
      images: [{ mediaType: 'image/png', data: 'abc', sourcePage: 1 }],
    });

    expect(result.envelope.extraction.documentType).toBe('lab_report');
    expect(llm.calls[0]?.opts?.images).toHaveLength(1);
    expect(llm.calls[0]?.opts?.phi).toBe(true);
    expect(llm.calls[0]?.opts?.meter?.surface).toBe('worker.external-context-extraction');
  });

  it('retries once when the first model response fails schema validation', async () => {
    const llm = new ScriptedLlm(['{"not":"valid"}', JSON.stringify(envelope)]);
    const extractor = new DocumentExtractor(llm);

    const result = await extractor.extract({
      orgId: 'org_1',
      externalContextId: 'ec_1',
      sourceLabel: null,
      images: [{ mediaType: 'image/png', data: 'abc', sourcePage: 1 }],
    });

    expect(result.envelope.ocrText).toContain('Outside lab');
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]?.opts?.requestId).toBe('ec_1:validation-retry');
  });

  it('returns a manual-review envelope when a single page is invalid after retry', async () => {
    const llm = new ScriptedLlm(['{"ocrText":"truncated', 'not valid json']);
    const extractor = new DocumentExtractor(llm);

    const result = await extractor.extract({
      orgId: 'org_1',
      externalContextId: 'ec_1',
      sourceLabel: null,
      images: [{ mediaType: 'image/png', data: 'abc', sourcePage: 4 }],
    });

    expect(result.envelope.ocrText).toContain('Pages requiring manual review: 4');
    expect(result.envelope.extraction.summary).toContain('Manual review required');
    expect(result.envelope.extraction.extractionNotes).toContain('invalid model JSON');
    expect(result.envelope.extraction.labs).toHaveLength(0);
    expect(llm.calls).toHaveLength(2);
  });

  it('extracts multi-page batches page by page to avoid oversized JSON responses', async () => {
    const llm = new ScriptedLlm([
      JSON.stringify(envelopeForPage(1, 'Creatinine')),
      JSON.stringify(envelopeForPage(2, 'Hemoglobin')),
    ]);
    const extractor = new DocumentExtractor(llm);

    const result = await extractor.extract({
      orgId: 'org_1',
      externalContextId: 'ec_1',
      sourceLabel: null,
      images: [
        { mediaType: 'image/png', data: 'page1', sourcePage: 1 },
        { mediaType: 'image/png', data: 'page2', sourcePage: 2 },
      ],
    });

    expect(result.envelope.ocrText).toContain('Page 1 OCR');
    expect(result.envelope.ocrText).toContain('Page 2 OCR');
    expect(result.envelope.extraction.summary).toContain('Page 1');
    expect(result.envelope.extraction.summary).toContain('Page 2');
    expect(result.envelope.extraction.labs.map((lab) => lab.sourcePage)).toEqual([1, 2]);
    expect(result.envelope.extraction.extractionNotes).toContain('page-level extraction');
    expect(llm.calls.map((call) => call.opts?.images?.length)).toEqual([1, 1]);
    expect(llm.calls[0]?.opts?.requestId).toBe('ec_1:page-1');
    expect(llm.calls[1]?.opts?.requestId).toBe('ec_1:page-2');
  });
});

class ScriptedLlm implements LLMService {
  calls: Array<{ system: string; user: string; opts?: GenerateOptions }> = [];

  constructor(private readonly responses: string[]) {}

  async generate(system: string, user: string, opts?: GenerateOptions): Promise<GenerateResult> {
    this.calls.push({ system, user, opts });
    const text = this.responses.shift() ?? JSON.stringify(envelope);
    return {
      text,
      model: 'test-model',
      latencyMs: 5,
      tokensIn: 10,
      tokensOut: 20,
    };
  }

  async *generateStream() {
    yield { delta: '', done: true };
  }
}
