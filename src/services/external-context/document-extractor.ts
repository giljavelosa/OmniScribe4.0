import { stripJsonFence } from '@/lib/llm/strip-json-fence';
import { getLLMService, type ImageBlock, type LLMService } from '@/services/llm';
import {
  ExtractionJsonSchema,
  ExtractionEnvelopeSchema,
  MAX_EXTRACTION_ITEMS_PER_GROUP,
  MAX_OCR_TEXT_CHARS,
  type ExtractionJson,
  type ExtractionEnvelope,
} from '@/types/external-context-extraction';

export type DocumentExtractionResult = {
  envelope: ExtractionEnvelope;
  model: string;
  latencyMs: number;
  stub: boolean;
};

type ExtractArgs = {
  orgId: string;
  externalContextId: string;
  sourceLabel: string | null;
  images: ImageBlock[];
};

export class DocumentExtractor {
  constructor(private readonly llm: LLMService = getLLMService()) {}

  async extract(args: ExtractArgs): Promise<DocumentExtractionResult> {
    if (args.images.length > 1) {
      return this.extractPageByPage({
        args,
        priorLatencyMs: 0,
        fallbackModel: 'page-level',
      });
    }
    return this.extractWithRecovery(args, false);
  }

  private async extractWithRecovery(
    args: ExtractArgs,
    allowPageFallback: boolean,
  ): Promise<DocumentExtractionResult> {
    const systemPrompt = DOCUMENT_EXTRACTION_SYSTEM_PROMPT;
    const userPrompt = buildDocumentExtractionUserPrompt(args);

    const first = await this.llm.generate(systemPrompt, userPrompt, {
      phi: true,
      temperature: 0,
      maxTokens: 8192,
      model: 'sonnet',
      jsonMode: true,
      images: args.images,
      requestId: args.externalContextId,
      meter: {
        orgId: args.orgId,
        surface: 'worker.external-context-extraction',
      },
    });

    const parsed = parseExtractionEnvelope(first.text);
    if (parsed.ok) {
      return {
        envelope: parsed.value,
        model: first.model,
        latencyMs: first.latencyMs,
        stub: !!first.stub,
      };
    }

    const retry = await this.llm.generate(systemPrompt, buildValidationRetryPrompt(userPrompt, parsed.error), {
      phi: true,
      temperature: 0,
      maxTokens: 8192,
      model: 'sonnet',
      jsonMode: true,
      images: args.images,
      requestId: `${args.externalContextId}:validation-retry`,
      meter: {
        orgId: args.orgId,
        surface: 'worker.external-context-extraction.retry',
      },
    });

    const retryParsed = parseExtractionEnvelope(retry.text);
    if (!retryParsed.ok) {
      if (allowPageFallback && args.images.length > 1) {
        return this.extractPageByPage({
          args,
          priorLatencyMs: first.latencyMs + retry.latencyMs,
          fallbackModel: retry.model,
        });
      }
      return {
        envelope: buildManualReviewEnvelope({
          args,
          rawText: retry.text || first.text,
          validationError: retryParsed.error,
        }),
        model: retry.model,
        latencyMs: first.latencyMs + retry.latencyMs,
        stub: !!retry.stub,
      };
    }

    return {
      envelope: retryParsed.value,
      model: retry.model,
      latencyMs: first.latencyMs + retry.latencyMs,
      stub: !!retry.stub,
    };
  }

  private async extractPageByPage(args: {
    args: ExtractArgs;
    priorLatencyMs: number;
    fallbackModel: string;
  }): Promise<DocumentExtractionResult> {
    const pageResults = [];
    for (const [index, image] of args.args.images.entries()) {
      const sourcePage = image.sourcePage ?? index + 1;
      const result = await this.extractWithRecovery(
        {
          ...args.args,
          externalContextId: `${args.args.externalContextId}:page-${sourcePage}`,
          images: [image],
        },
        false,
      );
      pageResults.push({ sourcePage, result });
    }

    const envelope = mergePageExtractionResults(pageResults);
    const latencyMs =
      args.priorLatencyMs + pageResults.reduce((sum, page) => sum + page.result.latencyMs, 0);

    return {
      envelope,
      model: pageResults[0]?.result.model ?? args.fallbackModel,
      latencyMs,
      stub: pageResults.every((page) => page.result.stub),
    };
  }
}

const DOCUMENT_EXTRACTION_SYSTEM_PROMPT = `
You are OmniScribe's document OCR and clinical extraction engine.

Return JSON only. No markdown fences, preamble, or commentary.

Task:
1. Read the attached document page images.
2. Produce verbatim OCR text preserving clinically relevant wording.
3. Extract only facts visible in the document.
4. Do not diagnose, reconcile, normalize, or infer beyond source text.
5. Every clinical item must carry sourcePage, confidence, and verbatim text.
6. Cap each clinical array at 25 items.
7. Keep ocrText bounded to clinically relevant text by source page. Preserve exact clinical wording, but omit repeated headers, footers, and administrative boilerplate when needed to keep the JSON valid.
8. If multiple pages are attached, prioritize complete valid JSON over exhaustive OCR. Never truncate in the middle of a JSON string.

Output exactly:
{
  "ocrText": string,
  "extraction": {
    "documentType": "lab_report" | "referral_letter" | "discharge_summary" | "progress_note" | "imaging_report" | "medication_list" | "other" | "illegible",
    "summary": string,
    "diagnoses": [{ "text": string, "icdHint": string | null, "status": "active" | "historical" | "resolved" | "suspected" | "ruled_out" | "unknown", "sourcePage": number, "confidence": "high" | "medium" | "low", "verbatim": string }],
    "medications": [{ "name": string, "dose": string | null, "route": string | null, "frequency": string | null, "status": "current" | "discontinued" | "historical" | "planned" | "unknown", "sourcePage": number, "confidence": "high" | "medium" | "low", "verbatim": string }],
    "allergies": [{ "substance": string, "reaction": string | null, "severity": "mild" | "moderate" | "severe" | "unknown" | null, "sourcePage": number, "confidence": "high" | "medium" | "low", "verbatim": string }],
    "labs": [{ "name": string, "value": string, "unit": string | null, "referenceRange": string | null, "abnormalFlag": "normal" | "high" | "low" | "abnormal" | "critical" | "unknown" | null, "collectedDate": string | null, "sourcePage": number, "confidence": "high" | "medium" | "low", "verbatim": string }],
    "vitals": [{ "type": string, "value": string, "unit": string | null, "measuredDate": string | null, "sourcePage": number, "confidence": "high" | "medium" | "low", "verbatim": string }],
    "procedures": [{ "text": string, "date": string | null, "sourcePage": number, "confidence": "high" | "medium" | "low", "verbatim": string }],
    "documentDateGuess": string | null,
    "extractionNotes": string | null
  }
}

If the document is not clinically legible, set documentType="illegible", use a short summary, keep arrays empty, and explain the limitation in extractionNotes.
`.trim();

function buildDocumentExtractionUserPrompt(args: {
  externalContextId: string;
  sourceLabel: string | null;
  images: ImageBlock[];
}): string {
  const pageList = args.images
    .map((image) => `- sourcePage=${image.sourcePage ?? '?'} label=${image.label ?? 'document image'}`)
    .join('\n');
  return [
    `externalContextId: ${args.externalContextId}`,
    `sourceLabel: ${args.sourceLabel ?? 'not provided'}`,
    `attachedPages: ${args.images.length}`,
    pageList,
    '',
    'Extract the document into the strict JSON envelope.',
  ].join('\n');
}

function buildValidationRetryPrompt(originalPrompt: string, validationError: string): string {
  return [
    originalPrompt,
    '',
    'Your prior response did not match the required JSON schema.',
    `Validation error: ${validationError}`,
    'Return the corrected JSON envelope only.',
  ].join('\n');
}

function parseExtractionEnvelope(rawText: string): { ok: true; value: ExtractionEnvelope } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(stripJsonFence(rawText));
    const result = ExtractionEnvelopeSchema.safeParse(parsed);
    if (!result.success) {
      return { ok: false, error: result.error.issues.map((i) => i.message).join('; ') };
    }
    return { ok: true, value: result.data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'unknown JSON parse error',
    };
  }
}

function mergePageExtractionResults(
  pageResults: Array<{ sourcePage: number; result: DocumentExtractionResult }>,
): ExtractionEnvelope {
  if (pageResults.length === 0) {
    throw new Error('Document extraction fallback failed: no page results.');
  }

  const extractions = pageResults.map((page) => page.result.envelope.extraction);
  const firstExtraction = extractions[0]!;
  const firstNonIllegible =
    extractions.find((extraction) => extraction.documentType !== 'illegible') ?? firstExtraction;

  const notes = pageResults
    .map(({ sourcePage, result }) =>
      result.envelope.extraction.extractionNotes
        ? `Page ${sourcePage}: ${result.envelope.extraction.extractionNotes}`
        : null,
    )
    .filter((note): note is string => Boolean(note));
  notes.push('Merged from page-level extraction for this multi-page batch.');

  const extraction: ExtractionJson = ExtractionJsonSchema.parse({
    documentType: firstNonIllegible.documentType,
    summary: truncateForField(
      pageResults
        .map(({ sourcePage, result }) => `Page ${sourcePage}: ${result.envelope.extraction.summary}`)
        .join('\n'),
      2_000,
    ),
    diagnoses: capItems(extractions.flatMap((extraction) => extraction.diagnoses)),
    medications: capItems(extractions.flatMap((extraction) => extraction.medications)),
    allergies: capItems(extractions.flatMap((extraction) => extraction.allergies)),
    labs: capItems(extractions.flatMap((extraction) => extraction.labs)),
    vitals: capItems(extractions.flatMap((extraction) => extraction.vitals)),
    procedures: capItems(extractions.flatMap((extraction) => extraction.procedures)),
    documentDateGuess: extractions.find((extraction) => extraction.documentDateGuess)
      ?.documentDateGuess ?? null,
    extractionNotes: truncateForField(notes.join('\n'), 1_000),
  });

  return ExtractionEnvelopeSchema.parse({
    ocrText: truncateForField(
      pageResults
        .map(({ sourcePage, result }) => `Page ${sourcePage}\n${result.envelope.ocrText}`)
        .join('\n\n'),
      MAX_OCR_TEXT_CHARS,
    ),
    extraction,
  });
}

function buildManualReviewEnvelope(args: {
  args: ExtractArgs;
  rawText: string;
  validationError: string;
}): ExtractionEnvelope {
  const pageLabel = args.args.images
    .map((image, index) => image.sourcePage ?? index + 1)
    .join(', ');
  const rawText = stripJsonFence(args.rawText).trim();
  return ExtractionEnvelopeSchema.parse({
    ocrText: truncateForField(
      [
        `Pages requiring manual review: ${pageLabel || 'unknown'}.`,
        'The vision model returned text that could not be parsed as the required JSON envelope.',
        rawText,
      ]
        .filter(Boolean)
        .join('\n\n'),
      MAX_OCR_TEXT_CHARS,
    ),
    extraction: {
      documentType: 'other',
      summary: truncateForField(
        `Manual review required for page${args.args.images.length === 1 ? '' : 's'} ${pageLabel || 'unknown'} because the extraction response was not valid JSON.`,
        2_000,
      ),
      diagnoses: [],
      medications: [],
      allergies: [],
      labs: [],
      vitals: [],
      procedures: [],
      documentDateGuess: null,
      extractionNotes: truncateForField(
        `Structured extraction fallback used after invalid model JSON: ${args.validationError}`,
        1_000,
      ),
    },
  });
}

function capItems<T>(items: T[]): T[] {
  return items.slice(0, MAX_EXTRACTION_ITEMS_PER_GROUP);
}

function truncateForField(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, Math.max(0, max - 3)).trimEnd() + '...';
}
