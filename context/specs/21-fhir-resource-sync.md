# Unit 21: FHIR — Resource Sync + Cache (F3)

## Goal

Wave 4 / F3. Activate `FhirCachedResource` (shipped schema-only in Unit 19). Per-resource adapters fetch from the EHR, simplify to internal shape, upsert into the cache, gated by the `'verified'` `PatientFhirIdentity` Unit 20 enforced. F4 (brief enrichment, Unit 22) reads from the cache instead of the EHR directly.

> **F3 ships when** a clinician can click "Sync EHR data" on /patients/[id] and the cache populates with 8 resource types (Patient + 7 clinical) for that patient, with on-demand + 7-day-staleness refresh policy.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Resource types (v1) | Patient, Condition, MedicationStatement, MedicationRequest, Observation, AllergyIntolerance, Procedure, DiagnosticReport. Goal + CarePlan are F4 polish (not needed for the brief's first cut). |
| 2 | Trigger model | On-demand (clinician button) only for v1. Background BullMQ staleness sweeper is Wave 4.5 polish — proves the on-demand path first. |
| 3 | Staleness threshold | 7 days. Cached rows older than this are silently re-fetched on the next on-demand sync. |
| 4 | Fetch granularity | Per resource type: one `GET /<Type>?patient=<fhirPatientId>&_count=50` call per type per sync. Cap at 50 entries per type for the first cut; pagination is Wave 4.5. |
| 5 | Adapter shape | Pure functions: `(fhirResource) → simplifiedShape`. Simplified shape stored in `FhirCachedResource.resource` alongside the raw FHIR resource (so F4 has both: simplified for the brief's read path, raw for the provenance drawer in F5). |
| 6 | Cache write | Upsert keyed by `(ehrSystem, resourceType, fhirResourceId)` (the unique index Unit 19 shipped). `fetchedAt` set on every write; sensitivityLevel propagated from the FHIR resource's `meta.security` codes if present. |
| 7 | Sync failure handling | Per-resource-type — one type's failure doesn't poison the others. Sync returns a summary `{ ok: N, failed: M, details: [...] }` so the UI can show partial-success. |

## Design

### Sync orchestrator

`src/services/fhir/sync.ts`:

```typescript
type SyncOpts = {
  patientId: string;
  ehrSystem: string;  // 'nextgen' for v1
  triggerUserId: string;
  triggerOrgUserId: string;
  orgId: string;
};

type SyncResult = {
  ok: boolean;
  fetched: number;
  cached: number;
  perResourceType: Record<string, { count: number; error: string | null }>;
};

async function syncPatientResources(opts: SyncOpts): Promise<SyncResult>;
```

Steps:
1. Resolve the patient's verified PatientFhirIdentity for the EHR system. Refuse if absent OR confidence !== 'verified'.
2. Resolve the calling clinician's FhirIdentity for the same EHR.
3. For each of the 8 resource types:
   - Call `fetchAndCacheResourceType({ identity, fhirPatientId, resourceType, patientId, orgId })`
   - On error, record + continue
4. Audit `FHIR_SYNC_COMPLETED` with the perResourceType summary.

### Per-resource fetcher

`src/services/fhir/resource-fetcher.ts`:

- `fetchResourceBundle(opts: { identity, resourceType, query })` — same token-refresh + URL-building pattern as patient-client; returns the raw FHIR Bundle.
- Stub mode synthesizes a Bundle with 2-3 entries per resource type — enough to exercise the cache writer + brief enrichment paths.

### Per-resource adapters

`src/services/fhir/adapters/index.ts` re-exports the adapters; each adapter file is a pure function. Concise simplified shapes — the brief's reader (Unit 22) wants just enough to render a one-line summary.

```typescript
type SimplifiedCondition = {
  code: string | null;            // SNOMED / ICD code
  display: string | null;         // clinical display text
  clinicalStatus: 'active' | 'inactive' | 'resolved' | 'recurrence' | 'remission' | 'unknown';
  onsetDate: string | null;       // YYYY-MM-DD
  recordedDate: string | null;
};

// Similar shape per resource type. See implementation for the full list.
```

### Cache writer

`src/services/fhir/cache.ts`:

- `upsertCachedResource(opts: { patientId, ehrSystem, resourceType, fhirResourceId, resource, simplified, sensitivityLevel? })` — single upsert against the unique index. Stores both raw + simplified under `resource: { raw: ..., simplified: ... }` so F5 provenance UI can pull either.

### API

- `POST /api/patients/[id]/fhir-sync` — clinician triggers a sync. NOTE_REVIEW-gated. Resolves the patient's verified link OR returns 412 `not_linked` (UI routes to the EhrLinkPanel's "Confirm match" CTA). Runs `syncPatientResources` synchronously (typical wait 2-10s in real-mode; stub-mode is instant). Returns the `SyncResult` summary.

- `GET /api/patients/[id]/fhir-sync` — returns `{ data: { lastSyncedAt, counts: Record<resourceType, number>, staleResourceTypes: string[] } }` so the panel can show "Last synced X minutes ago" + flag stale types.

### Staleness check

`isStale(fetchedAt: Date, now: Date): boolean` in `src/lib/fhir/staleness.ts`:

- `now - fetchedAt > 7 days` → stale
- Pure helper, easy to test
- F4 (Unit 22) brief generator will call this per resource and either use the cache or fail open (skip the FHIR enrichment block) if everything's stale

### Audit actions

- `FHIR_SYNC_TRIGGERED` — clinician clicked the sync button. Metadata: `{ ehrSystem, fhirPatientId }`.
- `FHIR_SYNC_COMPLETED` — sync finished. Metadata: `{ ehrSystem, fhirPatientId, perResourceType: { Condition: {count, error}, ... }, totalFetched, totalCached }`.
- `FHIR_RESOURCE_CACHED` — per-resource-type write. Metadata: `{ ehrSystem, resourceType, count }`. Could be noisy (8 per sync); we'll only emit when count > 0.

PHI-free throughout. fhirPatientId + fhirResourceId are EHR-side identifiers, not HIPAA Safe Harbor PHI. Counts are aggregate numbers.

### UI

The existing `EhrLinkPanel` (Unit 20) gets a "Sync EHR data" button when the link is `'verified'` + a "Last synced N minutes ago" indicator. Disable the button while a sync is in flight. On completion, show the summary inline (e.g., "Synced 47 records · 1 type failed").

## Implementation order

1. Spec + 3 audit actions (this commit)
2. Adapters + sync orchestrator + cache writer + staleness helper + tests
3. POST + GET sync APIs + EhrLinkPanel sync button + last-synced indicator
4. Tracker + PR #22

## Out of scope (F3)

- Background BullMQ staleness sweeper (Wave 4.5)
- CarePlan + Goal adapters (Wave 4.5 — not needed for brief v1)
- Pagination beyond 50 entries per type (Wave 4.5)
- Manual per-resource refresh (sync is whole-patient; per-type refresh adds API surface without compelling current need)
- Per-resource provenance UI on the brief (F5 / Unit 23)

## Verify when done

- `POST /api/patients/[id]/fhir-sync` against a verified link populates `FhirCachedResource` with 8 resource types (stub-mode synthesizes 2-3 per type).
- A second sync within 7 days is a no-op for cached rows (fetchedAt updated but contents stable in stub).
- `POST` against an unverified or missing link returns 412 `not_linked`.
- `GET /api/patients/[id]/fhir-sync` returns the per-resource-type counts + lastSyncedAt.
- EhrLinkPanel shows "Last synced X minutes ago" + the Sync button.
- All 3 audit actions wired.
- progress-tracker.md updated; PR #22 stacked on Unit 20.
