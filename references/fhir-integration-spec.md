# OmniScribe — FHIR Integration Master Spec

**Status:** Draft for review and roadmap planning
**Owner:** Gil
**Last updated:** 2026-05-05
**Implementation pattern:** Master spec; derive numbered `cursor-tasks/` files per phase when ready to execute
**Target first EHR:** NextGen (founder's clinical environment)
**Anchored anti-regression rules:** 1, 4, 5, 6, 7, 8, 10, 13, 14, 15, 16, 17

---

## 1. Goal

Make external EHR patient data — medications, labs, vitals, conditions, allergies, encounter history — available to the OmniScribe clinical co-pilot via HL7 FHIR R4. The data flows into the existing prior-context brief generator and follow-up extractor as additional structured context, eliminates the ~15 minutes of EHR-scouring pain per returning patient that anchored the founder's original product hypothesis, and unlocks the visit-time medical-assistant features sketched in the 30-second-card brainstorm.

This is a multi-phase workstream of its own. Realistic timeline for a usable v1 against a single EHR: **3–6 months of dedicated engineering work** depending on auth flow complexity and EHR cooperation. Multi-EHR support compounds from there.

## 2. Why this anchors the roadmap

The prior-context brief system (Phases 20–25) is fully functional but artificially scoped: it only reads from signed OmniScribe notes. A clinician returning to a patient still has to open NextGen for medications, labs, recent imaging, allergies — exactly the workflow the founder set out to eliminate. FHIR closes that gap.

Strategically, FHIR also unlocks:

- **Visit-time medical assistant** (real-time data lookups during the encounter — *"the patient says her dizziness is worse"* → automatic medication and BP context)
- **Cross-discipline continuity** (PT can see what the prescribing physician documented last week without leaving OmniScribe)
- **Faster onboarding for new clinics** (bring-your-own-EHR rather than requiring full migration)
- **Foundation for write-back** (orders, referrals, finalized notes pushed back to the EHR — explicitly out of scope for v1, but the architecture should not foreclose it)

## 3. Non-goals (v1)

Listed explicitly so scope doesn't drift mid-build.

- **Write-back to FHIR.** v1 is read-only. Notes finalized in OmniScribe stay in OmniScribe (or are exported manually). Write-back is a v2 workstream with its own legal/compliance review.
- **DocumentReference / full external clinical note text.** v1 surfaces structured data (Observation, MedicationStatement, etc.) — not free-text notes from other clinicians. Full-note parsing is its own complex problem (PDF / HL7 v2 narrative, sometimes scanned). Deferred.
- **FHIR Subscription / push notifications.** v1 is pull-based. Subscription support varies by vendor; deferred until pull-based is proven.
- **CDS Hooks.** Clinical decision support is its own workstream. Out of scope.
- **US Core profile certification.** We target US Core resource shapes for compatibility, but formal certification (ONC) is deferred.
- **Multi-tenant FHIR per-org configuration.** v1 assumes one OmniScribe org targets one EHR system. Multi-tenant per-org FHIR config (Org A on NextGen, Org B on Epic) is a v2 problem.
- **Patient-mediated FHIR launch.** v1 is provider-launched (clinician auths into the EHR; OmniScribe pulls on behalf of the clinical workflow). Patient-mediated launch (patient grants OmniScribe access via their portal) is deferred.
- **Tribal-specific data residency requirements.** Some tribal health systems have additional sovereignty / data-residency requirements beyond HIPAA. v1 ships HIPAA-compliant; tribal-specific compliance is a separate review per deployment.

## 4. Architecture overview

```
┌─────────────────┐         ┌──────────────────┐         ┌──────────────┐
│  Clinical UI    │         │   OmniScribe     │         │  External    │
│  (prepare /     │ ──read──▶│   Application    │         │  EHR         │
│   capture /     │         │                  │         │  (NextGen)   │
│   review)       │         │                  │         │              │
└─────────────────┘         └─────────┬────────┘         └──────┬───────┘
                                      │                         │
                                      │ enqueue                 │
                                      ▼                         │
                          ┌───────────────────────┐             │
                          │   FHIR Sync Worker    │             │
                          │   (BullMQ)            │ ─FHIR R4─────┤
                          │                       │   GET        │
                          └───────────┬───────────┘   queries    │
                                      │                          │
                                      │ persist                  │
                                      ▼                          │
                          ┌───────────────────────┐              │
                          │  FhirCachedResource   │              │
                          │  table (Postgres)     │              │
                          │  + provenance index   │              │
                          └───────────┬───────────┘              │
                                      │                          │
                                      │ read                     │
                                      ▼                          │
                          ┌───────────────────────┐              │
                          │   Brief Generator +   │              │
                          │   Follow-up Extractor │              │
                          │   (Phase 23 / 24)     │              │
                          └───────────────────────┘              │
                                                                 │
                          ┌───────────────────────┐              │
                          │   SMART on FHIR       │              │
                          │   OAuth2 token        │ ─auth────────┘
                          │   service             │
                          └───────────────────────┘
```

The **FHIR client + cache + sync worker** sits as a sibling subsystem to the existing brief precompute path. Briefs read FHIR data from the local cache, never directly from the external EHR — the cache decouples brief generation latency from EHR availability and rate limits.

## 5. Auth: SMART on FHIR

Authentication uses the SMART App Launch Framework (the FHIR community's OAuth2 profile for clinical apps).

- **Provider-launched flow** (v1): clinician launches OmniScribe from inside NextGen → NextGen issues an authorization code → OmniScribe exchanges for an access token + refresh token + patient/encounter context. Token lifetime is typically 60 minutes; refresh tokens last days to weeks depending on vendor.
- **Standalone launch** (v2): OmniScribe initiates OAuth2 directly against the EHR's authorization endpoint. Useful when running outside an EHR-embedded context (telehealth, post-visit review).

Required scopes for v1 read access (per US Core):

```
launch
launch/patient
patient/Patient.read
patient/Encounter.read
patient/Observation.read
patient/MedicationStatement.read
patient/MedicationRequest.read
patient/Condition.read
patient/AllergyIntolerance.read
patient/DiagnosticReport.read
patient/Procedure.read
offline_access
```

Tokens stored encrypted in Postgres (per-clinician, per-EHR), refreshed proactively before expiry. AWS Secrets Manager holds the OAuth client secret per anti-regression rule 14.

## 6. Data model additions

Three new tables.

```prisma
// Per-clinician, per-EHR-org SMART on FHIR token + identity binding.
model FhirIdentity {
  id              String   @id @default(cuid())
  orgId           String
  org             Organization @relation(fields: [orgId], references: [id])
  clinicianId    String
  clinician       OrgUser  @relation(fields: [clinicianId], references: [id])
  ehrSystem       String   // "nextgen" | "epic" | "cerner" | …
  fhirBaseUrl     String   // canonical FHIR endpoint URL for this EHR instance
  accessToken     String   @db.Text  // encrypted at rest
  refreshToken    String   @db.Text  // encrypted at rest
  scope           String   @db.Text
  expiresAt       DateTime
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([clinicianId, ehrSystem])
  @@index([orgId, ehrSystem])
}

// Bidirectional patient identity mapping. One OmniScribe Patient may map to
// multiple FHIR Patient resources across multiple EHR systems.
model PatientFhirIdentity {
  id                String   @id @default(cuid())
  patientId         String
  patient           Patient  @relation(fields: [patientId], references: [id])
  ehrSystem         String
  fhirPatientId     String   // Patient.id at the EHR
  fhirIdentifier    String?  // canonical Patient.identifier (system OID + value)
  matchConfidence   String   // "verified" | "high" | "manual" — verified = explicit clinician confirmation
  verifiedAt        DateTime?
  verifiedBy        String?  // OrgUser.id
  createdAt         DateTime @default(now())
  @@unique([ehrSystem, fhirPatientId])
  @@index([patientId, ehrSystem])
}

// Cached FHIR resource snapshots. One row per (patient, ehrSystem,
// resourceType, resourceId) tuple. Refreshed by the sync worker.
model FhirCachedResource {
  id              String   @id @default(cuid())
  patientId       String
  patient         Patient  @relation(fields: [patientId], references: [id])
  ehrSystem       String
  resourceType    String   // "Observation" | "MedicationStatement" | …
  fhirResourceId  String
  resource        Json     // full FHIR resource JSON
  fetchedAt       DateTime @default(now())
  // Sensitivity inherited from the source EHR. 42 CFR Part 2 propagation:
  // if the source flagged this as restricted, downstream readers MUST honor.
  sensitivityLevel String?
  @@unique([ehrSystem, resourceType, fhirResourceId])
  @@index([patientId, resourceType, fetchedAt])
}
```

## 7. Resource mapping

FHIR resources translate to OmniScribe brief fields and (in some cases) new internal model fields.

| FHIR resource | OmniScribe usage | Brief field |
|---|---|---|
| `Patient` | Identity reconciliation | `patientOneLine` (corroboration / sex / DOB) |
| `Encounter` | Encounter history (past visits) | `lastVisit` provenance, episode lookup |
| `Observation` (vital signs) | BP, HR, weight, height, BMI | `objectiveMeasures`, `watch.recentResults` |
| `Observation` (lab) | A1c, lipid, CBC, etc. | `watch.recentResults` |
| `MedicationStatement` / `MedicationRequest` | Active med list | `watch.recentMedChanges` |
| `Condition` | Active diagnoses + problem list | `episodeContext.label`, `priorAssessment` corroboration |
| `AllergyIntolerance` | Allergy list | `watch.precautions` |
| `DiagnosticReport` | Imaging, pathology, ECG | `watch.recentResults` |
| `Procedure` | Procedural history | `priorAssessment` corroboration |

The mapping layer is a deterministic function — no LLM here. It produces structured objects the brief generator's existing prompt (Phase 23) can include in a new `<external_ehr_context>` block of the user message.

## 8. Caching + refresh policy

- **Default refresh on a returning visit.** When a patient's prepare screen opens, if their FHIR cache was last fetched > 24h ago AND a clinician with valid `FhirIdentity` is logged in, enqueue a sync job. Brief renders from existing cache while sync runs.
- **Manual refresh** via a small "Sync EHR" affordance in the prior-context panel. Useful when the clinician knows new data landed since the last cache refresh.
- **Time-based expiry**: 7-day max cache age. Beyond that, brief surfaces *"EHR data older than 7 days — sync to refresh"* in amber.
- **Resource-type granularity**: medications and allergies refresh more eagerly than imaging/procedures (medications change visit-to-visit; imaging is more stable).

The sync worker uses the same BullMQ pattern as `note-brief.worker.ts`. Anti-regression rule 16 applies: must run inside `npm run dev:workers`.

## 9. Brief generator FHIR integration

Phase 23's `BriefBuilderInput` extends to include an optional FHIR context block:

```ts
export interface BriefBuilderInput {
  // existing fields unchanged
  todayIso: string;
  patient: { … };
  episodeContext: { … } | null;
  priorNotes: PriorNoteForBrief[];
  goalTimeline: BriefGoalTimelineEntry[];

  // NEW
  fhirContext?: {
    fetchedAt: string;          // ISO of most recent successful sync
    medications: FhirMedicationSummary[];
    allergies: FhirAllergySummary[];
    recentVitals: FhirVitalSnapshot[];
    recentLabs: FhirLabSnapshot[];
    recentImaging: FhirImagingSummary[];
    activeConditions: FhirConditionSummary[];
  } | null;
}
```

`BRIEF_SYSTEM_PROMPT` from Phase 23 gains a new section:

```
═══ EXTERNAL EHR CONTEXT (v1) ═══

You may receive a `<external_ehr_context>` block in the user message. When
present, it contains medications, allergies, vitals, labs, imaging, and
active conditions pulled from the patient's external EHR (e.g. NextGen) via
FHIR.

Treat this data identically to OmniScribe note content for source-grounding
purposes: source-grounded only, verbatim where precision matters, no
clinical conclusions beyond what's stated. Cite via `sourceFhirId` (analogous
to `sourceNoteId`) so every fact tap-throughs to its FHIR resource.

When the FHIR cache is stale (>7 days), the user message will include a
freshness annotation. Surface that staleness in `watch.recentResults`
explicitly (e.g. "Med list synced 9 days ago — verify before relying").
```

Output `PriorContextBrief` schema gains a `sourceFhirId` field on `objectiveMeasures` entries (and other facts) so provenance is preserved end-to-end.

## 10. Provenance + UI surfacing

Every fact in the rendered brief gets a small source pill:

```
LAST CLINICAL IMPRESSION
Improving — pain trending down, AROM gains in flex/abd.
                                                  [OmniScribe · Apr 6]

WATCH
• New gabapentin 300mg started Apr 22  (drowsiness check)
                                              [NextGen · synced 1d ago]
• HTN flagged uncontrolled last visit — re-check BP
                                              [OmniScribe · Apr 6]
```

Tap-through behavior:
- OmniScribe pills route to the source note (existing behavior)
- FHIR pills open a small drawer showing the raw FHIR resource (or a friendly view) with the original system + ID + fetched-at timestamp

## 11. HIPAA / 42 CFR Part 2 / compliance

- **All FHIR data is PHI** and inherits the existing OmniScribe access controls (`canAccessPatientResource`, `canAccessNoteSensitivity`).
- **42 CFR Part 2 sensitivity propagation**: if the source FHIR resource is flagged with `meta.security` containing the SAMHSA confidentiality codes (`R`, `42CFRPart2`, etc.), `FhirCachedResource.sensitivityLevel` records that classification and the brief's reader-access checks honor it. **This is non-trivial** — get legal review on the propagation rules before live ingestion.
- **OAuth tokens** stored encrypted at rest in Postgres. Encryption key in AWS KMS. OAuth client secret in AWS Secrets Manager (anti-regression rule 14).
- **No PHI in audit log metadata**: log `ehrSystem`, `resourceType`, `fhirResourceId`, response codes, latency — never resource bodies.
- **Audit every FHIR fetch**: `FHIR_RESOURCE_FETCHED` audit log entry per resource, written under the existing `auditLog` helper (rule 8 — never silently swallow).
- **Data minimization**: only request scopes you'll use. The v1 scope list (§5) is already minimized; don't add scopes pre-emptively.
- **Tribal sovereignty**: tribal health deployments may require additional data-residency or access-control review beyond HIPAA. Each deployment needs its own compliance pass.
- **BAA with AWS**: existing. Bedrock + RDS already covered.
- **No BAA required with the EHR vendor** for FHIR API access in most cases — the data flow is patient-initiated (via clinician auth) and stays within the clinical-care exception. Confirm per-vendor.

## 12. Phasing roadmap

Six phases. Each independently shippable but with linear dependencies.

| Phase | Title | Risk | Notes |
|---|---|---|---|
| F1 | FHIR client + auth foundations | Medium | SMART on FHIR OAuth2, encrypted token storage, single-vendor adapter for NextGen |
| F2 | Patient identity matching | Medium | `PatientFhirIdentity` table + clinician-confirmed match flow + bidirectional lookups |
| F3 | Resource sync worker + cache | Medium | BullMQ worker, `FhirCachedResource` table, refresh policy, retry semantics |
| F4 | Resource mapping + brief integration | Low | Deterministic FHIR → brief field translation; extend Phase 23 prompt with `<external_ehr_context>` block |
| F5 | Provenance UI in prior-context panel | Low | Source pills, FHIR resource drawer, staleness chip |
| F6 | Multi-EHR adapter abstraction | Medium | Generalize NextGen adapter to support Epic / Cerner; defer until F1–F5 land |

### Phase boundaries (the gates)

- **F1 ships when** a clinician can launch from NextGen, complete OAuth2, and the resulting token is encrypted in Postgres and refreshed before expiry. No data fetching yet — auth only.
- **F2 ships when** an OmniScribe Patient can be linked to its FHIR Patient at the EHR with explicit clinician confirmation, and identity rows are queryable in both directions.
- **F3 ships when** a manual "Sync EHR" trigger pulls the v1 scope list (§5), persists to `FhirCachedResource`, and audit-logs each fetch. Brief still doesn't consume yet.
- **F4 ships when** the brief generator includes FHIR context in its prompt and `PriorContextBrief` carries `sourceFhirId` provenance on FHIR-derived facts.
- **F5 ships when** the brief card UI surfaces source pills with tap-through to the raw FHIR resource (or a friendly view) and shows freshness/staleness chips.
- **F6 ships when** an Epic-on-FHIR or Cerner-on-FHIR org can configure the same flow with a vendor-specific adapter and no app-code changes outside the adapter module.

### Cursor-task derivation

When ready to execute, derive numbered task files in `cursor-tasks/`:

- `30-fhir-client-auth-foundations.md` (F1)
- `31-fhir-patient-identity-matching.md` (F2)
- `32-fhir-resource-sync-worker.md` (F3)
- `33-fhir-brief-integration.md` (F4)
- `34-fhir-provenance-ui.md` (F5)
- `35-fhir-multi-ehr-adapter.md` (F6)

(Slot 29 reserved for whatever small follow-up appears between now and FHIR kickoff.)

## 13. Open questions (deferred)

- **Vendor specificity**: NextGen's FHIR R4 endpoint scopes and quirks need empirical exploration. Sandboxes are available; budget 1–2 weeks for vendor-specific quirks discovery.
- **Patient identity matching UX**: how aggressively does the system auto-match vs. require clinician confirmation? Default to "system suggests, clinician confirms" but the friction tradeoff is real.
- **Refresh policy granularity**: should medications and labs refresh on different cadences? Probably yes, but defer optimization.
- **DocumentReference scope**: explicitly out of scope for v1, but the data model (`FhirCachedResource.resourceType`) doesn't preclude it. v2 conversation.
- **Bulk Data Access (FHIR Bulk)**: useful for initial patient-population sync; defer to v2.
- **Per-clinician FHIR identity vs. per-org**: v1 is per-clinician (each clinician auths separately). Per-org service accounts are easier operationally but harder for audit. v2 conversation.

## 14. Anti-patterns to avoid

- Do **not** call FHIR endpoints synchronously from the prepare/capture render path. Always read from `FhirCachedResource`; sync runs in the background worker.
- Do **not** store OAuth tokens in plaintext or in env vars (rule 14). KMS-encrypted in Postgres only.
- Do **not** swallow FHIR fetch errors silently — every failure writes a `FHIR_FETCH_FAILED` audit log entry (rule 8).
- Do **not** stand up a second BullMQ worker fleet for FHIR sync against the same Redis as the existing fleet (rule 18). Add the new worker to the existing fleet.
- Do **not** auto-import every FHIR resource at first sync; respect rate limits and use the v1 scope list to bound payload size.
- Do **not** pretend FHIR data is fresher than it is. Stale data plus a missing freshness indicator is the worst possible UX in clinical work.
- Do **not** let the LLM generate facts that aren't in the FHIR cache. Anti-hallucination guards from Phase 23 apply identically.

## 15. Success metrics (Track phase, per AGENT framework)

Capability-expansion metrics, not activity metrics:

- **Median chart-review time per returning visit** (already a brief-system metric; FHIR should drop it further toward zero NextGen openings)
- **% of returning visits where the clinician opens NextGen manually** before/after (target: ≥ 80% reduction once FHIR is live)
- **Med-list reconciliation accuracy**: random spot-check of OmniScribe brief med list vs. NextGen current. Target: ≥ 95% match.
- **FHIR sync success rate**: percentage of triggered syncs that complete without fallback. Target: ≥ 99%.
- **Time from "patient mention triggers context" to "context surfaces"**: only relevant when visit-time medical assistant lands; defer instrumentation.

Reject as success metrics: "FHIR resources cached," "syncs per day," "tokens refreshed." Those are activity metrics.

## 16. What this unlocks downstream

Once FHIR is live, three further capabilities become buildable:

1. **Visit-time medical assistant** — keyword-triggered FHIR queries during the encounter (the original 30-second-card brainstorm)
2. **Cross-discipline continuity** — PT seeing what the prescribing physician documented; behavioral health seeing the medical history (with 42 CFR Part 2 honoring)
3. **Bring-your-own-EHR onboarding** — new clinics adopt OmniScribe without ripping out their existing EHR; OmniScribe becomes the documentation layer over the existing record

The architecture in this spec preserves the option to build all three without rewriting the foundation.
