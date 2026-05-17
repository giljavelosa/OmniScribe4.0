# OmniScribe — Prior-Context Brief & Follow-Ups

**Status:** Draft for implementation
**Owner:** Gil
**Last updated:** 2026-05-04
**Implementation pattern:** Master spec; derive numbered `cursor-tasks/` files per phase
**Anchored anti-regression rules:** 1, 2, 3, 6, 7, 8, 10, 16

---

## 1. Goal

Replace the current "Last Visit Summary" — three orphaned first-sentences of subjective / assessment / plan glued together by `buildSummary()` — with a **structured pre-visit brief** that gives the clinician a 30-second clinical picture they can trust, plus a **follow-up commitment system** that holds promises across visits and surfaces them at the next encounter.

The brief is **precomputed at note signing** and stored as structured JSON, so the next visit's prepare/capture screens render instantly without per-render LLM cost.

## 2. Why now

The existing `buildSummary()` in `src/app/api/patients/[id]/note-context/route.ts` ships a regex extract that gives the clinician no narrative arc, no trajectory, no objective trail, and no record of what the prior clinician promised. It also returns a `brief` object that the UI never renders — half-built scaffolding already exists. Closing this gap is the highest-leverage clinical UX win on the roadmap because it eliminates ~15 minutes of EHR (NextGen) chart-scouring per returning patient — the explicit pain point the founder named.

Strategically, this work is the first concrete step toward OmniScribe operating as a **clinical copilot** rather than a passive note generator: the brief is the system's "I read the chart for you" artifact, and follow-ups are the system's "I remember what you promised" artifact. Both are foundational for any later visit-time medical-assistant features.

## 3. Non-goals (v1)

- FHIR / external EHR ingestion (parked dependency — back-office paste-in remains the data source for now)
- After-visit summary (AVS) surfacing of patient-facing follow-ups (data model supports it; UI is a separate workstream)
- Real-time keyword-triggered surfacing during capture (separate future feature)
- Multi-language brief generation
- Comparative trajectory across more than the 3 most recent prior visits

## 4. The 30-second card (experience target)

Top-to-bottom render order on the prepare and capture screens:

```
Maria González · 68F · Episode: R shoulder, week 4 of 6
Last seen 6 days ago by Dr. Smith — Progress Note

WHY SHE'S HERE
R shoulder pain post fall on outstretched hand (Mar 2),
addressing ROM + scap stability.

LAST CLINICAL IMPRESSION
Improving — pain trending down, AROM gains in flex/abd,
scap dyskinesis still type II.

TRAJECTORY                                          ↑
Pain VAS    7   →   5   →   4
Flex AROM   95° →  110° →  125°
MMT ER      3+/5 (unchanged ×2 visits)

LAST VISIT DID
• Manual GH joint mob grade III
• Scap stability progression (band rows 3×10, prone Y/T/W)
• HEP updated · Sleep posture education

PLAN SAID FOR TODAY
• Progress band rows to red
• Recheck scap dyskinesis
• Address sleep complaint if still present

OPEN FOLLOW-UPS FROM LAST VISIT (2)
□ Trial NSAID — ask if started
□ Imaging report (Mar 28) — confirm reviewed

ACTIVE GOALS (3 of 5)
↑ AROM flex to 150°    carried · on track
↓ Pain to ≤ 2/10       active
✓ Independent HEP      met

WATCH
• New gabapentin 300mg started Apr 22 (drowsiness check)
• HTN flagged uncontrolled last visit — re-check BP
```

Every line is one tap to its source note. Trust comes from provenance, not from fluency.

## 5. Schema — the brief

### 5.1 TypeScript interface

```ts
// src/lib/types/prior-context-brief.ts

export interface PriorContextBrief {
  // Identity & framing
  patientOneLine: string | null;          // "68F, R shoulder post-fall, week 4 of 6"
  episodeContext: {
    episodeId: string;
    label: string;                        // "R shoulder pain"
    visitNumber: number | null;           // 4
    plannedVisits: number | null;         // 6
  } | null;
  lastVisit: {
    noteId: string;
    date: string;                         // ISO
    daysAgo: number;
    clinicianName: string;
    noteType: string | null;
    templateName: string | null;
  };

  // Clinical narrative
  chiefConcern: string | null;
  priorAssessment: string | null;
  trajectory: {
    summary: string | null;               // "Improving: pain ↓, ROM ↑"
    direction: "improving" | "plateau" | "regressing" | "mixed" | null;
  } | null;

  // Objective trail
  objectiveMeasures: ObjectiveMeasure[];

  // Last visit interventions
  interventionsPerformed: string[];
  homeProgram: string | null;
  educationGiven: string[];

  // What was promised for today
  carryForwardPlan: string[];             // verbatim plan items

  // Goals snapshot (max 3 surfaced; full list still in existing goals timeline)
  topActiveGoals: GoalSnippet[];

  // Watch list
  watch: {
    recentMedChanges: string[];
    recentResults: string[];
    precautions: string[];
    redFlagsFromPriorNote: string[];
  };

  // Provenance
  generatedAt: string;                    // ISO
  generatorVersion: string;               // "regex-v1" | "llm-v1" | ...
  sourceNoteIds: string[];                // notes the brief draws from
}

export interface ObjectiveMeasure {
  measure: string;                        // "Pain VAS"
  unit: string | null;                    // "/10"
  lastValue: string;                      // "4"
  priorValues: string[];                  // ["7", "5"] (most recent first)
  trend: "improving" | "stable" | "worsening" | "unknown";
  sourceNoteId: string;
  measureKey?: string | null;             // Phase 13b — registry key from `snapshots/registry.ts`; null when unmapped; omitted on pre-13b briefs
}

export interface GoalSnippet {
  text: string;
  status: "active" | "met" | "carried";
  delta: string | null;                   // "on track" | "stalled" | null
  originNoteId: string;
}
```

### 5.2 API contract change

`GET /api/patients/[id]/note-context` gains:

```ts
{
  ...existingFields,                      // unchanged — anti-regression
  brief: PriorContextBrief | null,        // null when no prior signed notes
  briefVersion: string,
  legacyVisitBrief: LegacyVisitBrief | null, // pre-Phase-20 scaffold renamed for back-compat
}
```

The existing `summary`, `goals`, `previousNotes`, `priorSignedCollapsedPreview` fields **remain unchanged** to preserve back-compat with current UI consumers.

**`legacyVisitBrief` rename (Phase 20 implementation note):** the pre-Phase-20 API was already shipping a `brief` object with shape `{ lastVisitDate, lastVisitClinician, mainConcern, priorAssessment, carryForwardFocus }` that the prepare screen consumed. To free the `brief` key for `PriorContextBrief` without breaking prepare, that older scaffold is renamed to `legacyVisitBrief` on the wire. Prepare reads `legacyVisitBrief` for the existing summary card; the new `BriefCard` reads `brief`. The old field is deprecated and will be removed after Phase 25 ships and is verified in production.

### 5.3 Storage

Briefs are stored in a new `NoteBrief` table (1:1 with signed notes):

```prisma
model NoteBrief {
  id               String   @id @default(cuid())
  noteId           String   @unique
  note             Note     @relation(fields: [noteId], references: [id], onDelete: Cascade)
  brief            Json     // PriorContextBrief
  generatorVersion String
  generatedAt      DateTime @default(now())
  patientId        String
  episodeId        String?
  @@index([patientId])
  @@index([episodeId])
}
```

Rationale for separate table (vs JSON column on `Note`):

- `Note.finalJson` is immutable per anti-regression rule 3; the brief must remain regenerable when prompts improve
- Allows targeted regeneration without touching the signed note record
- Indexed lookups by `patientId` / `episodeId` for episode-scoped queries

## 6. Schema — follow-ups

### 6.1 Lifecycle

```
        ┌─────────┐
        │  OPEN   │  ← created at sign-time of origin note
        └────┬────┘
             │
   ┌─────────┼──────────┬─────────────┐
   ▼         ▼          ▼             ▼
 MET    CARRIED      DROPPED   CLOSED_BY_DISCHARGE
(closed) (rolls    (closed     (closed automatically
         forward)  with reason) when episode ends)
```

Status vocabulary mirrors the existing goals model (`active / met / carried`) — same grammar, reusable UI components, consistent clinician mental model.

### 6.2 Prisma model

```prisma
model FollowUp {
  id                 String           @id @default(cuid())
  patientId          String
  patient            Patient          @relation(fields: [patientId], references: [id])
  episodeId          String?
  episode            EpisodeOfCare?   @relation(fields: [episodeId], references: [id])
  originNoteId       String
  originNote         Note             @relation("FollowUpOrigin", fields: [originNoteId], references: [id])
  closingNoteId      String?
  closingNote        Note?            @relation("FollowUpClosing", fields: [closingNoteId], references: [id])
  text               String           @db.Text
  patientFacingText  String?          @db.Text   // reserved for future AVS surfacing
  status             FollowUpStatus   @default(OPEN)
  closingNoteText    String?          @db.Text   // 1–2 line note when MET
  dropReason         String?          @db.Text   // required when DROPPED
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt
  closedAt           DateTime?
  @@index([patientId, status])
  @@index([episodeId])
}

enum FollowUpStatus {
  OPEN
  MET
  CARRIED
  DROPPED
  CLOSED_BY_DISCHARGE
}
```

### 6.3 Lifecycle invariants

- A follow-up moves from `OPEN` only via explicit clinician action **or** episode discharge
- `MET` requires non-empty `closingNoteText` and `closingNoteId`
- `DROPPED` requires non-empty `dropReason`
- `CARRIED` re-surfaces automatically on the next visit's prepare screen until acted on
- `CLOSED_BY_DISCHARGE` is set in a transaction that runs at episode-discharge time
- Status changes are append-only in the audit log (`FOLLOWUP_STATUS_CHANGED`)

## 7. Generation flow (precompute on sign)

When a note transitions to `SIGNED`:

1. The sign endpoint enqueues a `note-brief` BullMQ job (3 retries, exponential backoff per anti-regression rule 10)
2. The worker runs `buildBrief(noteId)`:
   - Phase 1–3 implementation: regex extractor (current logic, extracted into `src/lib/notes/build-brief.ts`)
   - Phase 4 implementation: Bedrock Sonnet 4.5 via `src/services/llm/brief-generator.ts` (rule 6 — all AI through `src/services/llm/`)
3. The worker writes the result to `NoteBrief` (upsert)
4. The worker emits `BRIEF_GENERATED` audit log entry
5. In Phase 5, the same worker invokes `proposeFollowUps()` → returns proposals → surfaced to clinician at sign-time review for confirmation before persistence

The worker MUST be registered in `src/workers/index.ts` and run inside the existing `npm run dev:workers` process (anti-regression rule 16).

## 8. UI touchpoints

Three surfaces, one underlying record per item:

### 8.1 Prepare screen (`src/app/(clinical)/prepare/[noteId]/page.tsx`)

- Renders the structured brief card (section 4 layout)
- "Open follow-ups from last visit" surfaces as a checklist preview
- Tap a follow-up → opens detail with Met / Drop / Carry actions

### 8.2 Capture screen (`src/app/(clinical)/capture/[noteId]/_components/PriorContextPanel.tsx`)

- Same structured brief card, accessible inside the prior context panel (already exists)
- Open follow-ups appear inline with quick-action chips: **Met** / **Drop** / **Carry**
- `Met` → small inline text input for closing note (required, 1–2 lines)
- `Drop` → small inline text input for drop reason (required)
- `Carry` → no input; rolls to next visit

### 8.3 Sign-time sweep (new component, sibling to existing review shell — must NOT modify the review shell per founder rule)

- Before final sign, if any follow-ups remain `OPEN`, modal shows: *"X follow-ups still open — resolve, drop, or carry?"*
- Each item: same Met / Drop / Carry chips
- Batch options: Carry all, Drop all (with single shared reason)
- Default if dismissed: items auto-`CARRIED`; dismissal logged in audit

## 9. HIPAA / compliance

- Brief content is PHI; the existing `canAccessPatientHistoricalNote` access checks apply unchanged
- Brief generation logs Bedrock request ID + prompt template version, **never raw PHI**
- All AI calls go through `src/services/llm/` per anti-regression rule 6 — no direct Bedrock SDK calls in app code
- `NoteBrief` and `FollowUp` records cascade-delete with their parent (note soft-delete propagates; anti-regression rule 7 means the audio file is preserved even when records soft-delete)
- 42 CFR Part 2 sensitivity: brief inherits the most restrictive `sensitivityLevel` of its source notes; reader access enforced via `canAccessNoteSensitivity`
- Production deploys must verify `SONIOX_BAA_ON_FILE=true` and current Bedrock BAA before ship (anti-regression rule 17)

## 10. Phasing roadmap

Six phases, each independently shippable, each gated by acceptance criteria. Each phase becomes its own `cursor-tasks/<NN>-prior-context-<sub>.md` file when ready to execute.

| Phase | Title | Risk | Notes |
|---|---|---|---|
| 1 | Brief schema + API wiring | Low | Pure additive; types + API extension |
| 2 | UI: render the structured brief | Low | Replaces summary block in PriorContextPanel |
| 3 | Precompute on sign (regex baseline) | Medium | New BullMQ worker; new Prisma model |
| 4 | LLM-enhanced brief generation | Medium | Replaces regex with Bedrock Sonnet 4.5 |
| 5 | Follow-ups data model + creation flow | Medium | New Prisma model + sign-time review step |
| 6 | Follow-ups display + closing UX | Low | Inline chips + sign-time sweep modal |

### 10.1 Phase boundaries (the gates)

- **Phase 1** ships when `briefVersion: "regex-v1"` appears on every API response and the existing `PriorContextPanel` collapsed preview is unchanged
- **Phase 2** ships when the structured 30-second card renders on prepare + capture, with all source-note tap-throughs working, and the 3-tap test still passes
- **Phase 3** ships when 95% of newly-signed notes have a stored `NoteBrief` within 30 seconds of sign, and API reads precomputed brief in < 50 ms when present
- **Phase 4** ships when `briefVersion: "llm-v1"` populates `patientOneLine`, `trajectory.direction`, and ≥ 1 `objectiveMeasures` entry on test fixtures, with cost ≤ $0.05 per generation
- **Phase 5** ships when LLM-proposed follow-ups appear in the sign-time review step and clinician-confirmed items persist with `status: OPEN`
- **Phase 6** ships when carried follow-ups auto-surface on the next visit's prepare screen, inline tap-to-close persists status changes within 1 s, and sign-time sweep cannot be silently bypassed

### 10.2 Dependency on existing roadmap

This work touches files affected by `cursor-tasks/02-capture-refactor.md` and `cursor-tasks/03-setup-to-prepare.md`. Phase 1–2 of this spec **must run after** those have shipped to avoid merge conflicts in `PriorContextPanel.tsx` and the prepare page. Phase 3+ has no dependency on the existing roadmap.

## 11. Migration / back-compat

- Phase 1–2 ship without DB changes — pure additive API + UI work
- Phase 3 introduces `NoteBrief`; existing signed notes get briefs lazily on next read or via a one-time backfill (out of scope for v1; can be a separate cursor-task)
- The legacy `summary` field on the API response is **kept** until Phase 6 ships and is verified in production. After verification, a cleanup task can deprecate it.
- Existing `goals` timeline computation in `note-context/route.ts` is preserved in Phase 1; Phase 4 may consume the same goal extractor through the LLM path

## 12. Open questions (deferred — not blocking implementation)

- **Brief regeneration UI:** do we expose a "regenerate brief" button to clinicians (for cases where Phase 4's prompt improves and existing briefs become stale)? Default: no, regenerate is admin-only triggered via a one-time backfill job.
- **`patientFacingText` generation:** auto-generated by LLM in Phase 5, or deferred to AVS workstream? Default: deferred — store null in v1; AVS work backfills.
- **Cross-clinician brief sharing:** if Clinician A wrote the prior note and Clinician B is seeing the patient today, do we always show A's full brief? Default: yes, subject to existing access checks (`canAccessPatientHistoricalNote`).
- **Episode-level vs patient-level brief:** today the brief is scoped per patient; should it be per-episode by default? Default: brief is scoped to **the most recent prior signed note in the same episode** when an `episodeId` is provided, otherwise patient-wide. This matches the existing `episodeId` query param on `note-context`.

## 13. Anti-patterns to avoid

- Do **not** modify `PriorContextPanel`'s collapsed preview or the existing `goals` rendering during Phase 1–2 (anti-regression: existing UI must keep working)
- Do **not** call Bedrock SDK directly anywhere outside `src/services/llm/` (rule 6)
- Do **not** mutate `Note.finalJson` to attach the brief (rule 3 — finalJson is immutable; that's why we have a sibling table)
- Do **not** stand up a second BullMQ fleet against the same Redis to process briefs in parallel during migration (rule 18)
- Do **not** modify the existing review shell components to add the sign-time sweep — build a new sibling component (founder rule)
- Do **not** silently drop a follow-up from the UI — every status change must be explicit and logged
- Do **not** truncate brief content with a fixed word limit; the LLM prompt governs length, and the UI clamps display only

## 14. Success metrics (Track phase, per AGENT framework)

These are capability-expansion metrics, not task-tally metrics:

- **Median chart-review time per returning visit** before/after (target: ≥ 50% reduction from the founder's stated ~15 min baseline)
- **% of returning visits where the clinician opens the prior note manually** before/after (target: ≥ 60% reduction — proxy for trust in the brief)
- **Face-time minutes per visit** before/after (qualitative, sampled)
- **Follow-up close rate** (% of follow-ups created that move out of `OPEN` within 2 visits)
- **Clinician confidence rating** (in-app micro-survey on brief usefulness, ≥ 4 / 5 target)

Reject these as success metrics: number of briefs generated, brief generation latency alone, follow-ups created per visit. Those are activity metrics, not capability metrics.
