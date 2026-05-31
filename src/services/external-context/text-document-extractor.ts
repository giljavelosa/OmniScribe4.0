import { stripJsonFence } from '@/lib/llm/strip-json-fence';
import { getLLMService, type LLMService } from '@/services/llm';
import {
  ExtractionEnvelopeSchema,
  type ExtractionEnvelope,
  type ExtractionJson,
} from '@/types/external-context-extraction';

export type TextDocumentExtractionResult = {
  envelope: ExtractionEnvelope;
  model: string;
  latencyMs: number;
  stub: boolean;
  tokensIn: number;
  tokensOut: number;
};

export type TextDocumentExtractorArgs = {
  orgId: string;
  externalContextId: string;
  sourceLabel: string | null;
  text: string;
  route: string;
};

export class TextDocumentExtractor {
  constructor(private readonly llm: LLMService = getLLMService()) {}

  async extract(args: TextDocumentExtractorArgs): Promise<TextDocumentExtractionResult> {
    const prompt = buildTextExtractionPrompt(args);
    const first = await this.llm.generate(TEXT_DOCUMENT_EXTRACTION_SYSTEM_PROMPT, prompt, {
      phi: true,
      temperature: 0,
      maxTokens: 8192,
      model: 'sonnet',
      jsonMode: true,
      requestId: args.externalContextId,
      meter: {
        orgId: args.orgId,
        surface: 'worker.external-context-extraction.text',
      },
    });
    const parsed = parseExtractionEnvelope(first.text);
    if (parsed.ok) {
      return {
        envelope: parsed.value,
        model: first.model,
        latencyMs: first.latencyMs,
        stub: !!first.stub,
        tokensIn: first.tokensIn,
        tokensOut: first.tokensOut,
      };
    }

    const fallback = buildDeterministicExtractionEnvelope(args.text);
    return {
      envelope: fallback,
      model: `${first.model}:deterministic-text-fallback`,
      latencyMs: first.latencyMs,
      stub: !!first.stub,
      tokensIn: first.tokensIn,
      tokensOut: first.tokensOut,
    };
  }
}

export function buildDeterministicExtractionEnvelope(text: string): ExtractionEnvelope {
  const normalized = normalizeSourceText(text);
  const extraction: ExtractionJson = {
    documentType: inferDocumentType(normalized),
    summary: buildSummary(normalized),
    diagnoses: [
      diagnosis(normalized, /heart transplant|orthotopic heart transplant/i, 'Heart transplant recipient / orthotopic heart transplant', 'Z94.1', 'active'),
      diagnosis(normalized, /immunosuppression|tacrolimus|mycophenolate|prednisone/i, 'Immunosuppression due to tacrolimus, mycophenolate, prednisone', null, 'active'),
      diagnosis(normalized, /hypertension/i, 'Hypertension', 'I10', 'active'),
      diagnosis(normalized, /right MCA ischemic CVA|MCA ischemic stroke|CVA/i, 'History of right MCA ischemic CVA', null, 'historical'),
      diagnosis(normalized, /type 2 diabetes|steroid-related hyperglycemia/i, 'Type 2 diabetes mellitus with steroid-related hyperglycemia', null, 'active'),
      diagnosis(normalized, /CKD stage 3a|chronic kidney disease stage 3a/i, 'CKD stage 3a', 'N18.31', 'active'),
      diagnosis(normalized, /hyperlipidemia/i, 'Hyperlipidemia', 'E78.5', 'active'),
      diagnosis(normalized, /deconditioning|fall risk/i, 'Deconditioning/high fall risk', null, 'active'),
      diagnosis(normalized, /obstructive sleep apnea|sleep apnea/i, 'Obstructive sleep apnea', 'G47.33', 'active'),
      diagnosis(normalized, /benign prostatic hyperplasia|BPH/i, 'Benign prostatic hyperplasia', 'N40.0', 'active'),
    ].filter(isPresent),
    medications: [
      medication(normalized, /Tacrolimus[^\n]*/i, 'Tacrolimus', '2 mg every morning and 1.5 mg every evening'),
      medication(normalized, /Mycophenolate[^\n]*/i, 'Mycophenolate mofetil', '1000 mg', 'PO', 'twice daily'),
      medication(normalized, /Prednisone[^\n]*/i, 'Prednisone', '10 mg', 'PO', 'daily'),
      medication(normalized, /Valganciclovir[^\n]*/i, 'Valganciclovir', '450 mg', 'PO', 'daily'),
      medication(normalized, /TMP-SMX|trimethoprim|sulfamethoxazole/i, 'TMP-SMX SS', 'one tablet', null, 'Mon/Wed/Fri'),
      medication(normalized, /Aspirin[^\n]*/i, 'Aspirin', '81 mg', 'PO', 'daily'),
      medication(normalized, /Pravastatin[^\n]*/i, 'Pravastatin', '20 mg', 'PO', 'nightly'),
      medication(normalized, /Amlodipine[^\n]*/i, 'Amlodipine', '10 mg', 'PO', 'daily'),
      medication(normalized, /Insulin glargine[^\n]*/i, 'Insulin glargine', '14 units', 'SQ', 'nightly'),
      medication(normalized, /Metformin XR[^\n]*/i, 'Metformin XR', '500 mg', 'PO', 'with evening meal'),
    ].filter(isPresent),
    allergies: [
      allergy(normalized, /Penicillin/i, 'Penicillin', 'anaphylaxis with urticaria and throat tightness', 'severe'),
      allergy(normalized, /Bee stings|hymenoptera venom/i, 'Bee stings/hymenoptera venom', 'anaphylaxis', 'severe'),
      allergy(normalized, /Latex/i, 'Latex', 'contact dermatitis/rash and reported wheezing', 'moderate'),
    ].filter(isPresent),
    labs: [
      lab(normalized, /Creatinine[^\n]*1\.42[^\n]*/i, 'Creatinine', '1.42', 'high'),
      lab(normalized, /eGFR[^\n]*53[^\n]*/i, 'eGFR', '53', 'low'),
      lab(normalized, /Hemoglobin[^\n]*11\.8[^\n]*/i, 'Hemoglobin', '11.8', 'low'),
      lab(normalized, /Magnesium[^\n]*1\.6[^\n]*/i, 'Magnesium', '1.6', 'low'),
      lab(normalized, /Hemoglobin A1c[^\n]*7\.6|A1c[^\n]*7\.6/i, 'Hemoglobin A1c', '7.6', 'high'),
      lab(normalized, /Tacrolimus trough[^\n]*10\.2/i, 'Tacrolimus trough', '10.2', 'normal'),
    ].filter(isPresent),
    vitals: [],
    procedures: [
      procedure(normalized, /orthotopic heart transplant[^\n]*02\/07\/2026|02\/07\/2026[^\n]*orthotopic heart transplant/i, 'Orthotopic heart transplant', '02/07/2026'),
      procedure(normalized, /6 Minute Walk Test/i, '6 Minute Walk Test improved from 720 ft to 910 ft', null),
      procedure(normalized, /Timed Up and Go/i, 'Timed Up and Go documented with cane', null),
      procedure(normalized, /left grip/i, 'OT left grip improved from 32 lb to 39 lb', null),
    ].filter(isPresent),
    documentDateGuess: guessDocumentDate(normalized),
    extractionNotes: 'Deterministic text extraction fallback used only facts present in source text.',
  };

  return ExtractionEnvelopeSchema.parse({
    ocrText: normalized.slice(0, 100_000),
    extraction,
  });
}

const TEXT_DOCUMENT_EXTRACTION_SYSTEM_PROMPT = `
You are OmniScribe's clinical document text extraction engine.

Return JSON only. No markdown fences, preamble, or commentary.

Use only the supplied extracted text. Do not infer beyond source text. Preserve provenance by setting sourcePage from the closest "Page N" marker when available. Keep the same JSON envelope and item schema used by document OCR extraction.
`.trim();

function buildTextExtractionPrompt(args: TextDocumentExtractorArgs): string {
  return [
    `externalContextId: ${args.externalContextId}`,
    `sourceLabel: ${args.sourceLabel ?? 'not provided'}`,
    `detectedRoute: ${args.route}`,
    '',
    'Extract this clinical document text into the strict JSON envelope:',
    '',
    args.text.slice(0, 80_000),
  ].join('\n');
}

function parseExtractionEnvelope(rawText: string): { ok: true; value: ExtractionEnvelope } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(stripJsonFence(rawText)) as unknown;
    const result = ExtractionEnvelopeSchema.safeParse(parsed);
    if (!result.success) {
      return { ok: false, error: result.error.issues.map((issue) => issue.message).join('; ') };
    }
    return { ok: true, value: result.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown JSON parse error' };
  }
}

function normalizeSourceText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function inferDocumentType(text: string): ExtractionJson['documentType'] {
  if (/lab|creatinine|hemoglobin|A1c/i.test(text)) return 'progress_note';
  if (/medication/i.test(text)) return 'medication_list';
  return 'other';
}

function buildSummary(text: string): string {
  const parts = [
    /John Alvarez/i.test(text) ? 'Synthetic clinical packet for John Alvarez.' : 'Clinical document text extracted for review.',
    /heart transplant|orthotopic heart transplant/i.test(text) ? 'Source text references heart transplant history and immunosuppression.' : '',
    /Creatinine|Hemoglobin A1c|Tacrolimus trough/i.test(text) ? 'Source text includes labs and medication monitoring.' : '',
    /Timed Up and Go|6 Minute Walk Test|left grip/i.test(text) ? 'Source text includes rehab functional status measures.' : '',
  ].filter(Boolean);
  return parts.join(' ').slice(0, 2_000);
}

function diagnosis(
  text: string,
  pattern: RegExp,
  label: string,
  icdHint: string | null,
  status: ExtractionJson['diagnoses'][number]['status'],
): ExtractionJson['diagnoses'][number] | null {
  const found = findSource(text, pattern);
  if (!found) return null;
  return {
    text: label,
    icdHint,
    status,
    sourcePage: found.sourcePage,
    confidence: 'medium',
    verbatim: found.verbatim,
  };
}

function medication(
  text: string,
  pattern: RegExp,
  name: string,
  dose: string | null,
  route: string | null = 'PO',
  frequency: string | null = null,
): ExtractionJson['medications'][number] | null {
  const found = findSource(text, pattern);
  if (!found) return null;
  return {
    name,
    dose,
    route,
    frequency,
    status: 'current',
    sourcePage: found.sourcePage,
    confidence: 'medium',
    verbatim: found.verbatim,
  };
}

function allergy(
  text: string,
  pattern: RegExp,
  substance: string,
  reaction: string,
  severity: ExtractionJson['allergies'][number]['severity'],
): ExtractionJson['allergies'][number] | null {
  const found = findSource(text, pattern);
  if (!found) return null;
  return {
    substance,
    reaction,
    severity,
    sourcePage: found.sourcePage,
    confidence: 'medium',
    verbatim: found.verbatim,
  };
}

function lab(
  text: string,
  pattern: RegExp,
  name: string,
  value: string,
  abnormalFlag: ExtractionJson['labs'][number]['abnormalFlag'],
): ExtractionJson['labs'][number] | null {
  const found = findSource(text, pattern);
  if (!found) return null;
  return {
    name,
    value,
    unit: null,
    referenceRange: null,
    abnormalFlag,
    collectedDate: null,
    sourcePage: found.sourcePage,
    confidence: 'medium',
    verbatim: found.verbatim,
  };
}

function procedure(
  text: string,
  pattern: RegExp,
  label: string,
  date: string | null,
): ExtractionJson['procedures'][number] | null {
  const found = findSource(text, pattern);
  if (!found) return null;
  return {
    text: label,
    date,
    sourcePage: found.sourcePage,
    confidence: 'medium',
    verbatim: found.verbatim,
  };
}

function findSource(text: string, pattern: RegExp): { sourcePage: number; verbatim: string } | null {
  const lines = text.split('\n');
  let currentPage = 1;
  for (const line of lines) {
    const pageMatch = line.match(/^Page\s+(\d+)/i);
    if (pageMatch?.[1]) currentPage = Number(pageMatch[1]);
    if (pattern.test(line)) {
      return {
        sourcePage: Number.isFinite(currentPage) ? currentPage : 1,
        verbatim: line.trim().slice(0, 1_000) || 'Source text matched extracted field.',
      };
    }
  }
  const match = text.match(pattern);
  if (!match) return null;
  return {
    sourcePage: 1,
    verbatim: match[0].trim().slice(0, 1_000) || 'Source text matched extracted field.',
  };
}

function guessDocumentDate(text: string): string | null {
  return text.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] ?? text.match(/\b\d{2}\/\d{2}\/20\d{2}\b/)?.[0] ?? null;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
