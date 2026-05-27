import type { Job } from 'bullmq';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { getPatientUploadBytes } from '@/lib/s3/client';
import { getLLMService } from '@/services/llm';
import { stripJsonFence } from '@/lib/llm/strip-json-fence';

type PatientUploadExtractJob = {
  orgId: string;
  uploadId: string;
};

const EXTRACTOR_VERSION = 'patient-upload-extract-v1';
const SUB_LLM_MAX_TOKENS = 1500;

/**
 * Sprint 0.19 / Tier 13 — patient-upload-extract BullMQ worker.
 *
 * Reads the upload row, fetches bytes from S3, invokes the vision LLM
 * (or PDF fallback), parses + writes back the structured extraction.
 *
 * Rule 10: 3 retries with exponential backoff (queue defaults).
 * Rule 8: writeAuditLog is NOT wrapped in a swallowing try/catch — a
 * failed audit fails the job (and BullMQ retries per rule 10).
 * Rule 7: NEVER deletes anything from S3 on failure — flips status to
 * EXTRACTION_FAILED + stores the (scrubbed, ≤600 char) error message.
 */
export async function handle(job: Job<PatientUploadExtractJob>) {
  const { orgId, uploadId } = job.data;

  const row = await prisma.patientUpload.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      orgId: true,
      patientId: true,
      kind: true,
      mimeType: true,
      filename: true,
      s3Bucket: true,
      s3Key: true,
      status: true,
      isDeleted: true,
    },
  });
  if (!row || row.orgId !== orgId) {
    console.warn(`[patient-upload-extract] upload ${uploadId} missing or org mismatch — dropping`);
    return { skipped: 'not_found_or_org_mismatch' };
  }
  if (row.isDeleted) {
    return { skipped: 'soft_deleted' };
  }
  if (row.status !== 'PENDING_EXTRACTION') {
    // Idempotency: already extracted (or in flight from a duplicate
    // enqueue). The unique jobId already prevents most dupes; this is
    // belt + suspenders.
    return { skipped: `status:${row.status}` };
  }

  await prisma.patientUpload.update({
    where: { id: uploadId },
    data: { status: 'EXTRACTING' },
  });

  let bytes: Buffer;
  try {
    bytes = await getPatientUploadBytes(row.s3Key);
  } catch (err) {
    return failExtraction(uploadId, row.kind, err, 's3_fetch_failed');
  }

  // Vision path — images only. PDF gets routed to text-only extraction
  // (the LLM service's extractFromImage path may reject PDFs; we'd
  // need a PDF text-extractor library for that lane. Stub for now:
  // mark MANUAL_ONLY so the clinician reviews directly.).
  if (row.mimeType === 'application/pdf') {
    await prisma.patientUpload.update({
      where: { id: uploadId },
      data: {
        status: 'MANUAL_ONLY',
        extractionErrorMessage:
          'PDF auto-extraction not yet supported. Open the file to review manually.',
      },
    });
    await writeAuditLog({
      orgId,
      action: 'PATIENT_UPLOAD_EXTRACTION_FAILED',
      resourceType: 'PatientUpload',
      resourceId: uploadId,
      metadata: {
        patientUploadId: uploadId,
        kind: row.kind,
        errorMessage: 'pdf_unsupported_v1',
      },
    });
    return { ok: false, reason: 'pdf_unsupported_v1' };
  }

  const llm = getLLMService();
  if (!llm.extractFromImage) {
    await prisma.patientUpload.update({
      where: { id: uploadId },
      data: {
        status: 'MANUAL_ONLY',
        extractionErrorMessage: 'Vision extraction not available in this environment.',
      },
    });
    await writeAuditLog({
      orgId,
      action: 'PATIENT_UPLOAD_EXTRACTION_FAILED',
      resourceType: 'PatientUpload',
      resourceId: uploadId,
      metadata: {
        patientUploadId: uploadId,
        kind: row.kind,
        errorMessage: 'vision_unavailable',
      },
    });
    return { ok: false, reason: 'vision_unavailable' };
  }

  const systemPrompt = systemPromptFor(row.kind);
  const userPrompt = [
    `<upload_kind>${row.kind}</upload_kind>`,
    `<filename>${row.filename ?? '(unspecified)'}</filename>`,
    'Extract the structured fields described in the system prompt. Output strict JSON only.',
  ].join('\n\n');

  let result;
  try {
    result = await llm.extractFromImage(systemPrompt, userPrompt, {
      phi: true,
      temperature: 0,
      jsonMode: true,
      maxTokens: SUB_LLM_MAX_TOKENS,
      model: 'haiku',
      meter: { orgId, surface: `worker.patientUploadExtract.${row.kind.toLowerCase()}` },
      images: [
        {
          mediaType: row.mimeType,
          base64: bytes.toString('base64'),
        },
      ],
    });
  } catch (err) {
    return failExtraction(uploadId, row.kind, err, 'vision_call_failed');
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stripJsonFence(result.text));
  } catch {
    return failExtraction(uploadId, row.kind, new Error('json_parse_failed'), 'json_parse_failed');
  }

  // Count extracted top-level fields for audit metadata (PHI-free).
  const extractedFieldsCount =
    parsed && typeof parsed === 'object' ? Object.keys(parsed as Record<string, unknown>).length : 0;

  await prisma.patientUpload.update({
    where: { id: uploadId },
    data: {
      status: 'EXTRACTED',
      extractedJson: parsed as never,
      extractionErrorMessage: null,
    },
  });

  await writeAuditLog({
    orgId,
    action: 'PATIENT_UPLOAD_EXTRACTED',
    resourceType: 'PatientUpload',
    resourceId: uploadId,
    metadata: {
      patientUploadId: uploadId,
      kind: row.kind,
      extractedFieldsCount,
      extractorVersion: EXTRACTOR_VERSION,
      stub: !!result.stub,
    },
  });

  return { ok: true, uploadId, kind: row.kind };
}

async function failExtraction(
  uploadId: string,
  kind: string,
  err: unknown,
  errorCode: string,
) {
  const raw = err instanceof Error ? err.message : String(err);
  // Scrub bearer-token-shaped fragments (rule of thumb from FHIR client).
  const scrubbed = raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer <redacted>')
    .slice(0, 600);
  await prisma.patientUpload.update({
    where: { id: uploadId },
    data: {
      status: 'EXTRACTION_FAILED',
      extractionErrorMessage: `${errorCode}: ${scrubbed}`,
    },
  });
  await writeAuditLog({
    action: 'PATIENT_UPLOAD_EXTRACTION_FAILED',
    resourceType: 'PatientUpload',
    resourceId: uploadId,
    orgId: '',
    metadata: { patientUploadId: uploadId, kind, errorMessage: `${errorCode}: ${scrubbed}` },
  });
  throw err instanceof Error ? err : new Error(scrubbed);
}

function systemPromptFor(kind: string): string {
  switch (kind) {
    case 'MED_LIST':
      return `
You are an OCR + structuring assistant. The image is a list of medications
(handwritten or printed). Extract every medication with its dose, frequency,
and route when present. Use plain-language English drug names; preserve
dose units exactly as written.

OUTPUT FORMAT (strict JSON, nothing else):
{ "medications": [
    { "name": "<drug>", "dose": "<text>?", "frequency": "<text>?", "route": "<text>?" }, ...
  ] }
`.trim();
    case 'LAB_REPORT':
      return `
You are an OCR + structuring assistant for a lab report. Extract every
lab with its value, unit, reference range, and flag (H/L/A/N) when
present. Capture the collection date if visible.

OUTPUT FORMAT (strict JSON, nothing else):
{ "collectionDateIso": "<YYYY-MM-DD?>",
  "labs": [
    { "name": "<analyte>", "value": "<text>", "unit": "<text>?", "refLow": "<text>?", "refHigh": "<text>?", "flag": "H"|"L"|"A"|"N"?, "dateIso": "<YYYY-MM-DD>?" }, ...
  ] }
`.trim();
    case 'IMAGING_REPORT':
      return `
You are an OCR + structuring assistant for an imaging report. Extract
the study type, date, findings, and impression. Preserve clinical phrasing
verbatim where possible.

OUTPUT FORMAT (strict JSON, nothing else):
{ "studyType": "<text>", "dateIso": "<YYYY-MM-DD?>", "findings": "<text>", "impression": "<text>" }
`.trim();
    case 'INSURANCE_CARD':
      return `
You are an OCR + structuring assistant for an insurance card. Extract
the carrier, member ID, group ID, and plan name. NEVER fabricate IDs.

OUTPUT FORMAT (strict JSON, nothing else):
{ "carrier": "<text>", "memberId": "<text>", "groupId": "<text>?", "planName": "<text>?" }
`.trim();
    case 'ID_CARD':
      return `
You are an OCR + structuring assistant for a government ID. Extract
last name, first name, DOB, and ID number. NEVER fabricate.

OUTPUT FORMAT (strict JSON, nothing else):
{ "lastName": "<text>", "firstName": "<text>", "dob": "<YYYY-MM-DD?>", "idNumber": "<text>?" }
`.trim();
    case 'OUTSIDE_RECORDS':
      return `
You are an OCR + structuring assistant for an outside medical record.
Provide a brief paraphrased summary (≤200 words), the document date if
visible, and a list of any explicit diagnoses + medications mentioned.

OUTPUT FORMAT (strict JSON, nothing else):
{ "summary": "<text>", "dateIso": "<YYYY-MM-DD?>",
  "diagnoses": [ "<text>", ... ], "medications": [ "<text>", ... ] }
`.trim();
    default:
      return `
You are an OCR assistant. Extract any structured fields visible in the
image. Return a JSON object with whatever top-level keys best describe
the document. NEVER fabricate.

OUTPUT FORMAT (strict JSON, nothing else):
{ "summary": "<text>" }
`.trim();
  }
}
