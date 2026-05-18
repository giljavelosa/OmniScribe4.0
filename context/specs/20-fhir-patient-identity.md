# Unit 20: FHIR — Patient Identity Matching (F2)

## Goal

Wave 4 / F2. Bridge the OmniScribe `Patient` row to the EHR's `Patient` resource so F3 (Unit 21) can fetch Observations / Conditions / Medications for the right person. The clinician confirms every link — auto-match is a hint, not a fact.

Builds directly on:
- Unit 19's `PatientFhirIdentity` schema (shipped but no CRUD yet)
- The `launchPatientFhirId` hint Unit 19 persists on `FhirIdentity` after a NextGen launch (NextGen typically embeds patient context)
- Unit 19's `decryptToken` + `smart-client.resolveSmartConfig` for talking to the EHR

## Design

### Match confidence states

Already in the schema; locking the semantics here so F3 + the UI agree:

- **`'verified'`** — Clinician explicitly confirmed via the UI ("Yes, this is the patient"). `verifiedAt` + `verifiedByOrgUserId` set. F3 may fetch resources against this link.
- **`'high'`** — Auto-match from the launch context's `launchPatientFhirId` OR from a search where MRN + DOB + last name all matched exactly. F3 **refuses** to fetch against high-but-unverified — the panel surfaces a "Confirm match" CTA. Prevents a wrong-patient resource fetch from happening before the clinician has eyeballed it.
- **`'manual'`** — Clinician searched + selected a candidate but didn't tick the confirmation checkbox. Effectively the same as 'high' for F3 read gating; surfaces in the panel as "Pending confirmation."

The distinction between `'high'` and `'manual'` is provenance for the auditor (auto-match vs. clinician-selected); both block F3 reads until the clinician promotes to `'verified'`.

### Match flow (clinician-driven)

```
Patient detail page
  ↓
EhrLinkPanel
  ├─ No PatientFhirIdentity? → "Link to NextGen" button
  ├─ Has 'high'/'manual'? → "Confirm match" banner + Verify CTA
  └─ Has 'verified'? → "Connected" badge + Unlink

Link to NextGen click:
  1. Server checks the clinician has a FhirIdentity for this org+ehr
     (if not, redirect to /admin/integrations/fhir with a "Connect first" hint)
  2. Opens MatchDialog:
       - Prefills with local patient's lastName + dob
       - If FhirIdentity.launchPatientFhirId is set, fetches that
         specific candidate first ("Likely match from your last launch")
       - Renders candidate list as cards (name + dob + identifier + match
         badge if exact)
       - Clinician picks one, ticks "I confirm this is the same person",
         submits → POST creates PatientFhirIdentity at 'verified'

Auto-match from launch:
  Out of scope for F2. Could be a future polish where every successful
  /api/fhir/callback that returned `patient` writes a 'high'-confidence
  link automatically. We're keeping F2 honest by requiring explicit
  clinician action.
```

### FHIR Patient client

`src/services/fhir/patient-client.ts`:

- `searchPatients(opts: { identity, lastName?, given?, birthdate?, identifier? })` — issues `GET /Patient?family=…&given=…&birthdate=…` against the EHR, returns simplified candidates `{ id, given, family, birthDate, identifier, gender }`.
- `readPatient(opts: { identity, fhirPatientId })` — issues `GET /Patient/{id}`, returns one candidate.
- Stub mode: synthesizes 3 candidates per search — one exact match on the requested name + dob, one close-but-not-exact ("Jonh" instead of "John"), one false positive (different dob). Lets the confirmation UI be exercised end-to-end.
- Tokens decrypted lazily per call from the supplied `FhirIdentity`. Auto-refreshes if `expiresAt < now + 5min` — uses the same `refreshAccessToken` helper from Unit 19's smart-client, persists the new tokens before continuing.

### APIs

- `GET /api/fhir/patients/search?lastName=…&given=…&birthdate=…&identifier=…` — clinician-side search. NextAuth-gated; resolves the clinician's FhirIdentity for `(orgUserId, 'nextgen')` and forwards to `searchPatients`. Returns `{ data: { candidates: FhirPatientCandidate[] } }`. Audits `FHIR_PATIENT_SEARCH` with the search shape (field names, not values — PHI fence).
- `POST /api/patients/[id]/fhir-identities` — body: `{ ehrSystem, fhirPatientId, confirmed: true }`. Persists a `PatientFhirIdentity` row at 'verified' confidence + sets `verifiedAt` + `verifiedByOrgUserId`. Audits `FHIR_PATIENT_LINK_CREATED`. Refuses 409 if a link to that `(ehrSystem, fhirPatientId)` already exists for ANY patient (the unique index enforces it; we surface a clean error).
- `DELETE /api/patients/[id]/fhir-identities/[fid]` — unlinks. Hard-deletes the row (the audit row is the history). Audits `FHIR_PATIENT_LINK_REMOVED` with a reason.
- `PATCH /api/patients/[id]/fhir-identities/[fid]` — body: `{ matchConfidence: 'verified' }`. Promotes a `'high'`/`'manual'` row to `'verified'`. Audits `FHIR_PATIENT_LINK_VERIFIED`. Used for the future auto-match flow; F2's manual flow always creates at `'verified'` directly, but the endpoint is here for F3+ uses.

### UI

- `src/components/fhir/ehr-link-panel.tsx` — server component, takes `patientId`. Reads the clinician's `FhirIdentity` (to check connection status) + the existing `PatientFhirIdentity` rows for the patient. Renders one of three states (no link, pending, verified) with the appropriate CTA.
- `src/components/fhir/match-dialog.tsx` — client. Triggered by the panel's "Link to NextGen" button. Search form + candidate list + confirmation checkbox. Posts to `/api/patients/[id]/fhir-identities`.
- `src/components/fhir/unlink-button.tsx` — client. AlertDialog → DELETE.

The panel slots into `/patients/[id]` between InlineDemographics and the right-rail cards.

### Audit actions

- `FHIR_PATIENT_SEARCH` — metadata: `{ ehrSystem, fields: ['lastName', 'birthdate', ...] }`. **Never the values** — PHI fence at the audit metadata writer.
- `FHIR_PATIENT_LINK_CREATED` — metadata: `{ ehrSystem, fhirPatientId, matchConfidence, source: 'manual_confirmation' }`. fhirPatientId is the EHR's identifier, not PHI per HIPAA Safe Harbor; LIN ed to the local patient via the row's patientId.
- `FHIR_PATIENT_LINK_VERIFIED` — metadata: `{ ehrSystem, fhirPatientId, previousConfidence }`.
- `FHIR_PATIENT_LINK_REMOVED` — metadata: `{ ehrSystem, fhirPatientId, reason }`.

## Implementation order

1. Spec + audit actions (this commit)
2. FHIR patient client + tests
3. APIs (search + create + verify + remove)
4. EhrLinkPanel UI on /patients/[id]
5. Tracker + PR #21

## Out of scope (F2)

- Auto-matching at launch time (future polish; the launch already persists `launchPatientFhirId` as a hint that the panel surfaces in MatchDialog as "Likely match")
- Cross-EHR matching (one EHR per row; multi-EHR is F6 / Unit 24)
- Patient demographics sync from the EHR (changing first/last name in NextGen does not propagate; F3 will surface stale-data warnings)
- FHIR Patient.identifier system OID resolution (we record the raw identifier string; canonical system resolution is a future polish)

## Verify when done

- `/api/fhir/patients/search` returns 3 stub candidates for any non-empty query when stub-mode is on.
- `POST /api/patients/[id]/fhir-identities` with `confirmed: true` creates a 'verified' row + writes `FHIR_PATIENT_LINK_CREATED` audit.
- Re-POSTing the same `(ehrSystem, fhirPatientId)` for a different local patient → 409 with a clean error.
- `DELETE` removes the row + writes `FHIR_PATIENT_LINK_REMOVED` audit.
- EhrLinkPanel renders three states correctly: no link / pending / verified.
- Clinician who hasn't connected the EHR yet (no FhirIdentity) sees a "Connect EHR first" CTA pointing at `/admin/integrations/fhir`.
- progress-tracker.md updated; PR #21 stacked on Unit 19.
