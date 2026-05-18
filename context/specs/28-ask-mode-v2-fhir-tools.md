# Unit 28: Ask Mode v2 — FHIR Tools

## Goal

Wave 5 / Phase 53 continuation. Unit 27 shipped 4 in-app lookup tools (signed notes, follow-ups, episode goals, patient demographics). Unit 28 extends the agent's tool registry with 5 EHR-backed lookups so a clinician can ask "is she on any blood pressure meds the EHR knows about?" and the agent reads from Unit 21's `FhirCachedResource` instead of saying "I don't have that information."

> **Unit 28 ships when** a clinician's Ask question that needs an EHR lookup (med list, recent labs, allergies) gets answered with rows from `FhirCachedResource`, gated by Unit 20's `'verified'` `PatientFhirIdentity`, with a per-session rate-limit ceiling that prevents the agent from pulling more than 100 FHIR rows across a single conversation.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Tool set (v1) | 5 tools: `lookupFhirCondition`, `lookupFhirMedication`, `lookupFhirObservation`, `lookupFhirAllergy`, `lookupFhirCarePlan`. CarePlan ships even though its adapter is Wave 4.5 — the tool reads `FhirCachedResource` directly, so it returns empty until adapter+sync land. Forward-compatible. |
| 2 | Rule 20 gate | Every FHIR tool requires a `'verified'` `PatientFhirIdentity`. No verified link → tool error → model gets `verified_link_required` on its next turn and surfaces it as a clarification ("This patient isn't linked to an EHR record yet — confirm the match on the patient page."). |
| 3 | Per-tool result cap | Hard cap at 20 rows per tool invocation. Bounds prompt growth on the next turn. |
| 4 | Per-session rate-limit | `MAX_FHIR_ROWS_PER_SESSION = 100`. Tracked in agent context; each FHIR tool increments. Once exceeded, FHIR tools return `fhir_rate_limit_exceeded`; non-FHIR tools (Unit 27) still work. |
| 5 | Staleness | Honors Unit 21's 7-day threshold (`isStale`) — stale rows are EXCLUDED from results. Same rationale as Unit 22 brief enrichment: "better to surface no EHR data than stale EHR data." |
| 6 | Sources | New source kind `'fhir'` with `id = fhirResourceId`, `label = <human display>`. The Unit 27 SourceChip renders as a text chip (no /review link); future polish can deep-link to the ProvenanceDrawer the EhrSourcePill (Unit 23) already opens. |
| 7 | Audit | Reuses `COPILOT_TOOL_CALL` (Unit 27). Tool name in metadata distinguishes FHIR from non-FHIR. No new audit action needed. |

## Design

### Tool signatures

```typescript
lookupFhirCondition({ patientId, clinicalStatus? = 'active' })
  → { conditions: Array<{ fhirResourceId, display, code, clinicalStatus, onsetDate, fetchedAt }> }

lookupFhirMedication({ patientId, status? = 'active' })
  → { medications: Array<{ fhirResourceId, display, status, sourceType, fetchedAt }> }
  // sourceType: 'MedicationStatement' | 'MedicationRequest'

lookupFhirObservation({ patientId, code? })
  → { observations: Array<{ fhirResourceId, display, code, value, unit, effectiveDate, fetchedAt }> }
  // code arg lets the model narrow by LOINC if it knows one

lookupFhirAllergy({ patientId })
  → { allergies: Array<{ fhirResourceId, display, category, criticality, fetchedAt }> }

lookupFhirCarePlan({ patientId })
  → { carePlans: Array<{ fhirResourceId, raw, fetchedAt }> }
  // adapter ships in Wave 4.5; v1 returns { raw: ... } directly
```

All accept `patientId` (model gets it from context). All return arrays capped at 20 rows post-staleness-filter.

### Pre-flight checks (per tool)

Each FHIR tool runs the same boilerplate before its Prisma query:
1. `assertOrgScoped(patient.orgId, ctx.orgId)` — defense in depth
2. Resolve verified `PatientFhirIdentity` for `(patientId, ehrSystem='nextgen')` — return `verified_link_required` error if absent
3. Check `ctx.fhirRowsConsumed < MAX_FHIR_ROWS_PER_SESSION` — return `fhir_rate_limit_exceeded` error if at/over

Helper: `assertFhirReadable(args, ctx) → { ok: true, link } | { ok: false, error }` keeps the boilerplate to one line per tool.

### Rate-limit plumbing

`AgentContext` gains `fhirRowsConsumed: { count: number }` (object so each tool can mutate by reference). Agent runner initializes it to `{ count: 0 }` at the start of `runAgent`. FHIR tools increment after a successful fetch. Non-FHIR tools (Unit 27) ignore it.

### System prompt addition

Append a new "FHIR LOOKUPS" section to `ASK_SYSTEM_PROMPT`:

```
═══ FHIR LOOKUPS (Unit 28) ═══

When the question is about the patient's chart-side data (active conditions, current
medications, recent labs, allergies, care plan), prefer these EHR-backed tools over
asking the clinician. They read from a verified link to the patient's EHR record:

  - lookupFhirCondition({ patientId, clinicalStatus? }) — chart conditions
  - lookupFhirMedication({ patientId, status? }) — chart med list
  - lookupFhirObservation({ patientId, code? }) — recent labs/vitals
  - lookupFhirAllergy({ patientId }) — chart allergies
  - lookupFhirCarePlan({ patientId }) — care plans

When a FHIR tool returns { error: "verified_link_required" }, answer the clinician:
"This patient isn't linked to an EHR record yet. Confirm the match on the patient
page (EhrLinkPanel) to enable EHR-backed answers."

When a FHIR tool returns { error: "fhir_rate_limit_exceeded" }, answer with what you
already have and tell the clinician you've hit the session lookup budget.

Sources for FHIR-derived facts use kind: "fhir" with id = fhirResourceId.
```

## Implementation order

1. Spec + system prompt extension + tool-source kind update (this commit)
2. 5 FHIR tools + per-tool tests
3. Rate-limiter plumbing in agent context + integration tests
4. Tracker + PR #29

## Out of scope (Unit 28)

- Native Bedrock Converse tool-use migration (still Unit 27's prompt-engineered loop)
- Deep-linking FHIR source pills to the ProvenanceDrawer (future polish)
- Per-tool latency budgets (rate-limit is a row-count budget, not a time budget)
- Streaming responses (full responses still; Wave 6 polish)

## Verify when done

- 5 new tools dispatch via `runTool` with the new names.
- `lookupFhirMedication({ patientId })` for a patient with verified link returns rows from cache.
- Same call for a patient WITHOUT verified link returns `{ error: 'verified_link_required' }`.
- Calling FHIR tools repeatedly past 100 rows returns `fhir_rate_limit_exceeded`.
- Sources `kind: 'fhir'` render in the chat surface as text chips.
- `COPILOT_TOOL_CALL` audit rows fire per FHIR tool invocation with the right tool name.
- progress-tracker.md updated; PR #29 stacked on Unit 27.
