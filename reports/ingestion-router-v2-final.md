# Ingestion Router V2 Final Report

Date: 2026-05-29

## Files Changed

- Router/parsing services: `src/services/external-context/file-router.ts`, `pdf-text.ts`, `structured-file-text.ts`, `ocr-provider.ts`, `text-document-extractor.ts`
- Worker/upload integration: `src/workers/external-context-extraction/handler.ts`, `src/app/api/patients/[id]/external-context/route.ts`, `src/lib/external-context/validation.ts`, `src/lib/s3/client.ts`
- Deployment/provider wiring: `@aws-sdk/client-textract`, `.env.example`, `scripts/verify-providers.ts`
- Benchmark/reporting: `scripts/benchmark-ingestion.ts`, `package.json`, `reports/ingestion-router-v2-baseline.md`, `reports/ingestion-router-v2-benchmark.md`
- Fixtures/tests: `tests/fixtures/ingestion/OmniScribe_John_Alvarez_COMPREHENSIVE_SYNTHETIC_Medical_Record_Packet.pdf`, `test/services/file-router.test.ts`, `test/services/text-document-extractor.test.ts`, `test/services/ocr-provider.test.ts`, `test/workers/external-context-extraction-worker.test.ts`
- Docs: `context/architecture.md`, `context/specs/52-document-ingestion.md`, `context/specs/00-build-plan.md`, `context/progress-tracker.md`

## Feature Flag Behavior

- `OMNISCRIBE_FILE_ROUTER_V2` off: existing Unit 52 document behavior is preserved.
- `OMNISCRIBE_FILE_ROUTER_V2=true`: router V2 handles text PDFs and supported structured clinical files.
- Single image/lab screenshot uploads stay on the existing fast vision path.
- `OCR_PROVIDER=textract`: sparse/scanned PDFs use AWS Textract async OCR against the already-uploaded private S3 document object; text PDFs still bypass OCR.

## Router Decision Table

| Input | Route | OCR | Vision page batching |
|---|---|---:|---:|
| Single image/lab screenshot | `image_fast_path` | no | existing fast path only |
| PDF with usable text layer | `pdf_text_layer` | no | no |
| Sparse/scanned PDF | `pdf_ocr` | yes, via `OCR_PROVIDER=textract` in deployed envs | no |
| DOCX | `docx_text` | no | no |
| RTF | `rtf_text` | no | no |
| TXT | `txt_text` | no | no |
| CSV | `csv_table` | no | no |
| XLSX | `xlsx_table` | no | no |
| XML | `xml_structured` | no | no |
| JSON | `json_structured` | no | no |
| Unknown/corrupt unsupported | `unsupported_manual_review` | no | no |

## Baseline Results Before Changes

| Command | Result |
|---|---:|
| `npx prisma validate` | pass |
| `npm run typecheck` | pass |
| `npm run lint` | pass, 11 pre-existing warnings |
| `npm test` | pass after local Docker access, 125 files / 1136 tests |
| `npm run build` | pass after removing generated `.next/node_modules/.DS_Store` and allowing font fetch network |

## Final Verification

| Command | Result |
|---|---:|
| `npm test -- test/services/ocr-provider.test.ts test/services/file-router.test.ts test/workers/external-context-extraction-worker.test.ts` | pass, 18 tests |
| `npm run typecheck` | pass |
| `npm run lint` | pass, same 11 warnings |
| `npm run benchmark:ingestion` | pass, report written |
| `npm test` | pass, 128 files / 1152 tests |
| `npx prisma validate` | pass |
| `npm run build` | pass |

## Benchmark Table

| fixture_name | file_type | page_count | detected_route | text_layer_usable_yes_no | ocr_used_yes_no | extracted_character_count | extraction_duration_ms | ocr_duration_ms | normalization_duration_ms | llm_duration_ms | total_to_clinician_review_ready_ms | estimated_ocr_cost | estimated_llm_input_tokens | estimated_llm_output_tokens | estimated_llm_cost | benchmark_mode_mock_or_live | pass_fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Original 40-page John Alvarez synthetic PDF | pdf | 40 | pdf_text_layer | yes | no | 87808 | 10 | 0 | 9 | 5 | 15 | $0.0000 | 21952 | 1469 | $0.0000 | mock | pass |
| Scanned/image-only clone | skipped | 0 | skipped | no | no | 0 | 0 | 0 | 0 | 0 | 0 | $0.0000 | 0 | 0 | $0.0000 | mock | skipped: missing optional fixture |
| Single-page lab screenshot/image | skipped | 0 | skipped | no | no | 0 | 0 | 0 | 0 | 0 | 0 | $0.0000 | 0 | 0 | $0.0000 | mock | skipped: missing optional fixture |
| DOCX clinical note | skipped | 0 | skipped | no | no | 0 | 0 | 0 | 0 | 0 | 0 | $0.0000 | 0 | 0 | $0.0000 | mock | skipped: missing optional fixture |
| CSV lab file | skipped | 0 | skipped | no | no | 0 | 0 | 0 | 0 | 0 | 0 | $0.0000 | 0 | 0 | $0.0000 | mock | skipped: missing optional fixture |

## Required Confirmations

- Original 40-page PDF used direct text extraction: yes.
- Original 40-page PDF used OCR: no.
- Original 40-page PDF used vision page-by-page: no.
- Scanned PDF uses OCR route if scanned fixture exists: not run; optional fixture missing.
- Deployment OCR route is wired through AWS Textract: yes, behind `OCR_PROVIDER=textract`.
- Single-image/lab path did not regress: covered by router and worker tests; remains `image_fast_path`.
- Unapproved facts still do not feed Cleo/brief/scribe: existing Unit 52 verified-read gate unchanged; worker V2 writes `PARTIAL_EXTRACTION_REVIEW` and review batches, not `verifiedAt`.

## Skipped Tests

- Optional benchmark fixtures were missing:
  - `tests/fixtures/ingestion/OmniScribe_John_Alvarez_SCANNED_CLONE_150dpi_image_only.pdf`
  - `tests/fixtures/ingestion/single-page-lab-screenshot.png`
  - `tests/fixtures/ingestion/clinical-note.docx`
  - `tests/fixtures/ingestion/labs.csv`

## Deployment Wiring

Set these in deployed environments that should OCR scanned/image-only PDFs:

```bash
OMNISCRIBE_FILE_ROUTER_V2=true
OCR_PROVIDER=textract
S3_AUDIO_BUCKET=<private-document-and-audio-bucket>
AWS_REGION=us-east-1
TEXTRACT_REGION=us-east-1
```

Optional:

```bash
TEXTRACT_SNS_TOPIC_ARN=<sns-topic-arn>
TEXTRACT_SNS_ROLE_ARN=<textract-publish-role-arn>
TEXTRACT_JOB_TAG_PREFIX=omniscribe-document
TEXTRACT_OUTPUT_S3_BUCKET=<textract-output-bucket>
TEXTRACT_OUTPUT_S3_PREFIX=<prefix>
TEXTRACT_KMS_KEY_ID=<kms-key-id>
```

The worker IAM role needs document-object read access plus Textract async OCR permissions:

```text
textract:StartDocumentTextDetection
textract:GetDocumentTextDetection
s3:GetObject
```

If `TEXTRACT_SNS_TOPIC_ARN` / `TEXTRACT_SNS_ROLE_ARN` are set, the SNS topic must be in the same region as the Textract endpoint and the role must allow Textract to publish to that topic.
If `TEXTRACT_OUTPUT_S3_BUCKET` is set, the role also needs `s3:PutObject` on that output prefix and KMS permissions if `TEXTRACT_KMS_KEY_ID` is set.

## Remaining Risks

- AWS Textract is wired but not live-called locally in this run because starting a real Textract job requires deployed AWS credentials, S3 object access, and billable OCR.
- The provider now supports Textract SNS completion notification config, but the current worker still polls `GetDocumentTextDetection`. A later SQS/Lambda or delayed-BullMQ completion path should consume the notification to free the worker during long OCR jobs and avoid high-concurrency polling.
- Default local Prisma migration history remains divergent from prior work; no destructive migration action was taken.
- Benchmark mode is mock for LLM/OCR. Live LLM/OCR benchmarking should be added after Textract credentials and BAA-safe infra are configured.
- `npm install @aws-sdk/client-textract` reported 2 moderate npm audit findings; they were not part of this OCR wiring task.

## Exact Command To Run Next

```bash
OMNISCRIBE_FILE_ROUTER_V2=true OCR_PROVIDER=textract npm run dev:workers
```
