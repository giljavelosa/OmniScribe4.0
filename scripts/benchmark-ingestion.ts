import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { routeClinicalFile, type FileRouterDecision } from '@/services/external-context/file-router';
import { MockOcrProvider } from '@/services/external-context/ocr-provider';
import { buildDeterministicExtractionEnvelope } from '@/services/external-context/text-document-extractor';

type BenchmarkRow = {
  fixture_name: string;
  file_type: string;
  page_count: string;
  detected_route: string;
  text_layer_usable_yes_no: string;
  ocr_used_yes_no: string;
  extracted_character_count: string;
  extraction_duration_ms: string;
  ocr_duration_ms: string;
  normalization_duration_ms: string;
  llm_duration_ms: string;
  total_to_clinician_review_ready_ms: string;
  estimated_ocr_cost: string;
  estimated_llm_input_tokens: string;
  estimated_llm_output_tokens: string;
  estimated_llm_cost: string;
  benchmark_mode_mock_or_live: string;
  pass_fail: string;
};

const mandatoryFixture = 'tests/fixtures/ingestion/OmniScribe_John_Alvarez_COMPREHENSIVE_SYNTHETIC_Medical_Record_Packet.pdf';
const optionalFixtures = [
  {
    name: 'Scanned/image-only clone',
    path: 'tests/fixtures/ingestion/OmniScribe_John_Alvarez_SCANNED_CLONE_150dpi_image_only.pdf',
    mimeType: 'application/pdf',
  },
  {
    name: 'Single-page lab screenshot/image',
    path: 'tests/fixtures/ingestion/single-page-lab-screenshot.png',
    mimeType: 'image/png',
  },
  {
    name: 'DOCX clinical note',
    path: 'tests/fixtures/ingestion/clinical-note.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  {
    name: 'CSV lab file',
    path: 'tests/fixtures/ingestion/labs.csv',
    mimeType: 'text/csv',
  },
];

const ocrPricePerPage = Number(process.env.TEXTRACT_DETECT_DOCUMENT_TEXT_PER_PAGE_USD ?? '0.0015');
const llmInputPer1k = Number(process.env.INGESTION_BENCHMARK_LLM_INPUT_USD_PER_1K ?? '0');
const llmOutputPer1k = Number(process.env.INGESTION_BENCHMARK_LLM_OUTPUT_USD_PER_1K ?? '0');

async function main() {
  if (!existsSync(mandatoryFixture)) {
    mkdirSync(path.dirname(mandatoryFixture), { recursive: true });
    throw new Error(
      'Gil, place the 40-page John Alvarez synthetic PDF at tests/fixtures/ingestion/OmniScribe_John_Alvarez_COMPREHENSIVE_SYNTHETIC_Medical_Record_Packet.pdf, then rerun this goal.',
    );
  }

  const rows: BenchmarkRow[] = [];
  rows.push(
    await benchmarkFixture({
      fixtureName: 'Original 40-page John Alvarez synthetic PDF',
      fixturePath: mandatoryFixture,
      mimeType: 'application/pdf',
      mandatory: true,
    }),
  );

  for (const fixture of optionalFixtures) {
    if (!existsSync(fixture.path)) {
      rows.push(skippedRow(fixture.name, fixture.path));
      continue;
    }
    rows.push(
      await benchmarkFixture({
        fixtureName: fixture.name,
        fixturePath: fixture.path,
        mimeType: fixture.mimeType,
        mandatory: false,
      }),
    );
  }

  const markdown = renderMarkdown(rows);
  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/ingestion-router-v2-benchmark.md', markdown);
  console.log(markdown);
}

async function benchmarkFixture(args: {
  fixtureName: string;
  fixturePath: string;
  mimeType: string;
  mandatory: boolean;
}): Promise<BenchmarkRow> {
  const bytes = readFileSync(args.fixturePath);
  const totalStarted = performance.now();
  const decision = await routeClinicalFile({
    documentId: path.basename(args.fixturePath),
    bytes,
    mimeType: args.mimeType,
    fileName: args.fixturePath,
    ocrProvider: new MockOcrProvider('Mock OCR text for scanned benchmark fixture.'),
  });

  const llmStarted = performance.now();
  const envelope = decision.text ? buildDeterministicExtractionEnvelope(decision.text) : null;
  const llmDurationMs = Math.round(performance.now() - llmStarted);
  const totalMs = Math.round(performance.now() - totalStarted);
  const estimatedInputTokens = Math.ceil(decision.text.length / 4);
  const estimatedOutputTokens = Math.ceil(JSON.stringify(envelope?.extraction ?? {}).length / 4);
  const passFail = args.mandatory ? mandatoryPassFail(decision) : optionalPassFail(decision);

  return {
    fixture_name: args.fixtureName,
    file_type: decision.fileType,
    page_count: String(decision.pageCount),
    detected_route: decision.route,
    text_layer_usable_yes_no: yesNo(decision.textLayerUsable),
    ocr_used_yes_no: yesNo(decision.ocrUsed),
    extracted_character_count: String(decision.text.length),
    extraction_duration_ms: String(decision.timings.extractionDurationMs),
    ocr_duration_ms: String(decision.timings.ocrDurationMs),
    normalization_duration_ms: String(decision.timings.normalizationDurationMs),
    llm_duration_ms: String(llmDurationMs),
    total_to_clinician_review_ready_ms: String(totalMs),
    estimated_ocr_cost: formatUsd(decision.ocrUsed ? decision.pageCount * ocrPricePerPage : 0),
    estimated_llm_input_tokens: String(estimatedInputTokens),
    estimated_llm_output_tokens: String(estimatedOutputTokens),
    estimated_llm_cost: formatUsd((estimatedInputTokens / 1_000) * llmInputPer1k + (estimatedOutputTokens / 1_000) * llmOutputPer1k),
    benchmark_mode_mock_or_live: 'mock',
    pass_fail: passFail,
  };
}

function mandatoryPassFail(decision: FileRouterDecision): string {
  const text = decision.text.replace(/\s+/g, ' ');
  const goldenChecks = [
    'John Alvarez',
    'MRN 14332',
    'DOB 03/14/1956',
    'Penicillin',
    'orthotopic heart transplant',
    'Tacrolimus',
    'Creatinine 1.42',
    'Timed Up and Go',
    '6 Minute Walk Test',
  ];
  const missing = goldenChecks.filter((check) => !text.includes(check));
  if (decision.route !== 'pdf_text_layer') return `fail: expected pdf_text_layer, got ${decision.route}`;
  if (decision.ocrUsed) return 'fail: OCR used for text-based PDF';
  if (decision.timings.extractionDurationMs >= 5_000) return 'fail: pre-LLM extraction exceeded 5 seconds';
  if (missing.length > 0) return `fail: missing golden text ${missing.join(', ')}`;
  return 'pass';
}

function optionalPassFail(decision: FileRouterDecision): string {
  if (decision.route === 'image_fast_path') return 'pass';
  if (decision.route === 'unsupported_manual_review') return 'manual-review';
  return decision.text.length > 0 ? 'pass' : 'fail: no extracted text';
}

function skippedRow(name: string, fixturePath: string): BenchmarkRow {
  return {
    fixture_name: name,
    file_type: 'skipped',
    page_count: '0',
    detected_route: 'skipped',
    text_layer_usable_yes_no: 'no',
    ocr_used_yes_no: 'no',
    extracted_character_count: '0',
    extraction_duration_ms: '0',
    ocr_duration_ms: '0',
    normalization_duration_ms: '0',
    llm_duration_ms: '0',
    total_to_clinician_review_ready_ms: '0',
    estimated_ocr_cost: '$0.0000',
    estimated_llm_input_tokens: '0',
    estimated_llm_output_tokens: '0',
    estimated_llm_cost: '$0.0000',
    benchmark_mode_mock_or_live: 'mock',
    pass_fail: `skipped: missing optional fixture ${fixturePath}`,
  };
}

function renderMarkdown(rows: BenchmarkRow[]): string {
  const headers = Object.keys(rows[0] ?? skippedRow('none', 'none')) as Array<keyof BenchmarkRow>;
  const table = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${headers.map((header) => escapeCell(row[header])).join(' | ')} |`),
  ].join('\n');

  return [
    '# Ingestion Router V2 Benchmark',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Mode: mock LLM/OCR unless live provider environment variables are explicitly wired in future work.',
    '',
    table,
    '',
  ].join('\n');
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
