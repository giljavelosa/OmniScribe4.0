# Unit 23: FHIR — Provenance UI on the Brief (F5)

## Goal

Wave 4 / F5. Surface Unit 22's `ehrEnrichment` block in the BriefCard with per-field provenance pills, staleness chips, and a drawer that exposes the raw FHIR resource for auditor inspection.

> **F5 ships when** a clinician looking at /prepare for a patient with EHR data sees their active conditions / current meds / allergies / recent labs in the brief, each row labeled with which EHR it came from + a chip when the data is stale, and can click any pill to inspect the underlying FHIR resource.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Pill placement | One pill per ehrEnrichment row (right-aligned, same row as the entry). Note-sourced fields keep their existing `<SourcePill>` unchanged. |
| 2 | Staleness chip | Embedded in the pill. Computed against `nowMs` (passed in from the server page like the brief's age). Threshold reuse: ≥7d → "warning", ≥30d → "stale". |
| 3 | Drawer | Base UI Dialog with the raw FHIR JSON pretty-printed + the cached `simplified` shape + fetchedAt + sensitivityLevel. Read-only. |
| 4 | Audit | One `FHIR_RESOURCE_VIEWED` per drawer open. Metadata: `{ ehrSystem, resourceType, fhirResourceId }`. PHI-free — the resource id is EHR-side. |
| 5 | fetchedAt source | Hydrated at brief generation time from the projected cache (see "Schema hydration" below). The pill shows the snapshot-in-time staleness; the drawer always fetches the LATEST cache state. |

## Design

### Schema hydration

`BriefLLMOutputSchema.ehrEnrichment` (Unit 22) only carries `fhirResourceId` per entry — the LLM doesn't generate timestamps. The note-brief worker, after the LLM returns, walks each `ehrEnrichment[*]` entry and joins back to the projected `externalEhrContext` (which has `fetchedAt`) by `fhirResourceId`. The hydrated shape is stored on `PriorContextBriefContent.ehrEnrichment` so reads are zero-join.

```typescript
// What gets stored in NoteBrief.content
type PriorContextBriefContent = BriefLLMOutput & {
  generatedAt: string;
  generatorVersion: string;
  openFollowUps: FollowUpPreview[];
  ehrEnrichment?: {
    // Each LLM-output entry augmented with the cache's fetchedAt.
    activeConditions?: Array<{ ..., fetchedAt: string }>;
    currentMedications?: Array<{ ..., fetchedAt: string }>;
    allergies?: Array<{ ..., fetchedAt: string }>;
    recentObservations?: Array<{ ..., fetchedAt: string }>;
  };
};
```

The hydration is a pure function `hydrateEhrEnrichment(llmOutput, externalEhrContext)` so it's testable in isolation.

### Drawer endpoint

`GET /api/fhir/cached-resources/[id]` (where `id` is `FhirCachedResource.id`):

- NOTE_REVIEW-gated. Resolves the row + asserts org scoping via the patient.
- Returns `{ raw, simplified, fetchedAt, sensitivityLevel, ehrSystem, resourceType, fhirResourceId }`.
- Writes `FHIR_RESOURCE_VIEWED` audit. PHI denylist holds — the audit metadata carries EHR-side ids only.

For lookup by `fhirResourceId` (the brief carries that, not the cache row id), we add a second endpoint `GET /api/fhir/cached-resources/by-fhir-id?ehrSystem=&type=&fhirResourceId=` — the brief's pill calls THIS one. Simpler client-side: pass what's in hand without extra DB hops.

### Components

- `src/components/brief/ehr-source-pill.tsx` — small pill with "from <ehrSystem>" + relative time + optional staleness chip. Click → opens `ProvenanceDrawer`.
- `src/components/brief/provenance-drawer.tsx` — Base UI Dialog. Fetches the cache row on open (single request); shows simplified shape + raw JSON in two collapsible blocks; shows sensitivityLevel as a "Restricted source" badge when present; explicit "Last fetched at" timestamp.
- `src/components/brief/ehr-enrichment-block.tsx` — section that renders the 4 ehrEnrichment categories. Each row pairs the display text with an `EhrSourcePill`. Slots into BriefCard between the existing sections and the footer.

### Staleness chip rules

- Fresh (<7d): no chip, just the relative time text.
- Warning (7d ≤ age < 30d): yellow chip "stale".
- Stale (≥30d): red chip "very stale".

Threshold matches Unit 21's `FHIR_STALE_AFTER_MS = 7d`. The 30d "very stale" cutoff is F5-specific (no constant elsewhere in the codebase to align with). Lives in `src/lib/fhir/staleness.ts` next to `isStale`.

### Audit

One new action: `FHIR_RESOURCE_VIEWED`. Fired by the by-fhir-id lookup endpoint on every successful read (the drawer open). Metadata: `{ ehrSystem, resourceType, fhirResourceId }`. No content; PHI denylist still holds.

## Implementation order

1. Spec + `PriorContextBriefContentSchema` hydration (`hydrateEhrEnrichment`) + worker call + tests
2. `FHIR_RESOURCE_VIEWED` audit action + lookup endpoints
3. `EhrSourcePill` + `StalenessChip` + thresholds helper + tests
4. `EhrEnrichmentBlock` + `ProvenanceDrawer` + BriefCard wiring
5. Tracker + PR #24

## Out of scope (F5)

- "Sync now" button on the drawer (clinician refreshes via the EhrLinkPanel — keeps surface single-purpose).
- Cross-EHR pills (one EHR per row per Unit 20).
- Per-category collapse/expand (the existing BriefCard `<BriefSection collapsible>` covers this).
- Drawer for note-sourced pills (the existing `<SourcePill>` already routes to /review).

## Verify when done

- Brief generated against a patient with EHR data shows the 4 ehrEnrichment categories.
- Each row has an EhrSourcePill with the correct relative time + appropriate staleness chip.
- Clicking a pill opens the drawer; raw FHIR JSON is rendered; audit row written.
- Brief generated against a patient WITHOUT EHR data hides the entire ehrEnrichment block (no regression).
- `npm run build && npm run lint && npm test` green; new tests for hydration + staleness thresholds + lookup endpoint.
- progress-tracker.md updated; PR #24 stacked on Unit 22.
