# Clinical Data Quality UI

> **Draft internal spec.** This is a cross-cutting UX and provenance spec, not a numbered build unit yet. It translates the EHR visual-display/data-quality references into OmniScribe rules for patient snapshot, uploaded records, Miss Cleo answers, briefs, and clinician review.

## Goal

Clinicians need to know not only *what* OmniScribe knows about a patient, but also:

1. where each fact came from,
2. whether it has been clinician verified,
3. how current it is,
4. whether the record is complete enough to trust for the task,
5. what still needs review or reconciliation.

The clinical UI should make data quality visible without turning the chart into an audit screen. The default view should remain fast and calm, with one-tap access to provenance and deeper inspection.

## Reference Inputs

This spec is informed by the local reference set reviewed on 2026-05-30:

- `/Users/gil/Downloads/EHRstudyUI.pdf`
- `/Users/gil/Downloads/all_files.zip`
- `/Users/gil/Downloads/appendixa_visualdisplay_online_supplement_cover_final.pdf`

Practical takeaways for OmniScribe:

- Clinical visual display should prioritize legibility, grouping, contrast, consistent semantics, and provenance over decorative presentation.
- Data quality should be visible at the point of use, not buried in a separate admin report.
- Color must not be the only carrier of clinical meaning.
- Dense clinical data should be chunked into scannable categories with stable labels, source/date markers, and clear missing-data states.

## Problem

OmniScribe now receives clinical truth from multiple sources:

- signed OmniScribe notes,
- clinician-managed cases,
- verified uploaded documents,
- FHIR/EHR enrichment,
- manual snapshot overrides,
- follow-ups and goals,
- Miss Cleo-derived projections.

Without a consistent data-quality UI, clinicians can misread the system state:

- Verified uploaded records may exist but the chart still says "connect an EHR."
- Miss Cleo may answer from a signed note while ignoring verified uploaded pages.
- A patient snapshot may hide data because the current display scope and measure registry do not match the source data.
- A clinician may not know whether a medication came from the EHR, a verified outside record, or an AI extraction awaiting review.
- Auditors cannot quickly reconstruct which source supported a visible fact.

## Design Principles

### 1. Provenance Beside The Fact

Every clinically meaningful fact shown outside a raw document viewer should carry a compact source signal:

- `Signed note`
- `Verified uploaded record`
- `EHR`
- `Clinician override`
- `Follow-up`
- `Case`
- `Miss Cleo projection`

The source signal should be clickable or expandable when the surface supports it. The expanded view should show source type, source date, verification state, author/verifier role when appropriate, and a route to the underlying record.

### 2. Verification Before Context

Document-derived facts are not chart context until final clinician verification.

For `ExternalContext.mediaKind = DOCUMENT`, downstream clinical context requires:

- `status = READY`
- `verifiedAt != null`
- `deletedAt = null`

Unverified, extracting, failed, discarded, and partially reviewed document rows must remain invisible to Miss Cleo, briefs, scribe context, billing support, and patient snapshot summary facts.

### 3. Quality State Is Explicit

Each patient-facing clinical data block should communicate one of these states:

- `Verified`
- `Needs review`
- `Incomplete`
- `Stale`
- `Conflicting`
- `Unavailable`

Use existing `StatusBadge` and `StatusBanner` patterns. Do not use hardcoded status colors.

### 4. Correctness Beats Fluency

Miss Cleo and summaries should cite verified source material and say "not found in the available chart context" when evidence is absent. A confident but uncited answer is lower quality than a shorter answer with page/source provenance.

### 5. Snapshot Is A Summary, Not The Source Of Truth

The patient snapshot is a high-signal entry point. It should show current, clinically useful data, but the source of truth remains the underlying signed note, verified document page, FHIR resource, case, or clinician override.

## Data Quality Dimensions

### Completeness

Shows whether the system has enough data for the task.

Examples:

- Medications: "10 current meds from verified records" is complete enough to view, but still needs EHR reconciliation if the org expects live EHR sync.
- Allergies: "3 allergies from verified records" should replace "Allergies not recorded."
- Labs: show "No recent labs found" only when verified context was searched and no labs are available.

### Correctness

Shows whether a clinician verified or edited the value.

Examples:

- Uploaded document facts are `pending` until clinician final verification.
- A clinician-edited extraction should display "verified by clinician" rather than "AI extracted."
- A manual snapshot override should win over extracted values and expose the overridden source in the detail view.

### Currency

Shows whether the data is recent enough for clinical use.

Examples:

- Medication list: source date and verification date.
- Labs: collection date and source page/resource.
- FHIR enrichment: fetched date and staleness state.
- Snapshot measures: recorded date, note date, or override date.

### Consistency

Shows conflicts between sources.

Examples:

- Uploaded record lists penicillin anaphylaxis but EHR allergies are empty.
- Verified outside record lists tacrolimus current, but signed note says no medications.
- Two verified records disagree on a lab value date or medication dose.

### Traceability

Shows whether an auditor can reconstruct the chain from visible fact to source.

Minimum trace for document-derived facts:

- external context id,
- source file id or page number,
- source date if available,
- verifier,
- verification timestamp,
- raw OCR/page text availability,
- structured field path.

## Source Hierarchy For Display

When multiple sources can populate the same UI slot, use this default precedence:

1. Clinician manual override for the exact slot/scope.
2. Signed or transferred note data directly authored and finalized by the clinician.
3. Verified uploaded document facts with `verifiedAt != null`.
4. Verified EHR/FHIR facts, with staleness visible.
5. Clinician-confirmed follow-ups, goals, and case data.
6. Miss Cleo projections derived only from eligible sources.
7. Pending/unverified extracted data: visible only inside review surfaces, never as chart truth.

If a lower-precedence source is more current than a higher-precedence source, do not silently replace the higher source. Show a conflict or reconciliation prompt where clinically relevant.

## Patient UI Surfaces

### Safety Band

The safety band should surface verified safety-critical facts before generic missing-data copy.

Rules:

- If verified allergies exist, show the allergy count and the highest-risk allergy names first.
- If active verified problems exist, show the most clinically salient active problems after allergies.
- Do not show "Allergies not recorded" when verified uploaded records contain clinician-approved allergies.
- Overflow should expose all active safety facts in a details popover or sheet.

### Clinical Snapshot

The snapshot should show the most useful current measures for the active clinical context.

Rules:

- Keep the current source hierarchy: manual override before extracted note measures.
- Add visible source labels for each tile.
- If the active division registry hides available measures, show an "Other verified measures" row or a domain toggle rather than implying no measures exist.
- Uploaded-document labs and vitals may appear as verified document facts, but should not mutate `NoteBrief.content.objectiveMeasures`.
- If uploaded-document data is used in the snapshot, label it as `Verified uploaded record`, not `Signed note`.

Minimum tile metadata:

- value,
- unit,
- recorded date,
- source type,
- source link,
- stale/conflict state when applicable.

### Medications Card

Medication display states:

- `Current meds from verified records`
- `Current meds from EHR`
- `Current meds from signed note`
- `Medication list needs reconciliation`
- `Not recorded`

Rules:

- Do not show "connect an EHR" if verified uploaded records already provide clinician-approved medications.
- Keep EHR reconciliation language when the source is an uploaded record, because an outside record may not equal the live medication administration truth.
- Show count, source, source date, and verification date.
- Provide one tap into the medication list with source snippets.

### Documents & Outside Records

The records card should show both workflow and clinical value.

Suggested states:

- `No documents uploaded`
- `Extracting`
- `Needs review`
- `Final review`
- `Verified`
- `Failed`
- `Manual review required`

For verified large documents, show:

- page count,
- pages indexed,
- verified date,
- structured domains found: allergies, meds, problems, labs, procedures, imaging, rehab,
- "Ask Miss Cleo about this record" entry point.

### Miss Cleo Chart Mode

Miss Cleo must distinguish:

- chart facts,
- uploaded-record facts,
- source page text,
- general medical knowledge,
- research/literature answers.

Rules:

- Chart mode can use verified document facts and page text.
- Research mode remains patient-agnostic unless a separate chart-to-research pivot explicitly carries non-PHI clinical descriptors.
- For document answers, Cleo should cite source as `Uploaded record, page N` when page-level text exists.
- For page-specific requests, Cleo should retrieve the exact verified page text rather than relying on summary extraction.
- If a question asks for a fact absent from verified chart context, answer that it was not found.

## Clinician Review Surfaces

### Extraction Review

Document review should show source image/PDF beside:

- OCR/page text,
- extracted summary,
- structured diagnoses,
- medications,
- allergies,
- labs,
- vitals,
- procedures,
- review notes.

Quality indicators should use clinician-readable labels:

- `High confidence`
- `Needs clinician check`
- `Low confidence`

Avoid raw `high`, `medium`, `low` labels without context. When space allows, display "Extraction confidence" as the field label.

### Final Verification

Final verification means:

- extracted fields are clinician-vetted,
- page text is indexed,
- facts can feed Miss Cleo/briefs/scribe context,
- downstream users can rely on the document as chart context.

After final verification:

- disable or replace the verify action,
- show a verified banner,
- show who verified and when,
- keep source/document viewer available,
- prevent repeated confirmation dialogs for an already verified document.

## Data Model Expectations

This spec should not require destructive schema changes.

Likely additive data needs:

- source quality metadata per structured fact,
- conflict indicators between source families,
- per-page verified document text already supported by `ExternalContextDocumentPage`,
- optional display projection for verified document domains,
- optional freshness/staleness metadata for snapshot rows.

Do not write uploaded-document values into signed note `finalJson`. Signed notes remain immutable.

## Implementation Order

1. Audit current display states across safety band, snapshot, medications, outside records, and Miss Cleo answers.
2. Add shared data-quality display types for source, verification, freshness, and conflict state.
3. Update patient overview cards to replace misleading empty states when verified uploaded records exist.
4. Add provenance labels and source links to medication/allergy/problem/lab displays.
5. Add "Other verified measures" handling when the active snapshot registry hides available data.
6. Update Miss Cleo answer rendering to show document/page citations consistently.
7. Add tests proving unverified documents remain excluded.
8. Add E2E coverage for a verified uploaded record appearing in patient UI and Miss Cleo chart answers.

## Out Of Scope For First Pass

- Automatic writeback to EHR.
- Automatic mutation of native chart problem/medication/allergy tables from uploaded records.
- Billing-code recommendations from uploaded documents.
- Patient-facing release of uploaded-document extraction.
- Cross-org sharing of clinician verification.
- Color-palette redesign.

## Verification

Implementation work derived from this spec should verify:

- `npx prisma validate`
- `npx prisma generate`
- `npx prisma migrate status` when schema changes are present
- `npx prisma db seed` after schema changes
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run e2e`

Manual acceptance:

- A patient with verified uploaded meds does not show "connect an EHR" as the primary medication state.
- Verified allergies from uploaded records appear in the safety band.
- Snapshot shows available signed-note measures or clearly explains why no measures match the current domain.
- Miss Cleo can answer a page-specific uploaded-record question with a page citation.
- Miss Cleo says a fact is not found when it is absent from verified chart context.
- Unverified documents remain invisible outside review surfaces.

## Three-Lens Evaluation

### Clinician

The clinician can see what is known, what is missing, what was verified, and where each fact came from without leaving the patient chart.

### Medicare Compliance Officer

The UI separates verified clinical facts from unverified AI extraction and does not let unreviewed documents influence medical necessity, skilled-care support, or note generation.

### Insurance Auditor

Every visible fact can be traced back to its source family, source record, verification state, and relevant timestamp. Uploaded-record facts include page-level provenance when available.
