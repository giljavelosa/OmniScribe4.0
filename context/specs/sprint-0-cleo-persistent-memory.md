# Sprint 0.14: Miss Cleo's persistent memory + "Cleo's read" chart card

> Miss Cleo gets **per-(patient × clinician) memory** that survives across
> sessions: her Ask chat threads persist, and a per-patient `state`
> projection caches what she's learned (cases analyzed, patterns observed,
> conversation facts cited). A small **"Cleo's read"** card on the chart
> Overview tab makes the memory visible — and the case-router from Sprint
> 0.13 immediately gets richer per-visit context.

## Context — read first

- `CLAUDE.md` — agent rules. Especially:
  - **Rule 8** — audit-log writes never wrapped in swallowing try-catch.
  - **Rule 10** — BullMQ jobs MUST have retry logic — 3 retries,
    exponential backoff.
  - **Rule 20** — copilot reads only SIGNED/TRANSFERRED notes,
    clinician-confirmed FollowUp rows, and verified FHIR resources. The
    state projection is built **from** these sources; it is not itself a
    source of truth.
  - **Rule 24** — data only, no clinical recommendations. The state stores
    what happened (citations); never what Cleo thinks should happen.
- `context/specs/42-copilot-persona-miss-cleo.md` — the persona module
  (Unit 42). The persona spec explicitly defers DB conversation
  persistence to *"Unit 47"* — this sprint is that work. Reuses
  `buildPersonaSystemBlock`, `PERSONA_ANTI_DRIFT_BLOCK`, and
  `PERSONA_VERSION` from `src/services/copilot/persona.ts`.
- `context/specs/sprint-0-cleo-persona-pass.md` — Sprint 0.12. Ships first;
  this sprint extends the same persona footprint into stored conversation
  + projection state.
- `context/specs/sprint-0-case-router-agent.md` — Sprint 0.13. The
  case-router agent reads `CopilotPatientState` when present — additive,
  not required. When 0.14 lands, 0.13's routing proposals get cross-visit
  context immediately.

## Files this sprint touches

Schema + migration:
- `prisma/schema.prisma` — three new models + one new enum (all additive).
- A new Prisma migration directory.

Server (state builder + worker + conversation):
- New: `src/services/copilot/state-builder.ts` — rebuilds
  `CopilotPatientState` from primary sources for a given
  (patient × clinician).
- New: `src/workers/cleo-state/handler.ts` — refreshes state on
  signed-note + case-router-accepted events.
- New: `src/lib/queue/cleo-state.ts` — `enqueueCleoStateRefresh({ orgId,
  patientId, clinicianOrgUserId })`.
- Modified: `src/workers/ai-generation/handler.ts` — chain-enqueues
  `cleo-state` refresh on note completion (alongside existing chains).
- Modified: `src/app/api/notes/[id]/sign/route.ts` — chain-enqueues on
  sign as well.
- Modified: `src/app/api/notes/[id]/case-router/accept/route.ts` —
  chain-enqueues on case-routing acceptance (post-Sprint-0.13).

Ask conversation persistence:
- Modified: `src/app/api/copilot/ask/route.ts` — reads existing
  `CopilotConversation` for the (patient, clinician, mode) tuple; appends
  user + assistant messages; returns updated conversation.
- Modified: `src/components/copilot/ask-surface.tsx` — loads prior
  messages on mount; renders the durable thread.
- Modified: `src/components/copilot/research-surface.tsx` — same pattern
  for Research mode (no patientId).

State consumption (the agent gets richer inputs):
- Modified: `src/services/copilot/case-router.ts` (Sprint 0.13) — reads
  `CopilotPatientState` if present; appends a structured "Prior
  cross-visit context" block to the agent's system prompt. Backward-
  compatible: state-absent = behaves exactly as Sprint 0.13.

UI (chart card):
- New:
  `src/app/(clinical)/patients/[id]/_components/cleo-read-card.tsx`.
- Modified:
  `src/app/(clinical)/patients/[id]/_components/patient-chart-tabs.tsx` —
  mounts the card on the Overview tab, above the existing cockpit tiles.
- Modified: `src/app/(clinical)/patients/[id]/page.tsx` — fetches the
  state row server-side and passes it to PatientChartTabs.

Audit:
- `src/lib/audit/actions.ts` — append three new actions
  (`CLEO_STATE_REBUILT`, `CLEO_CONVERSATION_OPENED`,
  `CLEO_CONVERSATION_PURGED`).

## Goal

A clinician opens a patient chart and immediately sees a small
**"Cleo's read"** card on the Overview tab — Cleo's current understanding
of this patient, cited from real sources. Tapping it opens the Ask sheet
**with prior conversation context already loaded** (across browser
sessions). The Sprint 0.13 case-router agent silently gains cross-visit
perspective whenever the state is fresh.

> **Ships when**: (1) Ask conversations persist per (patient × clinician)
> across browser refreshes and re-logins; (2) the "Cleo's read" card
> renders on every patient chart and reads from `CopilotPatientState`;
> (3) the state row refreshes automatically on signed-note + case-router
> events; (4) the case-router agent's system prompt includes the state's
> cross-visit context when present.

## Locked decisions

| # | Decision | Value |
|---|----------|-------|
| 1 | Memory scoping | Per `(orgId, patientId, clinicianOrgUserId)`. Clinicians do NOT share memory — each builds their own thread on each patient. Org-wide sharing would dilute trust calibration and confuse "who said what." |
| 2 | Source of truth | The state is a **projection / cache**. Source-of-truth remains signed notes + CaseManagement + FollowUp + CaseRouterRun + FHIR. The state rebuilds deterministically from these on demand and on event. |
| 3 | Conversation persistence | One persistent `CopilotConversation` per `(orgId, patientId, clinicianOrgUserId, mode)`. The chat survives browser refresh, re-login, and session expiry. Manual "Reset conversation" affordance lives in the Sheet header. |
| 4 | PHI policy | Conversation message content carries PHI by nature; stored in `text` columns under the org's standard at-rest encryption (no separate column encryption). Audit metadata stays PHI-free per rule 8. |
| 5 | Refresh trigger | Event-driven — on `NOTE_SIGNED`, `CASE_ROUTER_ACCEPTED`, and (Sprint 0.16+) FHIR Condition status changes. No background polling sweep in Phase 1; the projection becomes stale only when source events are missed (best-effort retry already in place via rule 10). |
| 6 | Card placement | "Cleo's read" card lives at the TOP of the Overview tab, ABOVE the existing cockpit tiles. It is the 30-second answer — same anchor priority as the safety band. |
| 7 | Fresh-clinician state | When no `CopilotPatientState` row exists for `(patient × clinician)`, the card renders a stub ("✨ I'm just learning this patient — open the Ask sheet to get started.") and the state is built lazily on first interaction. |
| 8 | Generator versioning | `CopilotPatientState.generatorVersion` records the projection schema version so future shape changes can re-trigger rebuilds. Bump on every change to `state-builder.ts` output shape. |
| 9 | Conversation reset | A "Reset this conversation" action in the Sheet menu purges the `CopilotConversation` row + its `CopilotMessage` rows. Audit logs `CLEO_CONVERSATION_PURGED` (no PHI). Memory state is NOT purged — only the chat thread. |
| 10 | Scope (out) | No cross-clinician memory sharing. No raw conversation export. No proactive nudges (Sprint 0.18). No write-back to FHIR (Sprint 0.17). |

## Design

### Phase A — schema

```prisma
model CopilotPatientState {
  id                   String   @id @default(cuid())
  orgId                String
  patientId            String
  clinicianOrgUserId   String

  // Structured projections — JSON shapes are documented in state-builder.ts
  // and Zod-validated on write.
  caseAwarenessJson    Json     // { cases: [{id, primaryIcd, lastViewerActivityAt,
                                  //   routingConfidenceHistory, fhirMirror?}] }
  observedPatternsJson Json     // { patterns: [{kind, observedInNoteIds, count,
                                  //   firstSeen, lastSeen}] }
  conversationFactsJson Json    // { facts: [{summary, sourceNoteId?, sourceFollowUpId?,
                                  //   sourceConditionId?, citedAt}] }

  lastRebuiltAt        DateTime @default(now()) @updatedAt
  generatorVersion     String   // bump when state-builder.ts output shape changes

  organization         Organization @relation(fields: [orgId], references: [id])
  patient              Patient      @relation(fields: [patientId], references: [id])
  clinicianOrgUser     OrgUser      @relation(fields: [clinicianOrgUserId], references: [id])

  @@unique([orgId, patientId, clinicianOrgUserId])
  @@index([orgId, patientId])
  @@index([clinicianOrgUserId, lastRebuiltAt])
}

model CopilotConversation {
  id                 String              @id @default(cuid())
  orgId              String
  patientId          String?             // null for RESEARCH-mode conversations
  clinicianOrgUserId String
  mode               CopilotConversationMode

  startedAt          DateTime            @default(now())
  lastActivityAt     DateTime            @default(now()) @updatedAt
  personaVersion     String              // for audit cohort filtering

  messages           CopilotMessage[]

  organization       Organization @relation(fields: [orgId], references: [id])
  patient            Patient?     @relation(fields: [patientId], references: [id])
  clinicianOrgUser   OrgUser      @relation(fields: [clinicianOrgUserId], references: [id])

  // One persistent thread per (patient × clinician × mode). Research-mode
  // has patientId=null, so the unique key tolerates it via composite.
  @@unique([orgId, patientId, clinicianOrgUserId, mode])
  @@index([orgId, clinicianOrgUserId, lastActivityAt])
}

model CopilotMessage {
  id             String   @id @default(cuid())
  conversationId String
  role           String   // 'user' | 'assistant'
  content        String   // PHI possible
  sourcesJson    Json?    // citations: [{kind, id, label}]
  toolCallsJson  Json?    // tool calls made during this turn
  createdAt      DateTime @default(now())

  conversation   CopilotConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
}

enum CopilotConversationMode {
  CHART
  RESEARCH
}
```

The migration is **purely additive** — no changes to existing tables.

### Phase A — state builder

`src/services/copilot/state-builder.ts` exports:

```ts
export async function rebuildCopilotPatientState(args: {
  orgId: string;
  patientId: string;
  clinicianOrgUserId: string;
}): Promise<CopilotPatientState>;
```

What it reads (each via Prisma, no LLM calls — pure projection):

- `CaseManagement` + per-case viewer-recency signals (reuses the
  projection from `patients/[id]/page.tsx` — extract to a shared helper
  in `src/lib/case-management/viewer-recency.ts` if not already).
- The last 20 `Note` rows for the patient where `status IN (SIGNED, TRANSFERRED)`,
  joined with their `Encounter.caseManagementId` for cross-visit pattern
  detection.
- Open `FollowUp` rows for the patient.
- `CaseRouterRun` history per case (from Sprint 0.13).
- (Sprint 0.16+) FHIR `Condition` resources — additive when ready.

What it writes:

- `caseAwarenessJson` — per-case: ICD, last viewer activity, routing
  confidence over time, FHIR mirror id (when applicable).
- `observedPatternsJson` — structured patterns: e.g.
  `{ kind: 'topic_mentioned_unaddressed', topic: 'sleep_disturbance',
  count: 3, observedInNoteIds: [...], firstSeen, lastSeen }`. Phase 1 ships
  with a small fixed taxonomy of pattern detectors (see *Pattern
  catalog* below); extensible later.
- `conversationFactsJson` — structured citations distilled from prior Ask
  conversations: e.g. `{ summary: 'patient confirmed lisinopril adherence
  improving', sourceNoteId: '...', citedAt: '...' }`. Phase 1 ships with
  a simple extractor that pulls the `sourcesJson` of prior assistant
  messages into facts — no LLM summarization yet.

The builder is **idempotent and deterministic** — running it twice gives
the same output. No randomness, no LLM calls inside it. (LLM
summarization could be added later in a Phase 2 refinement of this
sprint; out of scope here.)

**Pattern catalog (Phase 1, fixed):**

| Pattern kind | Detector |
|--------------|----------|
| `topic_mentioned_unaddressed` | A keyword appears in N consecutive notes' transcripts but never in the Plan section. Bounded keyword list (sleep, anxiety, weight, pain, falls). |
| `measure_trend` | A `SnapshotMeasure` value moves monotonically over the last 3+ visits. |
| `recert_due_soon` | A REHAB episode's `recertDueAt` falls within 14 days. |
| `goal_stalled` | A `Goal` with status `ACTIVE` has had no `GoalProgressEntry` update in 4+ weeks. |

Detectors are pure functions over the inputs. Each writes a structured
entry to `observedPatternsJson`. The card and the agent both consume the
same shape.

### Phase A — refresh worker

`src/workers/cleo-state/handler.ts`:

- Job payload: `{ orgId, patientId, clinicianOrgUserId }`.
- Job: calls `rebuildCopilotPatientState(payload)`, upserts the row.
- Audit: `CLEO_STATE_REBUILT` with `{ stateId, generatorVersion,
  rebuildDurationMs, personaVersion }`. No PHI.
- Retry: 3, exponential backoff (rule 10).

Triggers (chain-enqueue from existing workers / routes):
1. `ai-generation/handler.ts` — on `NOTE_GENERATION_COMPLETED`, enqueue
   for the note's authoring clinician.
2. `/api/notes/[id]/sign/route.ts` — on sign, enqueue for the signing
   clinician (and queue for *all* clinicians who have an existing
   state row on this patient — they need to learn from the new sign too).
3. `/api/notes/[id]/case-router/accept/route.ts` (Sprint 0.13) — on
   acceptance, enqueue for the accepting clinician.

Throttle: at most one rebuild per (patient × clinician) per 5 minutes
(BullMQ job-id with hash + TTL). Newer events that arrive during the
window are coalesced.

### Phase B — Ask conversation persistence

The Ask endpoint (`/api/copilot/ask`) is currently session-ephemeral.
Modify so that on every turn:

1. Look up `CopilotConversation` for `(orgId, patientId, clinicianOrgUserId,
   mode)`. If absent, create it (audit `CLEO_CONVERSATION_OPENED`).
2. Persist the user message (`CopilotMessage` with `role='user'`).
3. Build the agent's prompt context, **including the last N messages**
   from this conversation (default N=20).
4. Call the agent. Persist the assistant message with `sourcesJson` and
   `toolCallsJson`.
5. Update `CopilotConversation.lastActivityAt`.

`AskSurface` + `ResearchSurface` (`src/components/copilot/*.tsx`):

- On mount: server-fetch the conversation for the current context and
  hydrate `messages` state.
- Existing UI structure is unchanged — only the message-state source
  changes from ephemeral useState to "load from DB then append."
- The first-open-greeting guard (Unit 42) only fires when the
  conversation is **brand new** (zero messages in DB). For a returning
  conversation, no greeting — Cleo picks up where the clinician left off.

**Reset action:** a "Reset this conversation" menu item in the Sheet
header (3-dot menu) deletes the `CopilotConversation` row (cascades to
messages). Audit logs `CLEO_CONVERSATION_PURGED` (no PHI). The
`CopilotPatientState` row is untouched — facts cited from prior chats
remain in `conversationFactsJson`, since they're already distilled from
sources.

### Phase B — case-router gets richer context (one-line wiring)

In `src/services/copilot/case-router.ts` (from Sprint 0.13), at the
beginning of `propose()`:

```ts
const state = await prisma.copilotPatientState.findUnique({
  where: {
    orgId_patientId_clinicianOrgUserId: {
      orgId, patientId, clinicianOrgUserId,
    },
  },
});
```

If `state` is non-null, append a structured "Prior cross-visit context"
block to the agent's system prompt. The block lists patterns + a brief
case-awareness summary. If `state` is null, the agent runs identically
to Sprint 0.13.

The state's `conversationFactsJson` is **not** appended to the
case-router prompt — those are Ask-mode facts, not routing-relevant
signal. Keep routing inputs tight.

### Phase C — the "Cleo's read" chart card

`src/app/(clinical)/patients/[id]/_components/cleo-read-card.tsx`:

```
┌─────────────────────────────────────────────────────────┐
│ ✨ Cleo's read · James Park                              │
│ ─────────────────────────────────────────────────────── │
│ 4 active cases · 2 open follow-ups · BP trend ↓         │
│                                                          │
│ Patterns noted (2):                                      │
│   · Sleep mentioned in last 3 visits (unaddressed)      │
│   · Recert due in 8 days — Right knee OA                │
│                                                          │
│ [ Ask me anything →  ]                                  │
└─────────────────────────────────────────────────────────┘
```

- Sourced from the server-fetched `CopilotPatientState` for the viewing
  clinician.
- Tap "Ask me anything" → opens the copilot Sheet (already mounted via
  `CopilotShell`) with the persistent conversation already loaded.
- Empty state (no state row yet):
  ```
  ✨ Cleo's read · I'm just learning this patient.
     [ Ask me a question to get started →  ]
  ```
- Refresh: server-fetched on each chart load; no client-side polling.
  Stale state is acceptable; the chart prefers cheap reads over
  always-fresh.

Mount at the **top** of the Overview tab, ABOVE the existing
SnapshotInlineStrip + cockpit tiles.

### Audit additions

Append-only to `AuditAction`:

| Action | When | Metadata (PHI-free) |
|--------|------|---------------------|
| `CLEO_STATE_REBUILT` | Refresh worker completes | `{ stateId, patientId, clinicianOrgUserId, generatorVersion, rebuildDurationMs, personaVersion }` |
| `CLEO_CONVERSATION_OPENED` | First message in a fresh conversation row | `{ conversationId, mode, patientId, personaVersion }` |
| `CLEO_CONVERSATION_PURGED` | "Reset this conversation" fires | `{ conversationId, mode, patientId, personaVersion }` |

Existing `COPILOT_ASK_ANSWERED` continues to fire on every assistant
turn; no change.

## Implementation steps

1. **Schema migration:** append the three models + the enum. No changes
   to existing tables. `npx prisma migrate dev --name
   sprint_0_14_cleo_persistent_memory`. Reseed clean (rule 4).
2. **State builder** (`src/services/copilot/state-builder.ts`):
   pure-function rebuilder + Zod-validated JSON shapes for the three
   projection fields. Unit tests cover each pattern detector + the
   case-awareness rollup.
3. **Refresh worker** (`src/workers/cleo-state/handler.ts`): BullMQ job,
   retry 3 + exponential backoff, audit `CLEO_STATE_REBUILT`.
4. **Chain-enqueue** from ai-generation worker, sign route, and (after
   Sprint 0.13 lands) case-router accept route.
5. **Conversation persistence** in `/api/copilot/ask/route.ts` —
   read/write `CopilotConversation` + `CopilotMessage`; the prior-message
   context becomes part of the prompt.
6. **AskSurface + ResearchSurface** hydrate from DB on mount; the
   first-open greeting only fires for brand-new conversations.
7. **Reset action** in the Sheet menu — purges the conversation row.
8. **case-router (Sprint 0.13) wiring** — read `CopilotPatientState` if
   present, append the "Prior cross-visit context" block to the prompt.
   Backward compatible.
9. **`cleo-read-card.tsx`** + Overview-tab mount.
10. **Audit actions** appended.
11. **Tests:**
    - `test/services/copilot/state-builder.test.ts` — each pattern
      detector + idempotency.
    - `test/api/copilot-ask-conversation-persistence.test.ts` — message
      round-trip; one conversation per tuple; reset purges.
    - `test/workers/cleo-state-handler.test.ts` — chain-enqueue paths;
      throttle coalescing.
    - `test/components/cleo-read-card.test.tsx` — renders from a state
      row; empty state path.
12. **Verify** — see *Verify when done* below.

## Out of scope (deliberate)

- **Cross-clinician memory sharing.** Each clinician's memory is their
  own. Sharing would dilute trust calibration and confuse provenance.
- **LLM-driven conversation summarization.** Phase 1 distills facts
  structurally (from `sourcesJson` on prior assistant turns). Adding an
  LLM step to compress conversation history is a Phase 2 refinement.
- **Proactive nudges to the chart.** The card surfaces patterns
  passively; it doesn't pop alerts. Sprint 0.18 owns proactive nudges.
- **FHIR Condition status in the projection.** Sprint 0.16 adds it —
  state-builder gets a small extension when that lands.
- **Org-level config** (e.g., `cleoMemoryRetentionDays`). Add when there's
  a real product reason.
- **Conversation export / printing.** Audit captures everything for
  compliance; clinician-facing export is later.

## Verify when done

- [ ] `prisma migrate` applies cleanly; `prisma db seed` runs clean.
- [ ] Signing a note in dev triggers a `CLEO_STATE_REBUILT` audit row
      within ~5 seconds.
- [ ] Asking Miss Cleo a question and refreshing the browser preserves
      the conversation in the Sheet.
- [ ] Asking on Patient A then opening Patient B shows a separate
      conversation (no cross-patient leak).
- [ ] Logging in as a different clinician on the same patient shows
      that clinician's own conversation (separate thread, separate
      state row).
- [ ] The "Reset this conversation" menu item deletes the row + the
      messages, and the next message creates a fresh conversation.
- [ ] The chart Overview shows the "Cleo's read" card; tapping
      "Ask me anything" opens the Sheet with prior messages loaded.
- [ ] A patient with no prior state shows the empty-state card.
- [ ] When Sprint 0.13 is in `main`, the case-router agent's system
      prompt includes the "Prior cross-visit context" block when state
      exists; backward-compatible when absent.
- [ ] `npm run typecheck` clean. `npm run lint` clean on touched files.
      `npm test` clean (existing 572+ pass; new tests included).
- [ ] Three-lens in PR body.

## Three-lens

- **Clinician** — Miss Cleo becomes a colleague who *remembers*. Open
  the chart, see her current read; open the Sheet, pick up the
  conversation where it was. The case-router gets better silently as
  she learns the patient.
- **Compliance** — every persistent surface (state row, conversation,
  message) carries `personaVersion`. The state projection is
  rebuildable from primary sources, so it's never a divergence risk —
  truth still lives in signed notes, cases, follow-ups, FHIR. PHI in
  messages stored under the same at-rest discipline as note bodies.
- **Auditor** — `CLEO_STATE_REBUILT` traces what Cleo knew when. The
  conversation history reconstructs every clinician-AI exchange for
  the patient. Combined with `CASE_ROUTER_PROPOSED/ACCEPTED` from
  Sprint 0.13 and `COPILOT_ASK_ANSWERED` (existing), one query answers
  *"what did Cleo know + do for this patient with this clinician?"*.

## Downstream impact

- **Sprint 0.15 (FHIR Phase D₁)** — state-builder gains a Condition-list
  read; `caseAwarenessJson` extends with `fhirMirror` references.
  Backward-compatible JSON shape; bump `generatorVersion` to trigger
  rebuilds.
- **Sprint 0.16 (FHIR reconciliation)** — observedPatternsJson gains a
  new pattern kind `case_fhir_status_drift`. Pattern catalog extension.
- **Sprint 0.18 (proactive nudges)** — reads the same pattern catalog;
  no new state needed. Adds a `cleoNudgeAcked` table to track
  dismissals, but operates on the same projection.

The shape lands now in a way that future sprints extend additively
without rewriting state-builder.
