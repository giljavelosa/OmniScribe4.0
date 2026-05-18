# Unit 22: FHIR — Brief Generator Enrichment (F4)

## Goal

Wave 4 / F4. Extend Unit 06's `BriefBuilderInput` with an optional `<external_ehr_context>` block sourced from Unit 21's `FhirCachedResource` cache. The brief generator (Sonnet) gets a structured view of the patient's EHR conditions / meds / labs / allergies alongside the prior signed notes — same prompt, richer ground truth.

Locked principle (carried from `references/fhir-integration-spec.md` §9 + Unit 06's "source-grounded only" rule): EHR-derived brief fields carry per-field provenance (`sourceFhirResourceId` + `fetchedAt`) so F5's UI can render "from NextGen, fetched 3h ago" pills. Without provenance, the brief silently mixes attested-clinical-notes evidence with EHR-API evidence, which breaks the auditor contract.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | EHR context is optional | Brief works exactly as it did in Unit 06 when no `'verified'` PatientFhirIdentity exists or the cache is empty. F4 is purely additive. |
| 2 | Stale-data policy | Cached rows older than the 7-day threshold (Unit 21 `isStale`) are EXCLUDED from the EHR context. Better to surface no EHR context than stale EHR context. |
| 3 | Resource projection scope | Active conditions only (clinicalStatus = 'active'), active/in-progress medications (both MedicationStatement + MedicationRequest), most-recent 10 observations (per code), all allergies, most-recent 5 procedures, most-recent 5 diagnostic reports. |
| 4 | Prompt position | EHR context block lands AFTER prior_notes and BEFORE the closing instruction. Prior notes remain the primary ground truth; EHR context is supplementary. |
| 5 | Per-field provenance | Every EHR-derived value carries `{ source: 'fhir', fhirResourceType, fhirResourceId, fetchedAt }`. Note-derived values keep their existing `sourceNoteId`. The brief output schema gains an optional `ehrEnrichment` block; existing fields are unchanged so Unit 06 callers don't break. |

## Design

### `ExternalEhrContext` shape

```typescript
type FhirProvenance = {
  source: 'fhir';
  ehrSystem: string;
  fhirResourceType: string;
  fhirResourceId: string;
  fetchedAt: string; // ISO
};

type ExternalEhrContext = {
  ehrSystem: string;
  activeConditions: Array<{
    display: string;
    code: string | null;
    onsetDate: string | null;
    provenance: FhirProvenance;
  }>;
  currentMedications: Array<{
    display: string;
    status: string;
    sourceType: 'MedicationStatement' | 'MedicationRequest';
    provenance: FhirProvenance;
  }>;
  allergies: Array<{
    display: string;
    category: string | null;
    criticality: string | null;
    provenance: FhirProvenance;
  }>;
  recentObservations: Array<{
    display: string;
    code: string | null;
    value: string;
    unit: string | null;
    effectiveDate: string | null;
    provenance: FhirProvenance;
  }>;
  recentProcedures: Array<{
    display: string;
    performedDate: string | null;
    provenance: FhirProvenance;
  }>;
  recentDiagnosticReports: Array<{
    display: string;
    effectiveDate: string | null;
    conclusion: string | null;
    provenance: FhirProvenance;
  }>;
};
```

### Projection helper

`src/lib/fhir/project-ehr-context.ts`:

- `loadExternalEhrContext({ patientId, ehrSystem, now? })` — reads `FhirCachedResource` for the patient, filters stale rows, projects per type into the shape above, returns null if nothing usable.
- Pure function `projectCachedRows(rows, now)` for testability — takes the raw DB shape, returns the context.

### Prompt extension

Build-brief-prompt.ts gets a new `<external_ehr_context>` block rendered after `<prior_notes>`. The block carries:

```
<external_ehr_context ehrSystem="nextgen">
  <active_conditions>
    - display="Type 2 diabetes mellitus" code="E11.9" onsetDate="2019-03-15" fhirResourceId="..." fetchedAt="..."
    - ...
  </active_conditions>
  <current_medications>
    - display="metformin 500 mg" status="active" sourceType="MedicationStatement" ...
  </current_medications>
  <recent_observations>
    - display="Hemoglobin A1c" value="7.2 %" effectiveDate="2025-09-04" ...
  </recent_observations>
  ...
</external_ehr_context>
```

System prompt grows by one block (`EHR_CONTEXT_BLOCK`):

```
═══ EXTERNAL EHR CONTEXT (optional) ═══

When an <external_ehr_context> block is present, treat it as a SECONDARY ground
truth — equivalent in trust to the prior notes for facts it covers (conditions,
medications, allergies, labs). When evidence conflicts, prefer the most recent
attested source: if a Plan from the most recent signed note says "discontinue
metformin" but the EHR MedicationStatement still lists it active, follow the
note. NEVER invent facts that aren't in either source.

When you emit a brief field whose evidence came from <external_ehr_context>,
include the fhirResourceId in a new top-level `ehrEnrichment` object so the
provenance UI can render "from <ehrSystem>" pills. EHR-derived enrichment is
appended to the brief, not blended into the existing note-sourced fields.
```

### Brief output schema extension

```typescript
type BriefLLMOutput = {
  // ... existing fields unchanged ...
  ehrEnrichment?: {
    activeConditions?: Array<{
      display: string;
      code: string | null;
      onsetDate: string | null;
      fhirResourceId: string;
    }>;
    currentMedications?: Array<{
      display: string;
      status: string;
      fhirResourceId: string;
    }>;
    allergies?: Array<{
      display: string;
      criticality: string | null;
      fhirResourceId: string;
    }>;
    recentObservations?: Array<{
      display: string;
      value: string;
      unit: string | null;
      effectiveDate: string | null;
      fhirResourceId: string;
    }>;
  };
};
```

F5 (Unit 23) will render this block as a separate panel in the BriefCard with the per-field source pills.

### BriefGenerator wiring

`src/services/brief/BriefGenerator.ts` already loads the patient + episode + prior notes. It gains one new step:
1. Resolve the patient's verified PatientFhirIdentity (silent skip if absent — brief still generates).
2. Call `loadExternalEhrContext` if a verified link exists.
3. Pass to `buildBriefUserMessage` via the new `externalEhrContext` field.

In stub mode (Bedrock stub), the synthesized brief gains a small `ehrEnrichment` block so downstream rendering can be tested without a real LLM call.

### Audit

No new audit actions. Brief generation already audits `BRIEF_GENERATED` (Unit 06); we extend its metadata with `{ hasEhrContext: boolean, ehrResourceCount?: number }` so the auditor lens can see when a brief was enriched.

## Implementation order

1. Spec (this commit)
2. ExternalEhrContext type + projection helper + tests
3. Brief prompt extension + system prompt update + output schema update
4. BriefGenerator wiring + cache reader + BRIEF_GENERATED audit metadata extension
5. Tracker + PR #23

## Out of scope (F4)

- F5 provenance UI surfacing in the BriefCard (Unit 23).
- Cross-EHR enrichment (one EHR per patient via PatientFhirIdentity v1).
- Procedure + DiagnosticReport in the LLM brief (cached + projected but not yet referenced in BRIEF_SYSTEM_PROMPT; landed in cache so F4 polish can wire them when the brief UX demands them).

## Verify when done

- `loadExternalEhrContext` returns null when no verified link OR cache empty OR all rows stale.
- Projection drops cached rows with `clinicalStatus !== 'active'` for conditions.
- Brief generator runs end-to-end against a patient with stub-mode FHIR data; the resulting `ehrEnrichment` block is non-null in stub mode.
- Brief generator runs end-to-end against a patient WITHOUT a FHIR link (no regression vs Unit 06 behavior).
- progress-tracker.md updated; PR #23 stacked on Unit 21.
