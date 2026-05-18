# Unit 12: Patient Detail Redesign

## Goal

Replace the launcher-style `/patients/[id]` with a multi-division-aware clinical reference surface: snapshot strip of 5–6 most-recent objective measures (override > extracted > FHIR-reserved), visit history with 2-line assessment snippets, inline-editable demographics, and reference cards (active goals + watch + open follow-ups) in a two-column desktop layout collapsing to single column on mobile.

Source spec: [`references/patient-detail-spec.md`](../../references/patient-detail-spec.md), [`references/patient-detail-ui-spec.md`](../../references/patient-detail-ui-spec.md).

## Design

Per the reference spec — abbreviated here. Three trust patterns:
- **Provenance over fluency** — every fact one tap from its source
- **Override wins** — clinician edit trumps extraction; extraction stays visible in tooltip
- **3-tap test** — open patient → tap snapshot card → land on edit affordance

## Implementation

### A. Schema (`SnapshotOverride`)

```prisma
model SnapshotOverride {
  id              String    @id @default(cuid())
  orgId           String
  patientId       String
  patient         Patient   @relation(...)
  episodeId       String?   // null for patient-scoped overrides
  episode         EpisodeOfCare? @relation(...)
  measureKey      String    // matches MeasureDef.key
  valueJson       Json
  unit            String?
  recordedAt      DateTime  // clinician-supplied "as of" time
  enteredAt       DateTime  @default(now())
  enteredByOrgUserId String
  supersededAt    DateTime?
  supersededByOrgUserId String?
  @@index([patientId, measureKey, supersededAt])
  @@index([episodeId, measureKey, supersededAt])
  @@index([orgId, supersededAt])
}
```

### B. Types + registry (`src/lib/snapshots/`)

- `types.ts` — `SnapshotMeasure`, `SnapshotScope`, `PatientSnapshotStrip`
- `registry.ts` — REHAB / MEDICAL / BH measure definitions (hardcoded TS for v1)
- `division.ts` — `derivePatientDivision` (active episode > site default > org default; MULTI falls back to REHAB per LRCHC pilot rule M1)
- `build-snapshot-strip.ts` — compute-on-read pipeline (override > brief.objectiveMeasures > omit)

### C. API surfaces

- `GET /api/patients/[id]` extended with `snapshotStrip` + visit history `assessmentSnippet` field on each row
- `POST /api/patients/[id]/snapshot/override` — create override, auto-supersedes prior for same (measureKey, scope)
- `DELETE /api/patients/[id]/snapshot/override/[oid]` — soft-delete (sets supersededAt = now)

### D. UI components

- `<PatientSnapshotStrip>` — horizontal card row, ≤6 cards
- `<SnapshotCard>` — value + unit + trend arrow + source badge + inline edit
- `<VisitHistoryList>` — 2-line assessment snippet per row, tap → /review/[noteId]
- `<DemographicsBlock>` — inline-editable name/dob/phone/email/preferredLanguage
- `<TelehealthCTASlot>` — feature-flagged via `NEXT_PUBLIC_TELEHEALTH_ENABLED`; renders null in v1

### E. Audit actions

- `SNAPSHOT_OVERRIDE_CREATED`
- `SNAPSHOT_OVERRIDE_SUPERSEDED`
- `PATIENT_DEMOGRAPHICS_EDITED`

## Out of scope (v1)

- FHIR-source rows (deferred to Wave 4 FHIR work)
- Per-org measure registry customization (Wave 2 Unit 13 templates concern)
- Sensitivity-tier source-gating UI (Wave 2 Unit 14)
- Co-sign workflow for sensitive overrides (deferred)
- Mobile-first redesign (responsive collapse via Tailwind only)

## Verify when done

- SnapshotOverride table + indexes applied; demo seed unchanged.
- GET /api/patients/[id] returns populated snapshotStrip when overrides + extracted measures exist.
- POST /override creates row + auto-supersedes prior for same (measureKey, scope); audited.
- DELETE /override soft-deletes; audited.
- Patient detail renders snapshot strip + visit history with snippets + inline-editable demographics.
- Two-column desktop / single-column mobile.
- 3-tap test passes.
- progress-tracker.md updated.
