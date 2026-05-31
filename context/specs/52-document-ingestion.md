# Unit 52: Document Upload + OCR Extraction + Clinician Vetting

> **Wave 1 follow-on / ExternalContext expansion.** Not Wave 7/8 polish-gate work. This unit adds a third ExternalContext ingestion path: uploaded PDFs/images and tablet camera captures become OCR + structured extraction only after clinician vetting.

**Status (2026-05-29): complete.** PR1–PR7 scope is implemented end to end. Follow-up batch review for long PDFs is also implemented: documents process in clinician-vetted page batches before final document verification. Router V2 is now available behind `OMNISCRIBE_FILE_ROUTER_V2`: text-based PDFs extract embedded text directly, structured files parse without OCR, sparse PDFs route to the OCR-provider abstraction, and single images remain on the existing fast vision path. Verified documents now also persist page-addressable text in `ExternalContextDocumentPage`, so Miss Cleo can cite or show a specific verified page rather than relying only on the structured summary. Local DB-backed verification used scratch database `omniscribe_unit52_verify` because the default dev DB migration history is divergent; see `context/progress-tracker.md` for the exact verification log and migration blocker.

## Goal

Clinicians need patient-specific context from referral letters, lab reports, discharge summaries, medication lists, prior notes, and photographed documents without relying on EHR integration. OmniScribe already supports ExternalContext from pasted text and uploaded audio. This unit adds document ingestion:

1. Upload PDFs/JPG/PNG or capture tablet photos.
2. Store originals under the existing private S3 bucket.
3. Rasterize PDFs in the worker and call Claude vision through `src/services/llm/`.
4. Return verbatim OCR plus structured clinical extraction.
5. Require clinician review/correction before approval.
6. Save approved/vetted payloads to the patient's chart.
7. Make only verified documents readable by Miss Cleo and note briefs.

The non-negotiable rule: **unvetted extraction is invisible downstream.** For document ExternalContext rows, `verifiedAt != null` is the read gate for Cleo and brief context.

## Design

### Source Model

Reuse `ExternalContext`; do not create a parallel model. Add `mediaKind` as the discriminator:

- `PASTE` — existing clinician-pasted text.
- `AUDIO` — existing uploaded audio awaiting/after transcription.
- `DOCUMENT` — new file/photo document ingestion.

Verification is orthogonal to lifecycle. `status` tells where the row is in processing; `verifiedAt` tells whether it may be used by Cleo/briefs.

Document statuses append to `ExternalContextStatus`:

- `PENDING_EXTRACTION` — document bytes landed in S3, extraction job queued.
- `PARTIAL_EXTRACTION_REVIEW` — one page batch is extracted and paused for clinician review/correction.
- `EXTRACTED` — OCR/extraction complete, awaiting clinician vetting.
- `EXTRACTION_FAILED` — rasterization or Claude extraction failed.

### Batch Review Follow-Up

Long documents are not sent to Claude as one large vision request. The worker caps processing at 100 pages and splits pages into 5-page extraction batches. Each batch is represented by `ExternalContextExtractionBatch` with:

- `batchIndex`, `pageStart`, `pageEnd`, and `status`.
- batch OCR text, raw extraction JSON, model, and extracted timestamp.
- clinician-vetted extraction JSON, reviewer, and reviewed timestamp.

Workflow:

1. Upload creates the `ExternalContext` row and enqueues extraction.
2. The worker rasterizes and extracts the first batch only.
3. The document row moves to `PARTIAL_EXTRACTION_REVIEW`.
4. The clinician compares source/OCR/extracted fields, edits structured fields, and approves the batch via AlertDialog.
5. Only then does the app enqueue the next batch.
6. After the final batch is reviewed, OmniScribe merges all vetted batch payloads into the document-level `extractionJson` and moves the row to `EXTRACTED`.
7. The clinician still performs final document verification. Only that final verification sets `verifiedAt` and makes the document visible to Cleo/briefs.

Partial batch review is not final verification. Batches in `NEEDS_REVIEW` or `REVIEWED` state are internal extraction workflow state and never feed downstream clinical context.

### Router V2 Follow-Up

`OMNISCRIBE_FILE_ROUTER_V2` gates the safer clinical file ingestion router:

- Single image/lab screenshot uploads keep the current Unit 52 fast vision extraction behavior.
- Text-based PDFs use embedded PDF text extraction first and skip OCR/vision page batching when the text layer is usable.
- Sparse/scanned PDFs route to the OCR-provider abstraction for whole-document OCR. `OCR_PROVIDER=textract` enables AWS Textract async OCR against the existing private S3 document object; tests and benchmarks use a deterministic mock OCR provider.
- DOCX, RTF, TXT, CSV, XLSX, XML, and JSON parse directly to text/tables when the flag is on.
- LLM structuring for multi-page text records uses extracted text through `src/services/llm/`; page images are only used for the existing image fast path or fallback paths.
- Clinician review and final `verifiedAt != null` downstream read gate remain unchanged.

### Extraction Envelope

Claude vision performs OCR and structured extraction in one pass. The validated envelope is:

```ts
{
  ocrText: string;
  extraction: {
    documentType: 'lab_report' | 'referral_letter' | 'discharge_summary' | 'progress_note' | 'imaging_report' | 'medication_list' | 'other' | 'illegible';
    summary: string;
    diagnoses: Diagnosis[];
    medications: Medication[];
    allergies: Allergy[];
    labs: Lab[];
    vitals: Vital[];
    procedures: Procedure[];
    documentDateGuess: string | null;
    extractionNotes: string | null;
  };
}
```

Every clinical item carries provenance:

```ts
{
  sourcePage: number;
  confidence: 'high' | 'medium' | 'low';
  verbatim: string;
}
```

Each clinical array is capped at 25 items in v1 to keep prompts, UI review, and audit payloads bounded.

### Rule 20 Extension

Miss Cleo may read clinician-verified ExternalContext documents only when:

- `mediaKind = DOCUMENT`
- `verifiedAt IS NOT NULL`
- `deletedAt IS NULL`
- payload comes from `vettedExtractionJson` when available

Unverified `EXTRACTED` rows, failed rows, and deleted rows are excluded from Cleo and from note briefs.

For searchable-document behavior, the worker stores one `ExternalContextDocumentPage` row per source page whenever extraction produces page text. Existing verified rows can be lazily backfilled from `ExternalContext.ocrText`. Cleo page requests such as "show me page 5" call `lookupVerifiedExternalContext` with `pageNumber` and return the verified page text directly with a `{ kind: 'document' }` source. Page rows inherit the parent document's `verifiedAt`; documents without final clinician verification remain invisible even if page rows exist.

## Implementation

### PR 1 — Schema + Types Foundation

- Append `ExternalContextStatus` values.
- Add `ExternalContextMediaKind`.
- Add document, OCR, extraction, verification, and soft-delete fields to `ExternalContext`.
- Backfill existing audio rows: rows with `audioFileKey IS NOT NULL` become `mediaKind = AUDIO`; other existing rows remain `PASTE`.
- Add `src/types/external-context-extraction.ts` with Zod schemas.
- Seed James Park with one verified document fixture and one unvetted `EXTRACTED` fixture.
- Keep existing paste/audio write paths setting the correct media kind.

### PR 2 — LLM Image Support

- Add `images?: ImageBlock[]` to `GenerateOptions`.
- Teach Bedrock provider to send Claude image blocks plus the text prompt.
- Keep streaming text-only.
- Stub mode returns a valid extraction envelope when images are present.

### PR 3 — Upload Route + Queue + S3 Keys

- Add document validation constants and document key helpers.
- Add multipart `mode=document` branch to `POST /api/patients/[id]/external-context`.
- Verify every uploaded object exists after upload.
- Enqueue `external-context-extraction` with 3 retries and exponential backoff.

### PR 4 — Extraction Worker

- Add worker wrapper and register in the single worker fleet.
- Rasterize PDFs/images to capped page images. Current cap is 100 pages, processed as 5-page Claude vision batches.
- Local PDF rasterization currently uses macOS PDFKit/Swift with `sips` fallback for single-page PDFs; production worker images must include an equivalent portable rasterizer before enabling document PDFs outside local verification.
- Add `DocumentExtractor` using the LLM abstraction, JSON mode, `stripJsonFence`, schema validation, and one validation retry.
- On each batch success write `ExternalContextExtractionBatch` OCR/extraction/model fields and move the parent row to `PARTIAL_EXTRACTION_REVIEW`.
- On final reviewed batch merge the vetted batch payloads and write document-level `EXTRACTED`, `ocrText`, `extractionJson`, `extractionModel`, `pageCount`, and `extractedAt`. Do not set `verifiedAt` or `transcriptClean`.
- Router V2 follow-up: when `OMNISCRIBE_FILE_ROUTER_V2=true`, text-based PDFs and supported structured files bypass rasterization and page-image vision extraction; the worker creates one full-document review batch after normalization and text-based LLM structuring. Flag-off behavior remains the original Unit 52 path.

### PR 5 — Vetting Endpoint + Brief Safety

- Add `POST /api/patients/[id]/external-context/[ecId]/verify`.
- Add `POST /api/patients/[id]/external-context/[ecId]/batches/[batchId]/review`.
- Require `status === EXTRACTED`, `verifiedAt == null`, and `deletedAt == null`.
- Batch review requires `status === PARTIAL_EXTRACTION_REVIEW`, batch `status === NEEDS_REVIEW`, `verifiedAt == null`, and `deletedAt == null`.
- In one transaction set `verifiedAt`, `verifiedByOrgUserId`, `vettedExtractionJson`, `status = READY`, and deterministic `transcriptClean`.
- Add defensive brief loader filter so document rows require `verifiedAt != null`.
- Enqueue Cleo state refresh after approval.

### PR 6 — Cleo Integration + Docs

- Add `lookupVerifiedExternalContext` tool.
- Add `document` as a source kind.
- Load verified documents into Cleo state projections.
- Update Rule 20 docs in `CLAUDE.md` and `context/architecture.md`.
- Add a DB-backed exclusion test proving unvetted docs are not returned.

### PR 7 — UI Upload + Camera + Vetting

- Add file drop and tablet camera capture components.
- Add document tab to ExternalContext add dialog.
- Add vetting sheet with source pages beside editable extracted fields.
- Use `<AlertDialog>` for approve/discard and `<StatusBadge>` for statuses/confidence.
- Show batch progress (`batch N of M`, pages processed/reviewed) and keep final verification separate from batch approval.
- E2E: upload fixture, wait for "Needs review", edit, approve, assert "Verified".

## Dependencies

- Unit 06 prior-context brief and existing ExternalContext prompt wiring.
- Current `src/app/api/patients/[id]/external-context` route.
- `src/services/llm/` abstraction and Bedrock provider.
- Existing BullMQ queue patterns in `src/lib/queue.ts`.
- Existing S3 helper in `src/lib/s3/client.ts`.
- Miss Cleo Ask/state-builder infrastructure.

## Verify When Done

Each PR must pass the full loop:

```bash
npx prisma generate
npx prisma db seed
npm run typecheck
npm run lint
npm run test
npm run build
npm run e2e
```

Manual acceptance:

- Clinician uploads PDF/image or captures photos, sees `Extracting...`, then `Needs review`.
- Vetting surface shows source pages beside editable extracted fields.
- Approve uses `<AlertDialog>` and flips row to verified.
- Verified document appears as a Cleo-citable `{ kind: 'document' }` source and in the next visit brief.
- Unvetted document is excluded from Cleo and the brief by automated Rule 20 tests.

## Three-Lens Evaluation

- **Clinician:** The clinician reviews source pages beside every extracted fact before the document can influence care context.
- **Medicare Compliance Officer:** Unvetted AI extraction never touches billable note context; v1 does not auto-write to problems, follow-ups, snapshot strip, or live note priorContext.
- **Insurance Auditor:** Original S3 files, verbatim OCR, raw model extraction, vetted payload, verification actor, timestamps, and PHI-free audit transitions allow reconstruction.
