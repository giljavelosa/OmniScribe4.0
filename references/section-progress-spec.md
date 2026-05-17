# OmniScribe — Section Progress Strip + Per-Section Regenerate

**Status:** Draft for implementation
**Owner:** Gil
**Last updated:** 2026-05-05
**Implementation pattern:** Master spec; derive numbered `cursor-tasks/` files per sub-phase
**Sub-phases (cursor-tasks):** `40-section-progress-foundation.md`, `41-section-progress-api-sse.md`, `42-section-progress-ui.md`
**Anchored anti-regression rules:** 6, 8, 9, 10, 16, 18 + founder rule (no review/sign shell modification, no AssemblyAI/Soniox integration changes)

---

## 1. Goal

Replace the existing during-visit capture surface's silent section-by-section generation with a **visible section progress strip** plus **per-section regenerate**, so a clinician can see at a glance which sections of the active template have generated content (and in what state) and can re-run the LLM for *just one section* without losing the rest of the note.

The redesigned capture screen renders:

- A **horizontal progress strip** at the top of the capture surface listing each section in the active template, each cell carrying a **5-state status badge** (empty / generating / populated / edited / failed) and a **per-section regenerate button** (`↻`)
- A **prompt-on-overwrite confirmation dialog** when the clinician hits regenerate on a section in `edited` state — same `<AlertDialog>` primitive (`alertdialog` ARIA role) that Phase 13d's recert/reopen dialog uses, founder-rule guarantee for clinical confirmations
- **Real-time status updates via SSE** — the existing capture-screen SSE channel gains two new event types (`section.generating` / `section.completed`) so the strip reflects worker progress without polling
- **Per-section regenerate driven by a new BullMQ job type** in the *existing* `aiNoteGenerationWorker` — single Redis queue, single worker fleet (anti-regression rule 18 preserved)
- **Partial-write semantics** — the worker replaces only the target section's path in `Note.draftJson`; other sections are left untouched, including any clinician edits

The data model is purely additive on top of existing `Note.draftJson` shape and the existing SSE channel; no Prisma migration, no new BullMQ queue, no new LLM call paths beyond what `src/services/llm/` already exposes.

## 2. Why now

Phase 13 (patient detail) shipped today end-to-end. The next "while waiting for NextGen" workstream is improving what happens **inside the visit** — and section-level visibility + per-section recovery is the single highest-leverage during-visit improvement on the deferred-roadmap list. Today the clinician has no glanceable feedback about which sections have been generated, which are mid-generation, or which failed; and a bad Assessment forces regenerating the whole note (or manual editing in place), which is clinically expensive when the Subjective and Objective came out fine.

Strategically, this is the third concrete step in OmniScribe operating as a **clinical copilot** rather than a passive note generator: brief = "I read the chart for you" (Phase 23), patient detail = "I read the whole chart for you" (Phase 13), section progress = "I tell you what I'm doing while I'm doing it, and you can fix one piece without losing the others." Each step is a smaller cost-of-trust for the clinician.

## 3. Non-goals (v1)

- **No template editing** — adding/removing sections, renaming sections, reordering sections within a template are all Phase 14 (Templates) concerns. Phase 04 reads the active template's section list as a fixed input.
- **No "regenerate all" batch action** — per-section only.
- **No changes to AssemblyAI / Soniox / audio capture** — founder rule + anti-regression rules 11, 12. The progress strip *reads* note generation status; it never touches transcription. Audio capture continues uninterrupted during a per-section regenerate.
- **No changes to the review or sign shell components** — founder rule. Phase 04 lives entirely in `capture/[noteId]/page.tsx` and the components it composes.
- **No new BullMQ queues** — per-section regenerate extends the existing `aiNoteGenerationWorker` with a new job *type*, not a new queue. Anti-regression rule 18 preserved.
- **No Prisma schema changes** — `Note.draftJson` already supports partial-section writes (the existing aiNoteGeneration worker already writes section-by-section). Phase 04 reuses that write path; no new columns, no new tables.
- **No polling fallback for the progress strip** — SSE only. If SSE drops, the strip goes stale until the next event or until the user refreshes.
- **No new LLM call paths** — per-section regenerate uses the existing `src/services/llm/` abstraction (rule 6).
- **No changes to the brief generation pipeline (Phase 23)** — section regenerate is for the *current visit's note*, not for the prior-context brief.
- **No mobile-first redesign of capture** — Phase 09 (responsive bonuses) is deferred. The progress strip ships desktop-first; mobile gets a graceful collapse.
- **No section status persistence beyond what already exists** — status derives from existing `draftJson` shape + existing job state. No new "section status" enum on the schema, no new audit-log event type for status transitions (only for the `SECTION_REGENERATED` action itself).
- **No prepare-screen integration** — Phase 04 is capture-only. Prepare-screen integration is a later micro-phase if it has clinical value.
- **No multi-language.**

## 4. The progress strip (experience target)

Top of the capture surface, above the existing transcript pane and controls:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ● Subjective    ⟳ Objective    ○ Assessment    ⚠ Plan    ○ HEP             │
│  populated       generating     empty           failed    empty             │
│       ↻              ↻             ↻              ↻↻         ↻              │
└─────────────────────────────────────────────────────────────────────────────┘
[transcript pane unchanged]
[controls unchanged]
[prior-context panel unchanged]
```

Status legend:

| Glyph | State | Meaning |
|---|---|---|
| `○` | `empty` | No content generated yet |
| `⟳` | `generating` | BullMQ job in flight |
| `●` | `populated` | Fresh from LLM; no clinician edits since last generation |
| `✏` | `edited` | Clinician has touched the content since last generation |
| `⚠` | `failed` | Last generation attempt errored or schema-validated to nothing; retry CTA on the cell |

Each cell carries a `↻` regenerate button. The button:

- On `empty` / `populated` / `edited` → fires regenerate immediately (with the prompt-on-overwrite dialog when status is `edited`)
- On `generating` → disabled (idempotency; server returns `409 SECTION_ALREADY_GENERATING` if forced)
- On `failed` → labeled `↻↻` (retry) — same regenerate action, no overwrite prompt

Three core trust patterns:

- **Glanceability over completeness.** The strip is one row; it doesn't try to show generation timestamps, byte counts, or token usage. Status + label + regenerate, that's it.
- **Partial-rewrite preservation.** Regenerating Section A never touches Section B's content. The clinician's mental model: "fix this one piece" maps directly to the operation.
- **3-tap test.** Open capture → tap a section's `↻` → land on the regenerate confirm dialog (when needed) or on a fresh generation in progress. Anti-regression rule 9.

## 5. Schema — types

### 5.1 TypeScript interfaces

```ts
// src/lib/types/section-progress.ts (NEW)

/** Five-state section status. */
export type SectionStatus =
  | "empty"        // No content; never generated yet
  | "generating"   // BullMQ job in flight
  | "populated"    // Fresh from LLM; no clinician edits yet
  | "edited"       // Clinician has touched the content since last generation
  | "failed";      // Last generation attempt errored or schema-validated to nothing

export interface SectionProgress {
  /** Stable section identifier from the active template (e.g. "subjective"). */
  sectionId: string;
  /** Display label from the template (e.g. "Subjective"). */
  label: string;
  status: SectionStatus;
  /** Set when status === "generating"; ISO. */
  generationStartedAt?: string;
  /** Set when status === "populated" or "edited"; ISO. */
  lastGeneratedAt?: string;
  /** Set when status === "failed"; sanitized error message (PHI-scrubbed). */
  failureMessage?: string;
}

export interface NoteProgressStrip {
  noteId: string;
  templateId: string;
  /** Ordered per template's section list. */
  sections: SectionProgress[];
}
```

### 5.2 Per-section schema map

```ts
// src/lib/notes/section-schemas.ts (NEW)

import { z } from "zod";

/**
 * Per-section LLM-output schema, keyed by `sectionId`. Per Step 3 decision C,
 * we use a small per-section schema map rather than slicing the full-note
 * schema. Each schema returns the section's content shape that the
 * draftJson partial-write helper expects.
 */
export const SECTION_SCHEMAS: Record<string, z.ZodSchema> = {
  subjective: z.object({ content: z.string() }),
  objective: z.object({ content: z.string() }),
  assessment: z.object({ content: z.string() }),
  plan: z.object({ content: z.string() }),
  // Custom sections from templates surface here at runtime; entries unknown to
  // the map fall back to a permissive `{ content: z.string() }` schema and a
  // warning is logged once per sectionId per process.
};

export function schemaForSection(sectionId: string): z.ZodSchema;
```

### 5.3 Partial-write helper

```ts
// src/lib/notes/draft-json-patch.ts (NEW)

import type { TipTapDoc } from "@/lib/types/tiptap";

/**
 * Replace a single section's content in `Note.draftJson` while preserving
 * every other section's content (including clinician edits). The full-note
 * worker continues to use whole-rewrite; this helper is the per-section
 * regenerate path only (per Step 3 decision B).
 *
 * `draftJson` shape is assumed to have a top-level `sections` map keyed by
 * `sectionId`. Verify in implementation; if the actual shape differs, this
 * helper's signature stays the same — only the internal walk changes.
 */
export function patchDraftJsonSection(
  draftJson: TipTapDoc,
  sectionId: string,
  newContent: { content: string },
): TipTapDoc;
```

### 5.4 BullMQ job shape

```ts
// src/workers/aiNoteGeneration.ts (EXTEND, do not split into a new worker)

interface FullNoteJobData {
  type: "full-note";
  // ...existing fields
}

interface RegenerateSectionJobData {
  type: "regenerate-section";
  noteId: string;
  sectionId: string;
  triggeredById: string;
  /** True when the section was in "edited" state — clinician confirmed overwrite. */
  overwroteEdits: boolean;
}

type AiNoteGenerationJobData = FullNoteJobData | RegenerateSectionJobData;
```

The existing worker dispatches on `data.type`; full-note path is unchanged. New `regenerate-section` path:

1. Load `Note.draftJson` and the active template
2. Identify the section by `sectionId`
3. Run the LLM for just that section through `src/services/llm/` (rule 6) using the existing prompt scaffold scoped to one section
4. Validate response against `schemaForSection(sectionId)`
5. Write via `patchDraftJsonSection(...)` — partial replace only
6. Emit SSE events (see 5.5)
7. Write audit log entry `SECTION_REGENERATED` with `(noteId, sectionId, triggeredById, overwroteEdits, outcome)` — never wrap in silent-swallow try/catch (rule 8)

Both job types share the same retry policy: 3 retries, exponential backoff (rule 10).

### 5.5 SSE event payload

```ts
// src/lib/sse/note-events.ts (EXTEND existing event union)

interface SectionGeneratingEvent {
  type: "section.generating";
  noteId: string;
  sectionId: string;
  startedAt: string;
}

interface SectionCompletedEvent {
  type: "section.completed";
  noteId: string;
  sectionId: string;
  outcome: "populated" | "failed";
  completedAt: string;
  failureMessage?: string;
}
```

Existing full-note SSE events (start / progress / done / error) stay unchanged. Section-level events fire IN ADDITION on per-section regenerate jobs only. The full-note generation job continues to fire only the existing event types.

### 5.6 API contract

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/notes/[noteId]/sections/[sectionId]/regenerate` | `POST` | Enqueue a `regenerate-section` job; return `202 Accepted` with the job id |

The capture-page bootstrap response (whichever endpoint the page already calls — verify in 04b implementation) gains a `progressStrip: NoteProgressStrip | null` field — additive on the wire, existing consumers unaffected. **No new GET /progress endpoint** (per Step 3 decision A).

`POST` request body:

```ts
{
  overwriteEdits?: boolean;
}
```

`POST` server behavior:

- Auth check via existing capture-page helpers
- If section status is `edited` AND `overwriteEdits !== true` → return `409 SECTION_HAS_EDITS` with the current section status. Frontend renders the prompt-on-overwrite dialog.
- If section status is `generating` → return `409 SECTION_ALREADY_GENERATING` (idempotency).
- Otherwise enqueue the job and return `202` + job id.

## 6. Generation flow (per-section regenerate)

When a clinician taps `↻` on a section:

1. UI checks current section status
2. If `edited` → render `<SectionRegenerateConfirmDialog>` (AlertDialog, tap-outside-blocked); on confirm, POST with `overwriteEdits: true`
3. Else → POST directly with `overwriteEdits: false`
4. Server validates state, enqueues `regenerate-section` job
5. Worker emits `section.generating` SSE event
6. UI updates strip cell to `generating`
7. Worker runs LLM, validates, partial-writes, audits
8. Worker emits `section.completed` SSE event with outcome
9. UI updates strip cell to `populated` (or `failed` with failure message)

The partial-write means the rest of the note is undisturbed. Audio capture, transcription, and other sections continue working in parallel.

## 7. UI touchpoints

Three component deliverables, all on the capture page:

### 7.1 `<SectionProgressStrip>` (`src/app/(clinical)/capture/[noteId]/_components/SectionProgressStrip.tsx`, NEW)

- Horizontal flex row, max one cell per section in the active template
- Composes `<SectionProgressCell>` per section
- Mobile: `overflow-x-auto` with chevron hint until scrolled (no tablet-specific layout)
- Empty state: when template has no sections (shouldn't happen but defensive): render nothing

### 7.2 `<SectionProgressCell>` (NEW)

- Status glyph + label + `↻` button
- Click `↻` → triggers regenerate flow (with confirm dialog when status is `edited`)
- 44×44pt min tap target on mobile (a11y rule)
- `aria-label` on `↻` button: `"Regenerate <section label>"`; on `failed` cells: `"Retry <section label> — last attempt failed"`

### 7.3 `<SectionRegenerateConfirmDialog>` (NEW)

- AlertDialog primitive (`alertdialog` ARIA role) — same pattern as Phase 13d's `<RecertReopenDialog>`
- Tap-outside does NOT dismiss (founder-rule clinical-confirmation guarantee)
- Copy: *"Regenerate {{ sectionLabel }}? This will replace your edits."* with `Cancel` / `Regenerate` buttons
- `Regenerate` is the primary destructive action (warning palette)
- Focus trap; returns focus to the cell's `↻` button on close

### 7.4 `useSectionProgress` hook (NEW)

- Mounts: reads initial `progressStrip` from the capture-page bootstrap response
- Subscribes: existing SSE channel; reconciles `section.generating` / `section.completed` events into local state
- Exposes: `{ strip, regenerateSection(sectionId), isRegenerating(sectionId) }`
- Optimistic UI: on regenerate trigger, immediately flips the cell to `generating` (rollback on `409` response)

### 7.5 Capture page integration

- `<SectionProgressStrip>` slots in at the top of `src/app/(clinical)/capture/[noteId]/page.tsx`, above the existing transcript pane
- All other components on the capture page render unchanged
- The page passes the bootstrap `progressStrip` into the hook via prop

## 8. HIPAA / compliance

- All section regenerate calls go through the existing capture-page auth helpers (no widening of access scope)
- `SECTION_REGENERATED` audit log entries record `(noteId, sectionId, triggeredById, overwroteEdits, outcome)` — never the section content itself (PHI scrub)
- `failureMessage` on the wire is sanitized of clinical content before it leaves the worker (existing PHI-scrub utility on the brief generator's error path)
- All LLM calls go through `src/services/llm/` (rule 6); no direct Bedrock SDK calls
- The new SSE event types contain only `(noteId, sectionId, startedAt/completedAt, outcome)` — no clinical content on the wire
- Production deploys must verify `SONIOX_BAA_ON_FILE=true` and current Bedrock BAA before ship (rule 17) — unchanged from prior phases
- 42 CFR Part 2 sensitivity inheritance — section regenerate respects the note's existing sensitivity gating (a clinician who can't read the note can't regenerate sections of it; the access check is the same one)

## 9. Phasing roadmap

Three sub-phases, each independently shippable, each gated by acceptance criteria. Each becomes its own `cursor-tasks/40`–`42` file.

| Sub-phase | Cursor-task | Title | Risk | Effort |
|---|---|---|---|---|
| 04a | `40-section-progress-foundation.md` | Types + per-section schema map + partial-write helper + worker job-type discriminator | Low | 0.75 sprint |
| 04b | `41-section-progress-api-sse.md` | Worker behavior + new POST endpoint + capture-page response extension + SSE events + tests | Medium (new worker behavior + new endpoint) | 0.75 sprint |
| 04c | `42-section-progress-ui.md` | Strip / cell / confirm-dialog / hook + capture-page wiring + 3-tap test | Medium (UI surface area) | 1 sprint |

### 9.1 Phase boundaries (the gates)

- **04a ships when** types are exported, per-section schema map covers S/O/A/P + the permissive fallback, partial-write helper passes unit tests against representative `draftJson` shapes, `RegenerateSectionJobData` discriminator type compiles cleanly into `aiNoteGenerationWorker`. No behavior change at this phase.
- **04b ships when** `POST /api/notes/[noteId]/sections/[sectionId]/regenerate` returns `202` for valid requests, `409` for conflicts; worker handles `regenerate-section` jobs end-to-end against a stubbed-LLM test; SSE channel emits new event types correctly; capture-page bootstrap response carries `progressStrip`; audit log written via the rule-8 path.
- **04c ships when** the strip renders all five status states correctly; tapping `↻` on each state behaves correctly (immediate fire vs confirm prompt vs disabled vs retry); SSE updates reflect in the UI in real time; 3-tap test passes on desktop and mobile.

### 9.2 Critical-path ordering

```
04a (foundation) → 04b (worker + API + SSE) → 04c (UI + integration)
```

04a and 04b cannot run in parallel — 04b depends on 04a's types, schema map, and partial-write helper. 04c depends on 04b's API + SSE events.

### 9.3 Dependency on existing roadmap

This work touches `src/app/(clinical)/capture/[noteId]/page.tsx` and `src/workers/aiNoteGeneration.ts`. Phase 02 (capture refactor) and Phase 03 (setup-to-prepare) are already on `main`, so no merge-conflict risk against in-flight work. No dependency on FHIR phases F1–F6 (which remain blocked on NextGen).

## 10. Migration / back-compat

- 04a and 04b ship without removing any existing API field; the existing capture page continues to render unchanged through 04b (it just ignores the new `progressStrip` field).
- 04c removes nothing visible — the strip is purely additive at the top of the page.
- Existing full-note generation continues to work unchanged; the new job type is dispatched on `data.type === "regenerate-section"` only.
- No `Note`, `Template`, or `Section` schema changes. No data migration.

## 11. Open questions (deferred — not blocking implementation)

- **Section regenerate rate-limiting** — should the server enforce a per-clinician-per-noteId-per-section cooldown (e.g., max 1 regenerate per section per 30s)? Default for v1: no — the worker queue depth + the `409 SECTION_ALREADY_GENERATING` idempotency check are sufficient. Re-evaluate if production logs show abuse.
- **Section regenerate during `full-note` generation** — what happens if a clinician taps `↻` on Section A while the full-note generation worker is still running for the same note? Default: server returns `409 SECTION_ALREADY_GENERATING` if any aiNoteGeneration job is in flight for the noteId. Conservative; revisit if it surfaces clinically wrong moments.
- **Edit-debounce for the `edited` status flip** — does a single keystroke immediately flip status to `edited`? Default: yes, but the flip is local-state-only until the next save (matches existing draft autosave timing). Re-evaluate if "edited" badges flicker noticeably.
- **Failure recovery for `failed` sections after page reload** — when a clinician reloads the capture page mid-`failed`, does the strip show the failure or reset to `empty`? Default: persist `failed` state across reload via the bootstrap response (`progressStrip` includes `status: "failed"` + `failureMessage`). Requires a tiny additive field on the worker's failure path: write the failure to a transient `Note.draftJson` field (or a sibling state column) so the bootstrap can read it.

## 12. Anti-patterns to avoid

- See @CLAUDE.md rules 6 (all LLM through `src/services/llm/`), 8 (no silent audit/log swallows), 9 (3-tap test), 10 (BullMQ retry policy), 16 (`dev:workers` running), 18 (single worker fleet)
- Do **not** create a new BullMQ queue for section regenerate — extend the existing `aiNoteGenerationWorker` with a job-type discriminator
- Do **not** introduce a polling fallback for the progress strip (Step 1 decision; SSE only)
- Do **not** modify the AssemblyAI / Soniox integration (founder rule)
- Do **not** modify the review or sign shell components (founder rule)
- Do **not** use the lighter `<Dialog>` primitive for the regenerate confirm dialog — use `<AlertDialog>` (`alertdialog` ARIA role) so tap-outside is blocked, matching the founder-rule clinical-confirmation guarantee Phase 13d's recert dialog set
- Do **not** silently overwrite clinician edits — the prompt-on-overwrite dialog is a hard requirement when status is `edited`
- Do **not** widen access — re-use the existing capture-page auth helpers
- Do **not** put section content in SSE event payloads or audit log metadata (PHI scrub)
- Do **not** call Bedrock SDK directly from worker or route handlers (rule 6)
- Do **not** add a "regenerate all" button (Step 2 non-goal)
- Do **not** integrate the strip into the prepare screen (Step 4 decision; capture-only)

## 13. Success metrics (Track phase, per AGENT framework)

These are capability-expansion metrics, not task-tally metrics:

- **Time-to-detect a wrong section** — clinician opens capture → notices a section that needs regeneration. Target: ≥ 50% reduction vs. pre-Phase-04 baseline (where the clinician has to scroll/read to find issues).
- **Per-section regenerate rate per visit** — average regenerates per visit. Healthy steady-state: 0.5–1.5 (some visits never need regenerate; some need one or two). Way above (e.g. > 3 per visit) signals the underlying generation quality is degrading; way below signals clinicians don't trust the regenerate or don't notice issues.
- **% of regenerates that survive sign** — i.e., the regenerated section is in the final signed note vs. further re-edited. Target ≥ 60%; below that signals the regenerate prompt scaffold needs work.
- **SSE event delivery latency p95** — time from `section.completed` worker emission to UI render. Target < 1s; above signals SSE health issue.
- **Failed-state recovery rate** — % of `failed` sections that successfully regenerate on retry. Target ≥ 80%; below signals deeper LLM-pipeline issue.

Reject as success metrics: number of regenerates per day, number of strip cells rendered, regenerate latency alone. Those are activity metrics, not capability metrics.
