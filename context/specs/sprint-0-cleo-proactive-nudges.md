# Sprint 0.18: Miss Cleo — proactive nudges

> The first sprint in which Cleo **initiates** the conversation. Up
> through 0.17, every Cleo surface was *reactive*: the clinician
> signs a note → Cleo refreshes state; the clinician opens a chart →
> Cleo shows what she remembers; the clinician opens a review screen
> → Cleo proposes a route. Sprint 0.18 closes the loop by promoting
> the patterns Cleo has been quietly detecting since Sprint 0.14
> (and extending in 0.16/0.17) into **nudges** — small, dismissible,
> source-cited cards that appear at the two moments the clinician
> can actually act on them: when they open a patient chart, and
> when they start a visit. The same rule-24 discipline applies:
> Cleo *surfaces data with a suggested action*; she does not make
> clinical recommendations.

## Context — read first

- `CLAUDE.md` — agent rules. The ones that matter most:
  - **Rule 20** — copilot reads only SIGNED/TRANSFERRED notes,
    confirmed FollowUps, and verified FHIR. Nudges derive from
    `CopilotPatientState.observedPatternsJson` (Sprint 0.14) which
    is already gated on rule-20 sources. Sprint 0.18 adds NO new
    data sources — it only promotes already-detected patterns into
    a UI surface.
  - **Rule 24** — data only, no clinical recommendations. Nudges
    cite their evidence ("PHQ-9 has trended from 12 → 17 → 19
    across the last 3 visits") and offer a contextual action
    ("Open today's plan to address"), but they NEVER prescribe a
    clinical decision. The "action" buttons take the clinician to
    a screen where THEY decide.
  - **Rule 22** — `<AlertDialog>` not native `confirm()` for any
    destructive nudge action (Dismiss with cooldown OK as a
    one-tap; Snooze opens a small picker).
  - **Rule 23** — `<StatusBadge>` for priority chips.
  - **Rule 8** — audit-log writes never swallowed. Every nudge
    lifecycle transition writes an audit row outside swallowing
    try-catch.
  - **Rule 10** — BullMQ jobs retry 3× exponential. The
    generator job (which sits in the existing `cleo-state` queue
    or a new sibling) inherits this.
- `context/specs/sprint-0-cleo-persistent-memory.md` — Sprint 0.14.
  Established `CopilotPatientState.observedPatternsJson` + the four
  initial pattern kinds (`topic_mentioned_unaddressed`,
  `measure_trend`, `recert_due_soon`, `goal_stalled`).
- `context/specs/sprint-0-fhir-reconciliation.md` — Sprint 0.16.
  Added `case_fhir_status_drift` pattern kind.
- `context/specs/sprint-0-fhir-writeback.md` — Sprint 0.17. Sprint
  0.18 adds a new pattern kind `fhir_writeback_failed_permanent`
  to surface 0.17's PERMANENT-failure proposals back into the
  clinician's view.
- `context/specs/sprint-0-case-management.md` — Sprint 0.11. The
  Cases-panel hero pattern (Sprint 0.11.1) is the reference
  precedent for "what does a Cleo-driven affordance look like on
  the chart." Nudges sit *adjacent* to the active-case hero, not
  *inside* it.
- `journeys/02-typical-visit.md` — the typical-visit journey;
  Sprint 0.18's visit-prepare nudge surface lives at that
  journey's "before-recording" inflection point.

## Files this sprint touches

Schema + migration:
- `prisma/schema.prisma` — new `CleoNudge` model + new
  `CleoNudgeStatus`, `CleoNudgePriority`, `CleoNudgeKind` enums.
  Additive only.
- A new Prisma migration directory:
  `prisma/migrations/<ts>_sprint_0_18_cleo_nudges/`.

Service code:
- `src/services/copilot/nudge-generator.ts` (NEW) — pure functions
  that read `CopilotPatientState.observedPatternsJson` (plus the
  Sprint 0.17 `FhirWriteBackProposal` rows for the new
  `fhir_writeback_failed_permanent` kind) and emit a candidate
  `CleoNudgeCandidate[]` list. No DB writes; no LLM calls.
- `src/services/copilot/nudge-selector.ts` (NEW) — applies
  cooldowns, deduplication against existing `CleoNudge` rows,
  priority sorting, and the per-surface cap. Returns the final
  display set for a (patient × clinician × surface) tuple.
- `src/services/copilot/state-builder.ts` — extend
  `observedPatternsJson` schema with the new kind
  `fhir_writeback_failed_permanent`. Bump
  `CLEO_STATE_GENERATOR_VERSION` to `'cleo-state-v4'`.

Worker:
- `src/workers/cleo-state/handler.ts` — after the existing
  state-projection upsert, call the nudge generator and persist
  candidate rows (status `PROPOSED`). One pass — the same job that
  rebuilds state also seeds the nudge candidates.
- `src/lib/queue.ts` — no new queue. Nudge generation rides the
  existing `cleo-state` throttle/jobId pattern.

API:
- `src/app/api/nudges/[id]/dismiss/route.ts` (NEW) — flips
  `CleoNudge.status` to `DISMISSED`, stamps `dismissedAt` +
  `dismissedByUserId`, starts the per-kind cooldown.
- `src/app/api/nudges/[id]/snooze/route.ts` (NEW) — flips to
  `SNOOZED` with a `snoozeUntil` timestamp; surfaces again
  automatically once the timestamp passes (driven by a "show?"
  filter at read time — no scheduled job needed).
- `src/app/api/nudges/[id]/act/route.ts` (NEW) — flips to
  `ACTED`, stamps `actedAt` + `actedByUserId` + `actedAction`
  (the slug of the affordance the clinician pressed, e.g.
  `'open-reconcile-flow'` / `'start-recert-visit'`). Idempotent.

Chart + visit-prepare integration (read-side):
- `src/app/(clinical)/patients/[id]/page.tsx` — load active
  nudges for the (patient × viewer × `'chart'` surface) tuple and
  pass into the chart shell.
- `src/app/(clinical)/patients/[id]/_components/patient-chart-tabs.tsx`
  — render the new `<ChartNudgeStack>` above the Cases panel
  hero (or below the StickyChartHeader; see UI section).
- `src/app/(clinical)/prepare/[noteId]/page.tsx` — same read +
  pass-through, surfaced as `<PrepareNudgeBlock>` above the
  recording controls.

UI surfaces (NEW):
- `src/components/cleo/nudge-card.tsx` — single-nudge presentation
  card. Cited evidence + priority pill + action affordance +
  dismiss/snooze. Visit-prepare and chart variants differ only in
  density (chart compact / prepare expanded).
- `src/components/cleo/chart-nudge-stack.tsx` — chart hero
  affordance. Default-collapsed "Cleo notes N things" pill that
  expands on tap. Max 3 nudges visible.
- `src/components/cleo/prepare-nudge-block.tsx` — visit-prepare
  block. Up to 3 nudges, each `<NudgeCard>` in expanded form.
- `src/components/cleo/nudge-dismiss-menu.tsx` — small picker:
  Dismiss / Snooze 1d / Snooze 7d. AlertDialog not required for
  these (one-tap, non-destructive — both transitions are
  reversible: the next state-rebuild will re-propose if the
  pattern persists).

Audit:
- `src/lib/audit/actions.ts` — append four new actions
  (`CLEO_NUDGE_PROPOSED`, `CLEO_NUDGE_SHOWN`, `CLEO_NUDGE_DISMISSED`,
  `CLEO_NUDGE_ACTED`, `CLEO_NUDGE_SNOOZED`, `CLEO_NUDGE_EXPIRED`).
  All PHI-free.

## Goal

Two new surfaces ship in this sprint:

1. **Chart nudge stack** — At the top of the patient chart, a
   small "Cleo notes N things" pill. Tap to expand. Up to 3 cards;
   each card carries a short cited label, a priority chip, and a
   single contextual affordance (e.g., "Open today's plan", "Start
   recert visit", "Resolve drift", "Re-evaluate goal"). Dismissing
   or snoozing is one tap.

2. **Visit-prepare nudge block** — When the clinician opens the
   `/prepare/[noteId]` screen *before* recording, Cleo surfaces
   the same nudges in expanded form ("Before this visit, here's
   what I noticed"). The visit-prepare surface is where most
   actionable nudges shine (the clinician is mentally setting up
   for the visit and can absorb context).

Behind the surfaces:

- A **generator** that runs after every `cleo-state` rebuild
  (i.e., post-sign / post-routing-accept / post-drift-resolve /
  post-writeback-failure) and emits candidate nudges from the
  already-detected patterns.
- A **selector** that filters by cooldowns, dedup, priority, and
  per-surface cap.
- A **state machine** (`PROPOSED → SHOWN → DISMISSED|ACTED|SNOOZED|EXPIRED`)
  with audit on every transition.
- An **expiry sweep** baked into the read filter: when the
  underlying pattern no longer exists on the latest
  `observedPatternsJson` rebuild, the open nudge auto-flips to
  `EXPIRED` at the next read.

## Decisions

1. **One nudge per (patient × kind × triggering-snapshot).** The
   generator deduplicates by `(patientId, kind, sourcePatternSnapshotHash)`
   so re-running the generator on an unchanged pattern doesn't
   spawn duplicates. The hash collapses a pattern's identity
   (e.g., `goal_stalled:goal_42:since_2026-04-15`) into a stable
   string. **Rationale:** the generator runs frequently (every
   `cleo-state` rebuild); one row per logical nudge keeps the
   table compact.

2. **Two surfaces, one nudge pool.** Both the chart stack and the
   visit-prepare block read the same `CleoNudge` rows for the
   (patient × clinician) tuple, filtered by per-surface eligibility.
   A nudge that fits both surfaces shows on both — dismissing on
   one surface dismisses on both. **Rationale:** consistency. The
   clinician doesn't get the same nudge twice in the same session.

3. **Per-kind priority + cooldown tables (NOT clinician-tunable in
   this sprint).** Hardcoded in `nudge-selector.ts`:

   | Kind | Priority | Cooldown after dismiss | Auto-expire when |
   |------|---------|------------------------|------------------|
   | `recert_due_soon` | HIGH | 1d | Recert encounter signed |
   | `case_fhir_status_drift` | HIGH | 3d | Drift resolved |
   | `fhir_writeback_failed_permanent` | HIGH | 1d | Proposal cancelled or org-disabled |
   | `measure_trend` | MEDIUM | 14d | Trend reverses (next measure is lower) |
   | `goal_stalled` | MEDIUM | 14d | New `GoalProgressEntry` lands |
   | `topic_mentioned_unaddressed` | LOW | 7d | Topic appears in plan |

   **Rationale:** keep the cognitive surface predictable in
   Sprint 0.18. Per-clinician tuning is a future sprint.

3a. **High-priority nudges can re-surface earlier than the cooldown
    *if* the underlying signal escalates.** Example: a
    `recert_due_soon` nudge for "due in 14 days" dismissed → 7
    days later the pattern detector now emits "due in 3 days" with
    a *different* snapshot hash → the generator creates a fresh
    nudge (the old one stays `DISMISSED`; the new one is its own
    row). **Rationale:** an escalating clinical signal must not
    get silenced by a stale dismissal.

4. **Per-surface cap: 3 nudges.** Both the chart stack and the
   visit-prepare block render at most 3. If more are eligible, the
   selector picks by `(priority DESC, proposedAt ASC)`. Overflowed
   nudges aren't lost — they stay `SHOWN`-eligible and surface on
   the next view after one of the visible nudges is dismissed or
   acted. **Rationale:** Hick's law — clinicians glance, scan,
   tap; 3 items is the upper bound for at-a-glance.

5. **`SHOWN` is recorded at the SURFACE component, not at fetch
   time.** The page fetches the eligible list; the
   `<NudgeCard>` component writes the `CLEO_NUDGE_SHOWN` audit
   row + flips status from `PROPOSED → SHOWN` the FIRST TIME it
   mounts for a given nudge. Subsequent mounts (e.g., the
   clinician navigates away + back) DO NOT re-audit. **Rationale:**
   "was it actually seen" needs the render lifecycle, not the
   server-side projection. A clinician who fetches the page and
   immediately closes the tab without scrolling shouldn't have
   "SHOWN" in the audit log.

6. **Dismiss is one-tap. Snooze is a small picker. Both are
   non-destructive.** Dismissal starts a per-kind cooldown but
   doesn't bar future re-surfacing (decision 3a). Snooze defers to
   a specific timestamp (1d / 7d) but is otherwise identical to
   dismissal. The clinician never needs an `<AlertDialog>` to
   dismiss — they can tap fast and move on. **Rationale:** never
   create friction around dismissing nudges; that's the path to
   "clinician disables Cleo's nudges entirely."

7. **`ACTED` is recorded when the contextual affordance is
   pressed.** Pressing the affordance navigates to the relevant
   screen AND fires the act endpoint in the same call. The
   affordance must be specific (`'open-reconcile-flow'`,
   `'start-recert-visit'`, `'open-plan-editor'`, `'review-failed-writeback'`),
   not generic ("Open"), so the audit row identifies what the
   clinician chose. **Rationale:** the auditor lens needs to
   distinguish "the clinician chose to address the drift" from
   "the clinician saw the drift nudge and ignored it."

8. **`EXPIRED` is computed at read time, not at write time.** When
   the page reads the eligible nudge list, it filters out nudges
   whose `sourcePatternKind` no longer appears in the patient's
   latest `observedPatternsJson` AND emits a `CLEO_NUDGE_EXPIRED`
   audit row + flips status to `EXPIRED` in a small batch update.
   **Rationale:** the underlying pattern is the source of truth;
   the nudge is a UI projection. Expiry can lag a few seconds
   without harm.

9. **Audit-PHI rule: nudge labels are persisted on the row.** The
   label rendered in the UI (e.g., "Right shoulder pain still
   trending: PHQ-9 12 → 17 → 19") is a derived projection that
   includes patient signal (measure values). For the audit log,
   we record only `nudgeId`, `kind`, `priority`, `affordanceSlug`,
   `surface` — never the label string. **Rationale:** rule 20
   compliance + Safe Harbor PHI minimization. The label can be
   reconstructed from the source pattern at audit-replay time if
   ever needed.

10. **Backward compatibility.** When `CopilotPatientState` has no
    `observedPatternsJson` (pre-Sprint-0.14 patients) OR the
    generator emits zero candidates (no patterns), the nudge
    stacks render as empty (no pill, no block). Default state. No
    UI regression for clinicians who haven't yet had a state-rebuild.

11. **No agent involvement.** The generator is deterministic and
    rule-based. Cleo's voice in the *label text* of the chart
    state-builder is reused, but the nudge generator itself does
    not call the LLM. **Rationale:** nudges are anti-spam by
    design; we don't want the agent to "generate creative
    nudges" — we want it to surface what the deterministic
    detectors already found.

12. **One queue, throttled by the existing `cleo-state` job key.**
    Sprint 0.14 established a per-(org × patient × clinician)
    5-minute coalesce key for `cleo-state`. The nudge generator
    runs in the same handler, so coalescing is automatic. No new
    queue, no new Redis key. **Rationale:** rule 18 — only ONE
    worker fleet per Redis per environment. Adding queues without
    cause adds operational surface.

## Schema migration

`prisma/schema.prisma` — additions only:

```prisma
enum CleoNudgeKind {
  RECERT_DUE_SOON
  CASE_FHIR_STATUS_DRIFT
  FHIR_WRITEBACK_FAILED_PERMANENT
  MEASURE_TREND
  GOAL_STALLED
  TOPIC_MENTIONED_UNADDRESSED
}

enum CleoNudgePriority {
  HIGH
  MEDIUM
  LOW
}

enum CleoNudgeStatus {
  PROPOSED   // Generated by detector; not yet rendered
  SHOWN      // First-render audit fired; clinician saw it
  DISMISSED  // One-tap dismissal; cooldown begins
  SNOOZED    // Defer until snoozeUntil
  ACTED      // Clinician pressed the contextual affordance
  EXPIRED    // Underlying pattern resolved; auto-expired at read time
}

enum CleoNudgeSurface {
  CHART
  VISIT_PREPARE
  BOTH
}

model CleoNudge {
  id                          String              @id @default(cuid())
  orgId                       String
  patientId                   String
  clinicianOrgUserId          String              // Per-clinician (Sprint 0.14 lineage)
  kind                        CleoNudgeKind
  priority                    CleoNudgePriority
  eligibleSurfaces            CleoNudgeSurface

  // Provenance — stable hash of (kind + key identifiers)
  // so dedup at insertion is fast.
  sourcePatternSnapshotHash   String

  // The patterns/payload this nudge is built from. Stored as JSON
  // so the read-time renderer doesn't need to re-derive from the
  // latest observedPatternsJson — useful if the pattern has since
  // shifted but we want to render what the clinician originally
  // saw.
  sourcePatternSnapshotJson   Json

  // Affordance slug — what the "act" button does.
  affordanceSlug              String              // e.g. 'open-reconcile-flow'

  // State machine
  status                      CleoNudgeStatus     @default(PROPOSED)
  proposedAt                  DateTime            @default(now())
  shownAt                     DateTime?
  dismissedAt                 DateTime?
  dismissedByUserId           String?
  snoozedAt                   DateTime?
  snoozedByUserId             String?
  snoozeUntil                 DateTime?
  actedAt                     DateTime?
  actedByUserId               String?
  actedAction                 String?
  expiredAt                   DateTime?

  // Persona lineage
  personaVersion              String              @default("miss-cleo-v1")

  @@unique([clinicianOrgUserId, patientId, kind, sourcePatternSnapshotHash])
  @@index([orgId, patientId, clinicianOrgUserId, status])
  @@index([clinicianOrgUserId, status])
  @@index([proposedAt])
}
```

Migration directory:
`prisma/migrations/20260525000000_sprint_0_18_cleo_nudges/migration.sql`.

`npx prisma db seed` must remain clean. The seed fixtures do NOT
populate any `CleoNudge` rows; the empty table is the steady state
until a `cleo-state` rebuild fires.

## Service code

### `src/services/copilot/nudge-generator.ts` (new)

Pure functions only. No DB writes; no LLM calls. Reads
projection JSON + a small list of writeback failures and emits
candidates.

```ts
export interface NudgeGeneratorInput {
  orgId: string;
  patientId: string;
  clinicianOrgUserId: string;
  observedPatterns: ObservedPatternsJson;       // from Sprint 0.14
  pendingPermanentWritebackFailures: Array<{    // from Sprint 0.17
    proposalId: string;
    caseManagementId: string;
    failureMessage: string;
    failedAt: string;
  }>;
}

export interface CleoNudgeCandidate {
  kind: CleoNudgeKind;
  priority: CleoNudgePriority;
  eligibleSurfaces: CleoNudgeSurface;
  sourcePatternSnapshotHash: string;
  sourcePatternSnapshotJson: unknown;
  affordanceSlug: string;
  label: string; // For UI render — NOT persisted to audit
}

export function generateNudgeCandidates(input: NudgeGeneratorInput): CleoNudgeCandidate[] {
  // Per-kind mappers — pure, deterministic.
  // Hash inputs include the stable identifiers of the source signal
  // (e.g. `recert_due_soon:episode_42:due_2026-06-05`).
  // Decision 3a re-surfacing logic: when a measure_trend's payload
  // includes an escalated reading vs. the prior snapshot, the hash
  // changes — new row.
}
```

Unit tests in `test/services/copilot/nudge-generator.test.ts`
(20+ cases):
- Each pattern kind → corresponding candidate (one-to-one mapping)
- Snapshot hash is stable for the same pattern signal
- Snapshot hash changes when the signal escalates (decision 3a)
- Empty patterns → zero candidates
- Mixed patterns + writeback failures → all candidates emitted
- Affordance slug is deterministic per kind

### `src/services/copilot/nudge-selector.ts` (new)

```ts
export interface NudgeSelectorInput {
  candidates: CleoNudgeCandidate[];
  existingRows: CleoNudge[];                    // For dedup + cooldown
  surface: 'CHART' | 'VISIT_PREPARE';
  now: Date;
}

export interface SelectedNudge {
  row: CleoNudge;                              // Either existing (re-surface) or proposed (new)
  isNew: boolean;
}

export function selectNudgesForSurface(input: NudgeSelectorInput): SelectedNudge[] {
  // 1. Dedup candidates against existing rows by snapshot hash
  // 2. Apply per-kind cooldown (decision 3)
  // 3. Apply auto-expiry filter (decision 8)
  // 4. Sort by (priority DESC, proposedAt ASC)
  // 5. Slice to top 3 (decision 4)
}
```

Unit tests in `test/services/copilot/nudge-selector.test.ts`
(20+ cases):
- Existing DISMISSED row within cooldown → not surfaced
- Existing DISMISSED row outside cooldown → re-surfaced if pattern
  still present
- Existing SHOWN row → counts toward cap; new candidate skipped
- Pattern gone → existing SHOWN row marked for expiry
- High > Medium > Low priority sort
- Cap of 3 per surface; overflow stays available

## Worker integration

`src/workers/cleo-state/handler.ts` — after the existing state
upsert, before the audit log, call into the generator:

```ts
// Existing: rebuild + upsert observedPatternsJson etc.
const newState = await buildStateProjections(...);
await prisma.copilotPatientState.upsert({ ... });

// NEW: generate + persist candidate nudges
const candidates = generateNudgeCandidates({
  orgId, patientId, clinicianOrgUserId,
  observedPatterns: newState.observedPatterns,
  pendingPermanentWritebackFailures: await loadPermanentFailures(orgId, patientId),
});

// Dedup against existing rows by unique key
for (const cand of candidates) {
  await prisma.cleoNudge.upsert({
    where: {
      clinicianOrgUserId_patientId_kind_sourcePatternSnapshotHash: {
        clinicianOrgUserId, patientId, kind: cand.kind,
        sourcePatternSnapshotHash: cand.sourcePatternSnapshotHash,
      },
    },
    create: {
      orgId, patientId, clinicianOrgUserId,
      kind: cand.kind,
      priority: cand.priority,
      eligibleSurfaces: cand.eligibleSurfaces,
      sourcePatternSnapshotHash: cand.sourcePatternSnapshotHash,
      sourcePatternSnapshotJson: cand.sourcePatternSnapshotJson,
      affordanceSlug: cand.affordanceSlug,
    },
    // No update — existing row keeps its lifecycle (decision 3a
    // means a NEW row is created when the hash differs; same hash
    // means same logical nudge, leave it alone).
    update: {},
  });
  await writeAuditLog({
    action: 'CLEO_NUDGE_PROPOSED',
    orgId, patientId,
    metadata: { kind: cand.kind, priority: cand.priority, personaVersion: 'miss-cleo-v1' },
  });
}
```

Worker tests in `test/workers/cleo-state-handler.test.ts`
(extend, +6 cases):
- Patient with one detected pattern → one nudge row created +
  one CLEO_NUDGE_PROPOSED audit row
- Re-run on the same patient with the same patterns → no
  duplicate rows (idempotent via unique key)
- Pattern escalates (hash changes) → new row created
- Patient with zero patterns → zero rows + zero audits
- Writeback failure present → corresponding nudge created
- Audit row never swallowed (rule 8 verification)

## API endpoints

Each route follows the existing pattern of `requireFeatureAccess`
+ Zod-validated body + transaction + audit. The endpoints are
small; the heavy lifting is the generator + selector.

```ts
// POST /api/nudges/[id]/dismiss
// Body: {}
// → 200 { ok: true }; 404 if not found; 409 if not in PROPOSED|SHOWN
// → Flips status to DISMISSED, stamps dismissedAt/dismissedByUserId,
//   writes CLEO_NUDGE_DISMISSED audit row.

// POST /api/nudges/[id]/snooze
// Body: { until: 'iso-8601' }
// → 200 { ok: true }; 404; 409 (same constraints as dismiss)
// → Flips to SNOOZED + snoozeUntil; writes CLEO_NUDGE_SNOOZED.

// POST /api/nudges/[id]/act
// Body: { affordanceSlug: 'open-reconcile-flow' | ... }
// → 200 { ok: true, navigateTo: '/some/path' }
// → 404; 409 (already terminal); idempotent on repeat ACT.
// → Flips to ACTED + stamps actedAt/actedByUserId/actedAction;
//   writes CLEO_NUDGE_ACTED with the affordance slug in metadata.
```

Three API test files in `test/api/nudges-{dismiss,snooze,act}.test.ts`
(15+ cases combined):
- Each route: happy path + 404 + 409 (wrong state) + idempotency on
  ACT
- Audit row written for each terminal transition
- `requireFeatureAccess` is called with the right scope

## Read-side integration (page + components)

### `src/app/(clinical)/patients/[id]/page.tsx`

Append to the existing data-loading section:

```ts
const chartNudges = await loadEligibleNudgesForSurface({
  orgId, patientId, clinicianOrgUserId: viewer.orgUserId,
  surface: 'CHART',
  now: new Date(),
});
// loadEligibleNudgesForSurface reads CleoNudge rows for the tuple,
// runs selectNudgesForSurface against the latest observedPatternsJson,
// AND emits CLEO_NUDGE_EXPIRED for rows whose patterns are gone.
```

`chartNudges` is passed into `<PatientChartTabs />`, which renders
`<ChartNudgeStack nudges={chartNudges} />` above the Cases-panel
hero.

### `src/app/(clinical)/prepare/[noteId]/page.tsx`

Identical pattern with `surface: 'VISIT_PREPARE'`. Renders
`<PrepareNudgeBlock />` above the recording controls.

### `<NudgeCard>` (the shared single-card component)

```tsx
<NudgeCard nudge={n} surface="CHART" onAct={...} onDismiss={...} onSnooze={...}>
  <StatusBadge variant={priorityToVariant(n.priority)}>{priorityLabel(n.priority)}</StatusBadge>
  <h4>{n.label}</h4>
  <p className="text-sm text-muted">{n.subtitle /* cited evidence */}</p>
  <div className="actions">
    <Button onClick={() => onAct(n.affordanceSlug)}>{n.affordanceLabel}</Button>
    <NudgeDismissMenu onDismiss={onDismiss} onSnooze={onSnooze} />
  </div>
</NudgeCard>
```

On first mount, fires `POST /api/nudges/[id]/shown` (a tiny
endpoint that just stamps `shownAt` if it's null and writes
`CLEO_NUDGE_SHOWN` once — decision 5). Uses an effect with a
`useRef` guard so re-mounts don't re-fire.

`priorityToVariant`:
- HIGH → `variant="warning"` (amber — already used for drift
  banners; consistent visual language)
- MEDIUM → `variant="info"` (blue)
- LOW → `variant="neutral"` (gray)

UI smoke tests in `test/components/nudge-card.test.tsx`,
`test/components/chart-nudge-stack.test.tsx` (10+ cases):
- Renders priority pill matching kind
- SHOWN endpoint fires once on first mount; not on remount
- Dismiss button calls the dismiss handler
- Snooze menu opens a small picker
- Act button calls onAct with the right affordance slug
- Cap of 3 enforced in stack
- Empty list → renders nothing (chart pill hidden)

## Audit

`src/lib/audit/actions.ts` — append:

```ts
CLEO_NUDGE_PROPOSED   // Generator created a new row
CLEO_NUDGE_SHOWN      // Component first-mount audit (rule 5)
CLEO_NUDGE_DISMISSED  // One-tap dismissal
CLEO_NUDGE_SNOOZED    // Snooze with snoozeUntil
CLEO_NUDGE_ACTED      // Affordance pressed
CLEO_NUDGE_EXPIRED    // Read-time expiry due to pattern resolution
```

Every row carries `{ nudgeId, kind, priority, personaVersion }` as
metadata. `_ACTED` adds `{ affordanceSlug }`. `_SNOOZED` adds
`{ snoozeUntilIso }`. `_DISMISSED` adds `{ surface }` (which surface
the clinician dismissed it from — chart or prepare). No labels;
no PHI (decision 9).

## Backward compatibility (decision 10 — verified)

- Patients with no `CopilotPatientState` row → `loadEligibleNudgesForSurface`
  returns `[]` → `<ChartNudgeStack>` renders nothing. Sprint 0.16
  / 0.17 chart behavior is byte-identical.
- Patients with `observedPatternsJson` but no candidates emerge →
  same result.
- Existing `cleo-state` worker tests pass with zero modifications
  (the generator call is gated on at least one detected pattern
  OR a permanent writeback failure).
- The visit-prepare page renders nothing new when no nudges are
  eligible.

Verified by:
- A new worker test "no nudges generated when no patterns" with
  the zero-candidate input asserting zero CleoNudge rows + zero
  CLEO_NUDGE_PROPOSED audit emissions.
- A new page test for `/patients/[id]` with no projection state
  asserting `<ChartNudgeStack>` renders no pill.
- The existing Sprint 0.16 chart hero tests pass unchanged.

## Verify when done

1. **Migration** — `prisma migrate` clean; `prisma db seed` clean.
2. **Schema** — `CleoNudge` + new enums present; rollback path
   tested.
3. **Generator unit tests** — `nudge-generator.test.ts` covers all
   six kinds + escalation hash changes + empty input (20+ cases).
4. **Selector unit tests** — `nudge-selector.test.ts` covers cooldowns
   + dedup + cap + priority sort + auto-expire filter (20+ cases).
5. **Worker tests** — extend `cleo-state-handler.test.ts` (+6) for
   nudge generation, dedup, audit.
6. **API tests** — `nudges-{dismiss,snooze,act}.test.ts` (15+
   cases combined; happy path + 404 + 409 + idempotency).
7. **Component tests** — `nudge-card.test.tsx`,
   `chart-nudge-stack.test.tsx` (10+ cases).
8. **Manual on dev** — seed a `goal_stalled` pattern on
   Devon Mitchell (e.g., make an ACTIVE goal with no progress in 28
   days); run `cleo-state` rebuild; verify a row appears in
   `CleoNudge`; open the chart and verify the pill shows; tap
   "Re-evaluate goal" and verify navigation + CLEO_NUDGE_ACTED
   audit. Repeat for `recert_due_soon` + `case_fhir_status_drift`
   + `fhir_writeback_failed_permanent`.
9. **Three-lens** in PR body.
10. **Lint + typecheck + npm test** — clean.

## Three-lens

- **Clinician** — Cleo finally graduates from "answers your
  questions" to "lets you know what to look at." The pill is
  glanceable; the nudges are dismissible in one tap; the
  affordance takes you to the screen where YOU decide. The
  visit-prepare surface is the highest-leverage place to learn
  about a patient's continuity story — Cleo doesn't waste it on
  noise.

- **Compliance** — every nudge is sourced. The
  `sourcePatternSnapshotJson` on each row is the exact data the
  detector saw at the moment the nudge was generated. Combined
  with the lifecycle audit chain (`PROPOSED → SHOWN → ACTED|DISMISSED`),
  any compliance question ("did the system inform the clinician
  about the drift?") can be answered with `WHERE patientId = ? AND
  kind = 'CASE_FHIR_STATUS_DRIFT' AND status IN ('SHOWN', 'ACTED')`.

- **Auditor** — the affordance slug records WHICH path the
  clinician chose ("open-reconcile-flow" vs. "review-failed-writeback"
  vs. "dismiss-no-action"). Auditing "did the clinician engage
  with the system's signals" becomes a categorical question, not a
  narrative one. The expiry path means stale nudges never linger
  unaddressed in the audit log — every row is either acted-on,
  dismissed, snoozed, or naturally expired.

## Anti-regression rules respected

- **Rule 4** — `npx prisma db seed` verified clean post-migration.
- **Rule 8** — every `CLEO_NUDGE_*` audit row is written OUTSIDE a
  swallowing try-catch. The PROPOSED audit fires per candidate in
  the worker; SHOWN/DISMISSED/SNOOZED/ACTED fire inside the
  per-API transactions; EXPIRED fires in a small batched audit at
  read time.
- **Rule 10** — generator runs inside the existing `cleo-state`
  worker; rule-10 retry semantics inherit. No new queue → no new
  retry surface.
- **Rule 18** — no new Redis queue (decision 12); one worker
  fleet's invariant preserved.
- **Rule 20** — nudges derive ONLY from already-rule-20-gated
  sources (`observedPatternsJson` is built from SIGNED/TRANSFERRED
  notes, confirmed FollowUps, verified FHIR per Sprint 0.14, plus
  Sprint 0.17's `FhirWriteBackProposal` rows which are themselves
  derived from rule-20 sources via the accept endpoint).
- **Rule 22** — no native `confirm()`; dismiss + snooze are one-tap
  affordances that don't need an `<AlertDialog>` (they're
  reversible — pattern re-emits → nudge re-surfaces).
- **Rule 23** — `<StatusBadge>` for priority chips; no hardcoded
  status colors.
- **Rule 24** — nudges SURFACE data + offer a contextual *navigation*,
  never a clinical recommendation. The affordance takes the
  clinician to a screen; the screen lets the clinician choose. The
  generator is deterministic + rule-based; the LLM is not in the
  nudge pathway.

## Out of scope (deferred to later sprints)

- **Per-clinician nudge tuning** — priority + cooldown tables are
  hardcoded in Sprint 0.18. A future "Cleo nudge settings" sprint
  can expose per-kind sliders ("show me recert reminders 21 days
  out instead of 14"). Out of scope this sprint.
- **Org-level nudge analytics** — `kind × status × time-to-act`
  metrics. The audit log captures everything we need to build this
  later, but the analytics surface itself is a separate sprint.
- **Push/email/SMS nudges for high-priority off-platform.** Sprint
  0.18 ships in-app surfaces only. External notification channels
  are deferred — they bring their own compliance surface (HIPAA
  for SMS/email transit, BAA scope, etc.).
- **New pattern kinds.** Sprint 0.18 ships the six existing kinds
  (four from Sprint 0.14, one from 0.16, one new in 0.17 surfaced
  here). Inventing new pattern detectors (e.g., "no-show pattern",
  "appointment-coverage gap") is out of scope.
- **Nudge merging.** If a patient has both a `case_fhir_status_drift`
  AND a `fhir_writeback_failed_permanent` on the same case, they
  surface as two separate nudges. Smart merging into a single
  "EHR sync needs attention" composite is reserved for a UX-polish
  sprint after we have real-usage data.
- **Snooze granularity beyond 1d / 7d.** A "custom snooze
  picker" is reserved for the per-clinician-tuning sprint.
