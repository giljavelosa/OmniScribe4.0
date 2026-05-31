import { describe, expect, it } from 'vitest';

import {
  buildDeterministicExtractionEnvelope,
  TextDocumentExtractor,
} from '@/services/external-context/text-document-extractor';
import type { GenerateOptions, GenerateResult, LLMService } from '@/services/llm';

describe('TextDocumentExtractor', () => {
  it('uses the LLM abstraction for text-based extraction', async () => {
    const envelope = buildDeterministicExtractionEnvelope('Page 1\nJohn Alvarez\nTacrolimus trough 10.2 at target.');
    const llm = new ScriptedLlm(JSON.stringify(envelope));
    const extractor = new TextDocumentExtractor(llm);

    const result = await extractor.extract({
      orgId: 'org_1',
      externalContextId: 'ec_text',
      sourceLabel: 'Outside packet',
      text: 'Page 1\nJohn Alvarez\nTacrolimus trough 10.2 at target.',
      route: 'pdf_text_layer',
    });

    expect(result.envelope.extraction.labs[0]?.name).toBe('Tacrolimus trough');
    expect(llm.calls[0]?.opts?.phi).toBe(true);
    expect(llm.calls[0]?.opts?.images).toBeUndefined();
    expect(llm.calls[0]?.opts?.meter?.surface).toBe('worker.external-context-extraction.text');
  });

  it('falls back deterministically when the LLM returns a non-envelope response', async () => {
    const llm = new ScriptedLlm('{"stub":true}');
    const extractor = new TextDocumentExtractor(llm);

    const result = await extractor.extract({
      orgId: 'org_1',
      externalContextId: 'ec_text',
      sourceLabel: null,
      text: [
        'Page 1',
        'John Alvarez | MRN 14332 | DOB 03/14/1956 | Male',
        'Penicillin',
        'Heart transplant recipient - orthotopic heart transplant',
        'Creatinine 1.42, eGFR 53',
        'Timed Up and Go',
      ].join('\n'),
      route: 'pdf_text_layer',
    });

    expect(result.model).toContain('deterministic-text-fallback');
    expect(result.envelope.ocrText).toContain('John Alvarez');
    expect(result.envelope.extraction.allergies.map((item) => item.substance)).toContain('Penicillin');
    expect(result.envelope.extraction.diagnoses.map((item) => item.text)).toContain(
      'Heart transplant recipient / orthotopic heart transplant',
    );
    expect(result.envelope.extraction.labs.map((item) => item.name)).toContain('Creatinine');
    expect(result.envelope.extraction.procedures.map((item) => item.text)).toContain(
      'Timed Up and Go documented with cane',
    );
  });
});

class ScriptedLlm implements LLMService {
  calls: Array<{ system: string; user: string; opts?: GenerateOptions }> = [];

  constructor(private readonly response: string) {}

  async generate(system: string, user: string, opts?: GenerateOptions): Promise<GenerateResult> {
    this.calls.push({ system, user, opts });
    return {
      text: this.response,
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
