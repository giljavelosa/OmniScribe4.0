# Unit 48: Pre-Visit Brief — Visit-Type Intent + Intent-Aware Spine

> **Wave 1 extension / Unit 06 depth.** Not Wave 8 (Miss Cleo persona work) — does not require persona maturity to ship; the polish gate ahead of Wave 7/8 does not apply.

## Goal

Turn the prior-context brief from *"what happened last visit"* into *"what's about to happen this visit."*

Today, Miss Cleo's brief is shape-blind: a Progress Note visit and a Daily Note visit get the same brief layout, the same prompt instructions, and the same "top 3 active goals" snapshot. That's adequate for a daily touch but **fails the Medicare-grade Progress Note** — which must address every goal, document medical necessity, and justify continued care.

This unit:

1. Models the clinical purpose of each encounter via `Encounter.intent` (Initial Eval / Daily / Progress / Re-eval / Discharge for REHAB, with BH and MEDICAL equivalents — see [`references/visit-type-taxonomy.md`](../../references/visit-type-taxonomy.md))
2. Wires Miss Cleo to **propose** the intent at the `StartVisitDialog` moment, with a one-tap confirm and an override dropdown
3. Branches the brief generator + renderer so the spine shape-shifts per `(division, intent)` for four high-value MVP pairs

After this unit, the clinician sees *"Progress Note — change ▾"* at start time. They confirm. They go to `/prepare` and the brief foregrounds the goal ledger + medical-necessity scaffold. They walk into the room ready.

> **Unit 48 ships when** the clinician taps a patient from any entry path (chart hero, schedule card, patient list), Cleo proposes a clinically-correct intent with a human-readable reason, the encounter is created with `intent` recorded, and the brief on `/prepare` renders the intent-aware spine for the four MVP pairs.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Intent is **encounter-scoped, not schedule-scoped** | `Schedule.visitType` stays as modality (IN_PERSON / TELEHEALTH). Intent lives on `Encounter.intent` because it's set at start time when Cleo has the full prior-context picture, not at scheduling time. |
| 2 | Intent is **append-only enum** per rule 2 | Adds, never removes or renames. Same discipline as `NoteStatus`. |
| 3 | Cleo **proposes**, clinician **decides** | The server records what the clinician selected; no API-layer enforcement that intent matches episode state. Cleo is a copilot, not a gate. |
| 4 | MVP ships **four** intent-aware spines | `REHAB_PROGRESS_NOTE`, `REHAB_REEVAL`, `BH_TREATMENT_PLAN_REVIEW`, `MEDICAL_ANNUAL_WELLNESS`. All other intents fall back to Unit 06's existing generic spine. Other pairs ship in follow-on units. |
| 5 | Brief schema gains **one new optional field** (`intent`); renderers branch on it | No other Brief schema fields change in v1. New section components (`<GoalLedger>`, `<MedicalNecessityScaffold>`, `<RiskTrendSparkline>`, `<CareGapsList>`) are intent-gated and additive. Pre-Unit-48 briefs continue to render. |
| 6 | Intent proposer is **fully deterministic** — no LLM call | Calculator runs from `(episode state, schedule, prior notes, division)`. LLM cost = $0. Sub-millisecond response. |
| 7 | Fallback is **silent + safe** | If `/proposed-intent` fails or times out, the chip shows `UNSPECIFIED` and the override dropdown opens by default. Cleo's latency never blocks visit start. |
| 8 | Override dropdown is **division-filtered** | A REHAB clinician's dropdown only shows `REHAB_*` intents. Cross-division choices are an error class we don't model. |
| 9 | Intent is **stamped at encounter create**, regenerable in future units | If the clinician realizes mid-visit they need a different intent, they edit on `/review` — that's a later unit, not v1. v1 records the intent as stated at start. |
| 10 | Three-lens applies | Clinician (Cleo prepares me for the visit), Compliance (Progress Note spine includes medical-necessity scaffold), Auditor (`intent` + `intentSource` recorded in audit metadata + on Encounter). |
| 11 | **Sibling files, never modify shipped paths in PR3** | Risk reduction: existing `BriefGenerator.ts`, `<BriefCard>`, `BriefLLMOutputSchema`, and the capture/telehealth/sign-time-sweep render surfaces stay byte-for-byte identical. The intent-aware path is composed alongside via `IntentAwareBriefGenerator`, `<IntentAwareBriefCard>`, `RehabProgressBriefShapeSchema` (in a new file `src/types/brief-intent-shapes.ts`), and a top-of-handler dispatcher in the worker. The existing `<BriefCard>` gains exactly **one** new optional prop (`spineSlot`, defaults to null). A snapshot regression test gates the merge. Drives PR3 regression risk from ~5–8% to ~2–3%. A cleanup unit (~48.5) after 2–3 weeks of prod validation folds siblings back into the main path. |

## Design

Read [`references/visit-type-taxonomy.md`](../../references/visit-type-taxonomy.md) for the full taxonomy (intent variants, CMS triggers, brief-spine mapping table) and [`references/brief-chain-state-of-play.md`](../../references/brief-chain-state-of-play.md) for the audit that motivates the scope.

### The flow (one frame)

```
Clinician taps a patient (chart hero / schedule card / patient list)
        │
        ▼
Client fires GET /api/patients/[id]/proposed-intent
  (parallel to the existing case/episode preflight queries)
        │
        ▼
IntentProposer (deterministic) returns { intent, division, reason }
        │
        ▼
StartVisitDialog opens with the chip at top:
   ┌─────────────────────────────────────────┐
   │ 🧭 Progress Note — change ▾             │
   │    visit 10 of 30 · last progress note  │
   │    was at the eval                       │
   └─────────────────────────────────────────┘
        │
        ▼
Clinician confirms (chip is preselected) OR overrides via dropdown
        │
        ▼
POST /api/encounters  body: { patientId, intent, intentSource, ... }
   server records intent on Encounter
        │
        ▼
Navigate to /prepare/[noteId]
        │
        ▼
prepare page reads encounter.intent → BriefCard branches the spine
   Progress Note → <GoalLedger> + <MedicalNecessityScaffold>
   Re-eval      → <ObjectiveMeasureHistory> + revision flags
   BH TPR       → <RiskTrendSparkline> + <GoalLedger>
   AWV          → <CareGapsList> + screening calendar
   else         → today's Unit-06 spine
```

The brief WORKER also passes `intent` to the generator so the next visit's brief content is shaped by what kind of visit this just was — but in v1 the prompt's intent branch is read-only at render time. The worker writes `intent` on `NoteBrief.content` so the renderer doesn't need a second join.

### What stays the same

- Brief generation timing (post-sign, same worker, same idempotency)
- NoteBrief table, indexes, audit posture
- `/prepare`, `/capture`, sign-time sweep render paths
- All existing brief components (`<BriefCard>`, `<TrajectoryTable>`, `<FollowUpPreviewList>`, etc.)
- Empty-state variants (`first-visit`, `unavailable`)
- Sign-time sweep behavior (open follow-ups force a decision; intent doesn't change that)
- FHIR enrichment + provenance
- Source pills on every fact (rule 20)

### What's net-new

| Surface | What | Spec section |
|---|---|---|
| Prisma | `EncounterIntent` + `IntentSource` enums; `Encounter.intent` + `intentSource` fields | §A |
| Service | `src/services/copilot/intent-proposer.ts` | §B |
| API | `GET /api/patients/[id]/proposed-intent` | §C |
| UI | Intent chip in `<StartVisitDialog>`; override dropdown | §D |
| API | `POST /api/encounters` accepts + records `intent` + `intentSource` | §E |
| Prompt | New `IntentAwareBriefGenerator` (sibling — existing `BriefGenerator` untouched); spine modules per `(division, intent)` | §F |
| Worker | Top-of-handler dispatcher in `note-brief` (existing handler block byte-for-byte unchanged); audit metadata records `intent` from both paths | §G |
| UI | New `<IntentAwareBriefCard>` wrapper (existing `<BriefCard>` gains one optional `spineSlot` prop only); new spine components `<GoalLedger>`, `<MedicalNecessityScaffold>`, `<RiskTrendSparkline>`, `<CareGapsList>` | §H |
| Schema | One additive nullable+optional `intent` field on `PriorContextBriefContentSchema`; spine shapes live in new file `src/types/brief-intent-shapes.ts` (`BriefLLMOutputSchema` untouched) | §I |

## Implementation

### A. Prisma schema additions

```prisma
enum EncounterIntent {
  UNSPECIFIED
  REHAB_INITIAL_EVAL
  REHAB_DAILY_NOTE
  REHAB_PROGRESS_NOTE
  REHAB_REEVAL
  REHAB_DISCHARGE
  BH_INITIAL_ASSESSMENT
  BH_SESSION_INDIVIDUAL
  BH_SESSION_FAMILY
  BH_SESSION_GROUP
  BH_TREATMENT_PLAN_REVIEW
  BH_CRISIS_REASSESSMENT
  BH_DISCHARGE
  MEDICAL_NEW_PATIENT
  MEDICAL_FOLLOW_UP
  MEDICAL_ANNUAL_WELLNESS
  MEDICAL_CHRONIC_CARE
  MEDICAL_ACUTE_VISIT
  MEDICAL_DISCHARGE_TCM
  MEDICAL_TELEHEALTH_CHECKIN
}

enum IntentSource {
  CLINICIAN
  COPILOT_PROPOSAL_CONFIRMED
  SCHEDULE
}

model Encounter {
  // ... existing fields ...
  intent       EncounterIntent @default(UNSPECIFIED)
  intentSource IntentSource    @default(CLINICIAN)
}
```

Migration: pure additive ALTER TABLE. All existing rows default to `UNSPECIFIED` + `CLINICIAN`. Append-only thereafter per rule 2.

### B. IntentProposer service

`src/services/copilot/intent-proposer.ts`:

```ts
export type IntentProposalInput = {
  division: Division;
  episode: { visitsCompleted: number; recertDueAt: Date | null; status: EpisodeStatus } | null;
  priorNotes: { signedAt: Date; intent: EncounterIntent }[];
  schedule: { notes: string | null } | null;
  patient: { medicareEligible: boolean; lastAWVAt: Date | null } | null;
};

export type IntentProposal = {
  intent: EncounterIntent;
  reason: string;          // human-readable, ~80 chars; e.g. "visit 10 of 30, last progress note at the eval"
  confidence: 'high' | 'medium' | 'low';
};

export function proposeIntent(input: IntentProposalInput): IntentProposal;
```

Deterministic calculator per [`visit-type-taxonomy.md`](../../references/visit-type-taxonomy.md) §3.2 / §4.2 / §5.2:

- **REHAB:** zero priors → IE; episode discharged or readiness signals → DISCHARGE; significant change → REEVAL; visits since last progress note ≥ 10 OR days since ≥ 30 → PROGRESS; else DAILY
- **BH:** zero priors → INITIAL_ASSESSMENT; recent risk escalation → CRISIS_REASSESSMENT; clinician discharge signal → DISCHARGE; days since last TPR ≥ 90 → TREATMENT_PLAN_REVIEW; scheduled-as-family/group respected; else SESSION_INDIVIDUAL
- **MEDICAL:** zero priors / not seen in 3y → NEW_PATIENT; recent hospital discharge ≤ 14d → DISCHARGE_TCM; ≥ 11 months since AWV + Medicare-eligible → ANNUAL_WELLNESS; schedule notes contain "same-day" / "urgent" → ACUTE_VISIT; CCM-enrolled → CHRONIC_CARE; else FOLLOW_UP

Unit tests cover each calculator branch — cadence math (10-visit + 30-day thresholds, AWV annual window, TCM 14-day window), and the `confidence` levels. No LLM call.

### C. API endpoint

`GET /api/patients/[id]/proposed-intent?episodeId=&caseId=&scheduleId=`

```ts
{ data: { intent: EncounterIntent, division: Division, reason: string, confidence: 'high'|'medium'|'low' } }
```

- Guards with `requireFeatureAccess('NOTE_CREATE', req)` — same gate as the existing visit-start preflight
- Reads episode state, schedule context, last 3 prior signed notes (intent + signedAt only — small projection)
- Calls `proposeIntent()` and returns the result
- **In-memory LRU cache per `(patientId, episodeId, clinicianOrgUserId)` for 60s** — episode state changes rarely; cache shaves a DB round-trip off the visit-start critical path
- Returns `200 { intent: UNSPECIFIED, division, reason: '', confidence: 'low' }` on any internal error — never 5xx the visit-start preflight

### D. StartVisitDialog extension

`src/app/(clinical)/patients/[id]/_components/start-visit-dialog.tsx`:

- Parent (caller) fetches `/proposed-intent` in the same `Promise.all()` that already loads active cases. Result passed in as a new `proposedIntent` prop.
- New `<IntentChip>` sub-component renders at the top of both `AutoPostShell` and `PickerShell`:

```
┌──────────────────────────────────────────────┐
│ 🧭 Progress Note — change ▾                  │
│    visit 10 of 30 · last progress note       │
│    was at the eval                            │
└──────────────────────────────────────────────┘
```

- Chip is a `<Button variant="outline">` with the proposal label. Tap opens a `<Select>` whose options are `division`-filtered intents in a stable order (taxonomy order). Default selection = the proposal.
- Sub-text is the `reason` from the proposer.
- If `proposedIntent.intent === UNSPECIFIED`, the chip reads *"Visit type — choose ▾"* and clicking is required before submit (only enforced when both `confidence === 'low'` AND the clinician hasn't picked manually).
- In `AutoPostShell`, the chip renders briefly and the auto-post fires unless `confidence === 'low'` (then the dialog stays open as a picker).
- Submit captures `intent` + `intentSource` (`COPILOT_PROPOSAL_CONFIRMED` if the clinician took the default, `CLINICIAN` if overridden).

### E. POST /api/encounters extension

`src/app/api/encounters/route.ts`:

- Body schema gains:
  ```ts
  intent?: z.nativeEnum(EncounterIntent).optional(),
  intentSource?: z.nativeEnum(IntentSource).optional(),
  ```
- Validation: if `intent` present, it must start with the clinician's `viewerDivision` prefix (`REHAB_*` / `BH_*` / `MEDICAL_*`). Mismatch → 400 `intent_division_mismatch`.
- Default: `UNSPECIFIED` + `CLINICIAN` when absent.
- Audit `ENCOUNTER_CREATED` metadata gains `intent` + `intentSource`.

### F. BriefGenerator — sibling, not modification (Decision 11)

**`src/services/brief/BriefGenerator.ts` is NOT modified.** A sibling generator dispatches.

New file `src/services/brief/IntentAwareBriefGenerator.ts`:

- Takes the same input shape as the existing `BriefGenerator` PLUS `intent: EncounterIntent` (required, non-null — caller pre-checks via `SUPPORTED_INTENT_PAIRS`)
- Internally composes around `BriefGenerator` for the unchanged parts (LLM call envelope, retry logic, Haiku fallback, stub-mode handling)
- Selects a spine module per `(division, intent)` and overrides the system prompt + output schema for that call
- Throws for unsupported `(division, intent)` pairs — the worker dispatcher is the gatekeeper

Four new spine modules in `src/lib/notes/brief-spines/` (PR3 ships only the first; PR4 ships the other three):

- `rehab-progress-spine.ts` *(PR3)* — prompt fragment + schema extension instructing the model to populate the **goal ledger** (all LTGs + STGs with status), medical-necessity talking points (1-2 sentences each), suggested data to capture today
- `rehab-reeval-spine.ts` *(PR4)* — objective-measure history (full episode, not just last 3), revision opportunities
- `bh-tpr-spine.ts` *(PR4)* — PHQ-9/GAD-7/C-SSRS trend, full goal ledger, plan revisions
- `medical-awv-spine.ts` *(PR4)* — care gaps, screenings due, immunizations due, prior AWV plan items

Each spine module exports a triple `{ systemPromptFragment, outputSchema, stubSynthesizer }` that `IntentAwareBriefGenerator` composes with the base prompt envelope. The existing `BriefLLMOutputSchema` is **untouched**; spine schemas extend it in their own module (see §I).

### G. Worker — top-of-handler dispatcher (existing path byte-for-byte unchanged)

`src/workers/note-brief/handler.ts` gets ONE addition: a top-of-handler branch that dispatches between the existing and intent-aware generators. The existing fall-through block below it is unchanged.

```ts
// Pseudocode for the addition at the top of handle():
const intent = note.encounter?.intent ?? 'UNSPECIFIED';
const pairKey = `${note.division}:${intent}`;
if (intent !== 'UNSPECIFIED' && SUPPORTED_INTENT_PAIRS.has(pairKey)) {
  await runIntentAwareBrief({ note, intent, ...sharedInputs });
  return;
}
// ↓ existing handler code, completely unchanged ↓
```

- Audit `BRIEF_GENERATED` metadata gains `intent` + `intentSource` — **emitted from both paths** (the existing generator stamps `UNSPECIFIED` + `CLINICIAN` from `note.encounter.intent` / `intentSource`, which is what those fields default to for pre-Unit-48 encounters anyway)
- The only schema-level change to the handler's query is an additive `select: { intent: true, intentSource: true }` on the encounter projection — additive, no behavior change
- `SUPPORTED_INTENT_PAIRS` is a const Set co-located with `IntentAwareBriefGenerator` — explicit, grep-discoverable, easy to extend in follow-on units

### H. Renderer — sibling card wrapper (existing `<BriefCard>` untouched)

**`<BriefCard>` is NOT modified** beyond one additive optional prop. A sibling component handles intent-aware rendering.

The **one** allowed modification to existing `<BriefCard>`: a new optional `spineSlot?: React.ReactNode` prop that renders above the goals snapshot when supplied. Defaults to `null` (zero behavior change when omitted). All other `<BriefCard>` code is unchanged. The snapshot regression test (§Verify) gates that no other behavior shifts.

New file `src/components/brief/intent-aware-brief-card.tsx`:

- Accepts the same props as `<BriefCard>` PLUS `intent: EncounterIntent` (required, non-null)
- Internally composes `<BriefCard>` with a `spineSlot` containing the appropriate spine components for the intent
- Owns the spine-selection logic; existing `<BriefCard>` knows nothing about intent

Page-level dispatch — the **only** render-path change in PR3:

```tsx
// /prepare/[noteId]/page.tsx — single ternary
{encounter.intent && encounter.intent !== 'UNSPECIFIED' && SUPPORTED_INTENT_PAIRS.has(`${note.division}:${encounter.intent}`)
  ? <IntentAwareBriefCard content={briefContent} intent={encounter.intent} ... />
  : <BriefCard content={briefContent} ... /> /* existing path, untouched */
}
```

**`/capture/[noteId]` (`PriorContextPanel`), telehealth room, and the sign-time sweep keep rendering the existing `<BriefCard>` in PR3** — intent-aware rendering on those surfaces is a follow-up so PR3's blast radius is bounded to `/prepare`.

New spine components in `src/components/brief/spines/`:

- `<GoalLedger>` *(PR3)* — full LTG + STG ledger; columns: goal text · type · status · delta · source pill. Reused in PR4 by `REHAB_REEVAL` + `BH_TREATMENT_PLAN_REVIEW`.
- `<MedicalNecessityScaffold>` *(PR3)* — three labeled fields: *"Remaining functional limitations"*, *"Why skilled care is still required"*, *"Justification for continued POC"*. Each populated verbatim from the spine's prompt output, each with a source pill. Used only by `REHAB_PROGRESS_NOTE`.
- `<RiskTrendSparkline>` *(PR4)* — PHQ-9 / GAD-7 / C-SSRS scores over time. (Pulls from `objectiveMeasures` where `measureKey` matches `phq9-total` / `gad7-total` / `c-ssrs-rating` per existing Phase-13b registry.)
- `<CareGapsList>` *(PR4)* — checkable list of overdue screenings + immunizations. (Pulls from `ehrEnrichment.recentObservations` for vitals + `priorNotes` for screening history.)

Each component renders nothing (no error) when its required data isn't present.

### I. Brief schema — sibling file (existing `src/types/brief.ts` minimally touched)

**`BriefLLMOutputSchema` is NOT modified.** `PriorContextBriefContentSchema` gains exactly one additive nullable+optional field (`intent`). Spine shapes live in a new file.

In `src/types/brief.ts` (the **only** addition):

```ts
// Single additive nullable+optional field on PriorContextBriefContentSchema:
intent: z.nativeEnum(EncounterIntent).nullable().optional(),
```

New file `src/types/brief-intent-shapes.ts`:

```ts
import { z } from 'zod';
import { BriefLLMOutputSchema, SourcePillSchema } from './brief';

export const RehabProgressBriefShapeSchema = BriefLLMOutputSchema.extend({
  goalLedger: z.array(z.object({
    goalText: z.string(),
    goalType: z.enum(['LTG', 'STG']),
    status: z.enum(['ACTIVE','MET','NOT_MET','MODIFIED','PARTIALLY_MET','DEFERRED']),
    delta: z.string().nullable(),
    sourceNoteId: z.string(),
  })),
  medicalNecessity: z.object({
    remainingLimitations: z.string(),
    whySkilledCare: z.string(),
    pocJustification: z.string(),
  }),
});

// PR4 — added when spines land:
// export const RehabReevalBriefShapeSchema = BriefLLMOutputSchema.extend({ ... });
// export const BhTprBriefShapeSchema = BriefLLMOutputSchema.extend({ ... });
// export const MedicalAwvBriefShapeSchema = BriefLLMOutputSchema.extend({ ... });
```

Pre-Unit-48 briefs validate against unchanged `BriefLLMOutputSchema`. Intent-aware briefs validate against the spine-specific shape (which already extends the base schema, so base validation is implicit). The `IntentAwareBriefGenerator` chooses which schema to validate against from the `(division, intent)` pair; the existing `BriefGenerator` never imports or references the new schemas.

### J. Empty / edge states

- **Pre-Unit-48 briefs:** `intent` is null; renderer falls through to generic flow. No-op.
- **`intent === REHAB_PROGRESS_NOTE` but the LLM failed to populate `goalLedger`:** show the rest of the card + a banner *"Goal ledger unavailable — open last note for goal context."*
- **`intent === BH_CRISIS_REASSESSMENT`** (not in MVP four): falls through to generic spine + an `<AlertBanner>` *"Risk re-assessment — full risk history below in 'Watch' section."* (Hints at the eventual richer spine.)
- **Intent override after encounter create:** out of scope for v1 (`Encounter.intent` is set once at create); future unit handles mid-visit intent change.

### K. Sprint 0.18 PrepareNudgeBlock interaction

Existing `<PrepareNudgeBlock>` (Sprint 0.18) renders proactive Cleo nudges on `/prepare` keyed by `surface = 'VISIT_PREPARE'`. This unit adds **one new nudge variant**: when `Encounter.intent === UNSPECIFIED` AND the deterministic proposer would have proposed `REHAB_PROGRESS_NOTE` (i.e., the clinician dismissed the chip without picking), the prepare nudge fires *"Heads up — based on visit count this should be a Progress Note. Generate accordingly?"* with a single action that updates `intent` and re-triggers the brief generator. This is the **safety net** for the "Cleo proposed, clinician auto-posted without confirming" case.

## Dependencies

- Unit 02 (Encounter schema) — established
- Unit 06 (brief generation + render chain) — established
- Unit 07 (CopilotShell + Watch v0 cards) — established
- Unit 22 / F4 (`externalEhrContext` in brief input) — established; `<CareGapsList>` pulls from it
- Sprint 0.18 (`loadEligibleNudgesForSurface`) — established; new nudge variant adds to the existing pattern

No new packages.

## Verify when done

- [ ] Schema: `EncounterIntent` + `IntentSource` enums append-only; `Encounter.intent` + `intentSource` populated for new encounters; migration applies cleanly to a seeded DB.
- [ ] `IntentProposer` unit tests cover REHAB cadence math (10-visit + 30-day), BH TPR 90-day, MEDICAL AWV 11-month, TCM 14-day, and the "zero prior notes → initial" branch per division.
- [ ] `GET /api/patients/[id]/proposed-intent` returns within 100ms p95 (cache hot); falls back to `UNSPECIFIED` on any error.
- [ ] `<IntentChip>` renders in both `AutoPostShell` and `PickerShell`; tap opens division-filtered `<Select>`; auto-post defers when `confidence === 'low'`.
- [ ] `POST /api/encounters` accepts + persists `intent` + `intentSource`; rejects cross-division `intent` with 400; audits `ENCOUNTER_CREATED` with intent metadata.
- [ ] `BriefGenerator` branches per `(division, intent)` for the four MVP pairs; falls through to today's prompt for all others; spine modules tested with fixtures.
- [ ] `note-brief` worker passes `intent` to the generator; writes `intent` on `NoteBrief.content`; audit `BRIEF_GENERATED` metadata records `intent` + `intentSource`.
- [ ] `<BriefCard>` renders intent-aware spines: `<GoalLedger>` for PROGRESS / REEVAL / BH-TPR; `<MedicalNecessityScaffold>` for PROGRESS only; `<RiskTrendSparkline>` for BH-TPR only; `<CareGapsList>` for AWV only.
- [ ] Spine sections degrade gracefully when their data is missing — banner, not crash.
- [ ] Pre-Unit-48 briefs (intent=null) render unchanged with no regression in `/prepare`, `/capture`, sign-time sweep, or telehealth room.
- [ ] Sprint 0.18 nudge variant fires when `Encounter.intent === UNSPECIFIED` AND proposer would have proposed `REHAB_PROGRESS_NOTE`; tapping the nudge updates `intent` and re-runs brief generation.
- [ ] 3-tap test: chart hero → start visit dialog → confirm chip → /prepare = 3 taps. Override path: chart hero → start visit dialog → tap chip → pick override → /prepare = 4 taps. Both pass.
- [ ] Rule 20 verified: spine modules read only `Note.status ∈ {SIGNED, TRANSFERRED}` (grep on the worker + projector).
- [ ] Rule 23 verified: no spine produces a clinical recommendation in card form; `<MedicalNecessityScaffold>` produces *talking points the clinician says*, never *conclusions Cleo asserts*.
- [ ] Stub-mode parity: stub bedrock returns a minimal intent-aware brief for each of the four MVP pairs so dev can exercise the renderer end-to-end without Bedrock.
- [ ] **Snapshot regression test** (`test/snapshots/brief-shape-regression.test.ts`) — captures 8–10 representative existing `NoteBrief.content` fixtures from the dev seed; runs them through the new worker dispatcher with `intent = null` AND `intent = UNSPECIFIED`; asserts **byte-for-byte identical** output to the existing path (i.e., the dispatcher always falls through to the unchanged `BriefGenerator`). Same fixtures run through the existing `<BriefCard>` (with no `spineSlot` prop supplied) must produce identical rendered DOM. This is the merge gate for PR3 (Decision 11).
- [ ] **Three-lens evaluation:**
  - **Clinician** — A practicing PT taps a patient, sees *"Progress Note — change ▾"*, walks to the room with the goal ledger and medical-necessity scaffold in hand. Less time chart-scouring; more time with patient.
  - **Compliance Officer** — Every Progress Note brief surfaces the medical-necessity scaffold *(Remaining limitations · Why skilled care · POC justification)*. Even when the clinician doesn't use it, the audit log records `intent === REHAB_PROGRESS_NOTE` so MAC reviewers can confirm the brief surface was correct.
  - **Auditor** — `Encounter.intent` + `intentSource` + audit metadata reconstruct the entire decision chain: Cleo proposed X, clinician confirmed/overrode to Y, brief was generated with intent Y, note generator template defaulted from Y (when the future unit lands).
- [ ] `progress-tracker.md` updated with this unit's status + a session note for the next agent.

## Out of scope (call out so future agents don't expand)

- New schema fields for goal ledger / medical necessity / care gaps in the **other** 13 `(division, intent)` pairs — spec when those pairs are prioritized
- Note generator template defaulting by intent — separate unit
- Compliance flags by intent — separate unit (e.g., a Progress Note without all-goal-coverage should be a P0 flag)
- Sign-time sweep widening to gate on goal-status updates for Progress Notes — separate unit
- Mid-visit intent change (edit on /review) — separate unit
- Intent-aware post-sign artifacts (DISCHARGE_* → AVS-with-HEP) — separate unit
- Migration/backfill of intent on existing signed-but-not-yet-briefed encounters — explicit no-backfill; all pre-Unit-48 rows = UNSPECIFIED + CLINICIAN

## Anti-patterns to avoid

- Do **not** enforce intent at the API layer beyond division match — Cleo proposes, clinician decides
- Do **not** silently drop the chip when proposer is slow — show `UNSPECIFIED` and open the picker
- Do **not** change `Schedule.visitType` semantics — intent is encounter-scoped, modality stays schedule-scoped
- Do **not** add spine modules for intents beyond the MVP four in this unit — out of scope is real
- Do **not** generate the brief synchronously at start-visit time — generation stays post-sign; this unit reads intent from the encounter and uses it to shape what the next-visit brief surfaces
- Do **not** mark `intent` non-nullable on `PriorContextBriefContent.intent` — back-compat with pre-Unit-48 briefs requires nullable
- Do **not** branch the BriefCard render tree more than one level deep on intent — spine selection happens once, sections compose linearly

## Open questions (deferred — not blocking implementation)

- **Should the chip allow "I'll decide on the fly" mode?** — Saving `UNSPECIFIED` is already that. Default: no explicit "decide later" option in v1; the chip's existing chosen-value state is sufficient.
- **Should override carry forward to other encounters in the same episode?** — Probably not (each visit's intent is independent); deferred to clinician feedback.
- **Should the brief surface intent at the top so /review can show "this was generated as a Progress Note brief"?** — Yes for transparency; render as a small chip in `<BriefHeader>` when `content.intent !== null`. Included in this unit's renderer work.
- **Should `IntentProposer.proposeIntent` return a list of *alternative* intents the clinician might prefer?** — Probably v2; v1 returns one intent + reason. The dropdown gives override; explicit alternates are noise unless the proposer is uncertain.

## Phasing (if the unit ships in slices)

If sequenced into smaller PRs (recommended):

1. **PR 1** — schema + IntentProposer service + /proposed-intent endpoint + unit tests. No UI; no behavior change.
2. **PR 2** — StartVisitDialog chip + POST /api/encounters intent capture + audit. Intent is recorded but doesn't drive brief shape yet.
3. **PR 3** *(~2–3% regression risk per Decision 11)* — sibling files only:
   - New: `src/services/brief/IntentAwareBriefGenerator.ts`, `src/lib/notes/brief-spines/rehab-progress-spine.ts`, `src/types/brief-intent-shapes.ts`, `src/components/brief/intent-aware-brief-card.tsx`, `src/components/brief/spines/goal-ledger.tsx`, `src/components/brief/spines/medical-necessity-scaffold.tsx`
   - Touched (one-line additions only): `src/workers/note-brief/handler.ts` (top-of-handler dispatcher), `src/app/(clinical)/prepare/[noteId]/page.tsx` (ternary), `src/types/brief.ts` (one optional nullable `intent` field), `src/components/brief/brief-card.tsx` (one optional `spineSlot` prop)
   - New tests: `test/services/brief/intent-aware-brief-generator.test.ts`, `test/components/brief/intent-aware-brief-card.test.tsx`, `test/snapshots/brief-shape-regression.test.ts` (the merge gate)
   - Single MVP pair (`REHAB_PROGRESS_NOTE`) end-to-end on `/prepare` only
   - Existing `BriefGenerator`, `<BriefCard>` (other than `spineSlot` prop), `BriefLLMOutputSchema`, capture/telehealth/sign-time-sweep surfaces all untouched
4. **PR 4** — Remaining three MVP pairs (`REHAB_REEVAL`, `BH_TPR`, `MEDICAL_AWV`) — same sibling-files approach; adds three spine modules + their schemas + `<RiskTrendSparkline>` + `<CareGapsList>`. Snapshot regression test continues to gate.
5. **PR 5** — Sprint 0.18 nudge variant for the auto-post safety net.

**Cleanup unit (~48.5)** — after PR4 ships and intent-aware briefs validate in prod for 2–3 weeks, fold the sibling files back into the main path (`IntentAwareBriefGenerator` merges into `BriefGenerator`; `<IntentAwareBriefCard>` collapses into `<BriefCard>`; `brief-intent-shapes.ts` merges into `brief.ts`). At that point the modification risk is "modifying validated behavior" not "modifying unvalidated behavior" — fundamentally different risk profile.

Each PR independently shippable; Three-lens evaluation per PR.
