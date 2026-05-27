# Sprint 0.X: Flag-analysis lockdown (Unit 14 follow-on)

> **Status:** APPROVED — design decisions locked 2026-05-26 (walkthrough with Gil).
> **Owner:** Gil
> **Spec date:** 2026-05-26
> **Depends on:** Unit 14 (flag review panel + analyzer), `flag-analysis-state.ts` lifecycle helpers (Sprint 0 hardening), `BEDROCK_FAST_MODEL_ID` env wired (already in `bedrock.ts`).

## Problem

The `/review` flag-review surface lets a clinician click `Re-analyze` an unlimited number of times. Two compounding issues make the loop pathological:

1. **LLM probabilistic re-surfacing.** Even at `temperature: 0`, Sonnet rewrites the same claim with slightly different wording on each run. The worker (`analyze-flags-handler.ts:143-145`) deletes all `OPEN` flags per section and writes a fresh batch from the new LLM output. `RESOLVED` / `DISMISSED` rows persist in the DB but the *new* batch carries no memory of them. So a finding the clinician resolved on run 1 reappears as a brand-new OPEN row with a different `id` on run 2.

2. **No bounded convergence.** Each run can introduce new findings while losing prior resolutions in the perceptual sense ("the same issue keeps coming back"). The clinician can chase their tail indefinitely. There is no anchor that says "you've seen enough; sign."

## Three-lens framing

- **Clinician:** I shouldn't be punished for clicking Re-analyze. If I already accepted or dismissed a claim, the system should remember. And there should be a knowable endpoint — at some point I sign, not analyze forever.
- **Medicare compliance:** The note's compliance posture at sign-time is what matters. A bounded analysis pass + an attested decision per flag is auditable. An unbounded chase is not.
- **Insurance auditor:** Every flag carried forward from a prior run must be traceable to the prior decision. Every signed-with-edits-since-last-analysis decision must be attested. No silent suppressions.

## Decisions locked (2026-05-26)

| ID | Decision | Choice |
|---|---|---|
| L-1 | Analyzer model | **Haiku** (`model: 'haiku'`) for the per-section flag analyzer. Draft generation stays on **Sonnet**. |
| L-2 | When does run #1 fire? | **Inline at the end of `generate-note`**, before `Note.status` flips to `DRAFT`. The `/review` page is not reachable until run #1 finishes (or fails gracefully). |
| L-3 | Hard cap | **2 total runs.** Initial auto-run on draft (run #1) + at most one clinician-triggered re-analyze (run #2). |
| L-4 | Lockdown trigger | After run #2 completes, the `Re-analyze` button is gone permanently; the existing sign gate is the only forward path. |
| L-5 | Decision memory | **Required.** Every `ReviewFlag` carries a stable `claimSignature`. On re-analyze, if a same-signature `RESOLVED` / `DISMISSED` row exists, the new flag is created already-resolved with `resolutionAction = 'CARRIED_FORWARD'` and a reference to the prior decision. |
| L-6 | Diff-based re-analyze | **Required.** Run #2 only calls Haiku on sections whose `draftJson[sectionId].content` hash differs from run #1. Unchanged sections keep their flag set verbatim. |
| L-7 | Initial-analysis failure | Flip to `DRAFT` anyway; show "Flag analysis unavailable — review manually" banner; **run #1 is still consumed** (clinician retains the run #2 retry). |
| L-8 | Edit-without-re-analyze at sign | **Hard block unless attestation.** If `draftJson` hashes differ from the last-analysis snapshot, sign refuses 409 `edited_since_analysis_unattested` UNLESS the client passes `editedSinceAnalysisAttested: true`. The clinician ticks an attestation box ("I've reviewed my edits and accept them without re-analysis"); the tick is audited as `NOTE_SIGNED_WITH_EDITED_SINCE_ANALYSIS_ATTESTATION`. |
| L-9 | Backward compat | Notes with `flagAnalysisRunCount = 0` (pre-deploy) keep today's "Analyze for flags" first-click button behavior; clicking it consumes run #1. After run #1 the new cap applies. No data migration needed. |

## Design

### Lifecycle

```
Capture → Finish & review
   │
   ▼
[DRAFTING — generate-note worker, Sonnet]
   │ section loop completes
   │
   ├── runFlagAnalysisInline(noteId, runOrigin: 'AUTO_ON_DRAFT')
   │      │
   │      ├── Haiku per-section analysis (delete+create OPEN flags)
   │      ├── Stamp Note.flagAnalysisRunCount = 1
   │      ├── Stamp Note.flagAnalysisSectionHashes = { [sectionId]: hash }
   │      └── Audit: FLAGS_AUTO_ANALYZED_ON_DRAFT (or FLAGS_AUTO_ANALYSIS_FAILED)
   │
   ▼
Note.status = DRAFT  (page-router can now route to /review)
   │
   ▼
/review renders WITH flags already loaded.
   │
   ├── No edits + no flags clicked → Sign → /sign  (attestation NOT required: hashes match)
   │
   └── Clinician edits (accept-edit / dismiss / prose edit)
          │
          ├── Sign without re-analyzing
          │      │
          │      ├── Server: detect hash mismatch
          │      ├── If editedSinceAnalysisAttested !== true → 409 edited_since_analysis_unattested
          │      └── Client surfaces attestation checkbox above Sign; on tick + resubmit → sign succeeds + audit row written
          │
          └── Click Re-analyze (only if runCount < 2)
                 │
                 ├── POST /analyze-flags
                 ├── runCount === 2 → 409 analysis_cap_reached (button never shown in this state)
                 ├── Enqueue analyze-flags job with runOrigin: 'CLINICIAN_RE_ANALYZE'
                 │
                 ▼
                 Worker:
                   ├── Compute per-section content hash now
                   ├── For each section:
                   │     - hashNow === priorHash → SKIP (preserve flag set as-is)
                   │     - hashNow !== priorHash → run Haiku → carry-forward + create
                   ├── Bump Note.flagAnalysisRunCount = 2
                   ├── Stamp Note.flagAnalysisSectionHashes = { fresh hashes }
                   └── Audit: FLAGS_RE_ANALYZED + FLAGS_CARRIED_FORWARD per row
                 │
                 ▼
                 Re-analyze button hidden permanently.
                 Note is "analysis-locked"; remaining path is Resolve → Sign.
```

### State machine additions

`NoteStatus` enum: **no change.** `DRAFTING` covers both Sonnet section generation and the inline Haiku run #1 (rule 2 compliant — no enum churn).

`Note` columns added:
- `flagAnalysisRunCount Int @default(0)` — bumped by both the inline run #1 and the re-analyze route. Cap at 2 enforced at the route + worker.
- `flagAnalysisSectionHashes Json?` — `{ [sectionId: string]: sha256_hex }`. Snapshot of section content at the end of each run. Powers the diff skip on run #2 AND the edited-since-analysis check at sign.

`ReviewFlag` column added:
- `claimSignature String?` — `sha256(sectionId + '|' + normalize(claim))` where `normalize = lowercase → collapse whitespace → strip punctuation`. Nullable to keep the migration additive; new writes always set it; existing rows backfill via a one-shot stamp inside the migration's `UPDATE` (cheap — flag rows are O(thousands) not O(millions)).

### Decision-memory algorithm (per section, on every run except the inline one's first-ever stamp)

```
for each new_flag from Haiku:
   sig = signature(sectionId, new_flag.claim)
   prior = first(RESOLVED|DISMISSED flag on this note with claimSignature === sig)
   if prior exists:
      create new flag row with:
         status            = prior.status              # RESOLVED or DISMISSED
         resolutionAction  = 'CARRIED_FORWARD'
         resolutionNote    = "Suppressed: clinician " + prior.status + " an equivalent claim on " + prior.resolvedAt.date
         resolvedAt        = now
         resolvedByUserId  = prior.resolvedByUserId   # honor the original deciding clinician
      audit: FLAGS_CARRIED_FORWARD { newFlagId, priorFlagId, sig }
   else:
      create new flag row with default OPEN flow
```

This preserves the auditor's "what did the LLM emit vs. what did the system honor?" reconstruction: every carry-forward leaves an explicit row + audit pair.

### Diff-skip algorithm (run #2 only; the inline run #1 always analyzes every populated section)

```
priorHashes = note.flagAnalysisSectionHashes ?? {}
for each section:
   if !content.trim() → continue
   currentHash = sha256(content)
   if priorHashes[section.id] === currentHash:
      audit: FLAGS_SECTION_SKIPPED_UNCHANGED { sectionId, hash: currentHash }
      continue
   else:
      run Haiku + carry-forward + delete-OPEN+create
   newHashes[section.id] = currentHash
note.flagAnalysisSectionHashes = newHashes
```

### Edited-since-analysis check (sign route)

```
priorHashes = note.flagAnalysisSectionHashes ?? {}
currentHashes = sectionIds.map(id => [id, sha256(draftJson[id].content ?? '')]).fromEntries()
edited = any(priorHashes[id] !== currentHashes[id])
if edited AND !body.editedSinceAnalysisAttested:
   return 409 edited_since_analysis_unattested {
      editedSectionIds: [...],
      message: "You've edited since the last AI analysis. Re-analyze or confirm to sign as-is."
   }
if edited AND body.editedSinceAnalysisAttested:
   audit: NOTE_SIGNED_WITH_EDITED_SINCE_ANALYSIS_ATTESTATION { editedSectionIds }
   (proceed to sign)
```

Notes:
- If `priorHashes` is null (pre-deploy notes that never carried hashes), the gate is a no-op — backward compatible.
- The attestation is **not** a substitute for resolving open RED flags; the existing RED-block gate runs first.
- The check is the SAME hash-set used for the diff-skip, so the two semantics are guaranteed consistent.

## Schema diff

```prisma
model Note {
  // ... existing fields ...
  flagAnalysisStartedAt        DateTime?  // existing (Sprint 0 hardening)
  flagAnalysisCompletedAt      DateTime?  // existing
  flagAnalysisRunCount         Int        @default(0)   // NEW
  flagAnalysisSectionHashes    Json?                    // NEW: { [sectionId]: sha256_hex }
}

model ReviewFlag {
  // ... existing fields ...
  claimSignature   String?            // NEW: sha256(sectionId + '|' + normalized(claim))

  @@index([noteId, claimSignature])   // NEW: powers the carry-forward lookup
}

// ResolutionAction string convention extended (no enum — already free-form string):
//   ACCEPT_EDIT | DISMISS_KEEP | AUTO_VERIFIED | CARRIED_FORWARD   // NEW value
```

Migration file: `prisma/migrations/20260529000000_flag_analysis_lockdown/migration.sql`.

Backfill SQL inside the migration:
```sql
-- claimSignature backfill for existing flags (so re-analyze can carry forward
-- decisions made before this migration shipped).
UPDATE "ReviewFlag"
SET "claimSignature" = encode(
  digest(
    "sectionId" || '|' || regexp_replace(lower("claim"), '[^a-z0-9\s]', '', 'g'),
    'sha256'
  ),
  'hex'
)
WHERE "claimSignature" IS NULL;
```

(Requires `pgcrypto` extension; already enabled in dev. Worker-side code is the canonical signature implementation — the SQL backfill is best-effort and a divergence between SQL and TS normalize is non-fatal because the worker recomputes on every read.)

## Implementation

### Files touched

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add 3 columns + 1 index. |
| `prisma/migrations/20260529000000_flag_analysis_lockdown/migration.sql` | New migration with backfill. |
| `src/lib/notes/flag-analysis-state.ts` | Add `signatureFor(sectionId, claim)` + `hashSectionContent(content)` + `computeSectionHashes(draftJson, sections)` + `hasEditsSinceLastAnalysis(priorHashes, currentHashes)` pure helpers. |
| `src/lib/audit/actions.ts` | Add 5 new actions to the union: `FLAGS_AUTO_ANALYZED_ON_DRAFT`, `FLAGS_AUTO_ANALYSIS_FAILED`, `FLAGS_RE_ANALYZED`, `FLAGS_CARRIED_FORWARD`, `FLAGS_SECTION_SKIPPED_UNCHANGED`, `FLAGS_ANALYSIS_CAP_REACHED`, `NOTE_SIGNED_WITH_EDITED_SINCE_ANALYSIS_ATTESTATION`. |
| `src/services/review/FlagAnalyzer.ts` | `model: 'sonnet'` → `model: 'haiku'`. Surface name unchanged. |
| `src/workers/ai-generation/handler.ts` | After section loop completes (in both the empty-transcript and the normal paths), BEFORE flipping `status = DRAFT`, call `runFlagAnalysisInline(noteId, orgId, { runOrigin: 'AUTO_ON_DRAFT' })`. Failure is caught + audited + sets status to DRAFT regardless. |
| `src/workers/ai-generation/analyze-flags-handler.ts` | (1) Accept optional `runOrigin: 'CLINICIAN_RE_ANALYZE' \| 'AUTO_ON_DRAFT'`; (2) bump `flagAnalysisRunCount` in `finally`; (3) compute + apply diff-skip on `CLINICIAN_RE_ANALYZE`; (4) stamp `flagAnalysisSectionHashes` at end; (5) carry-forward branch before each create. Extract into `runFlagAnalysisCore(deps)` so `handler.ts` can call the inline path without going through BullMQ. |
| `src/app/api/notes/[id]/analyze-flags/route.ts` | Refuse 409 `analysis_cap_reached` when `runCount >= 2`. Audit `FLAGS_ANALYSIS_CAP_REACHED`. |
| `src/app/api/notes/[id]/sign/route.ts` | (1) Accept optional `editedSinceAnalysisAttested: boolean` on body schema; (2) compute edited-since-analysis gate after the existing flag-analysis-pending + RED gates; (3) audit attestation when honored. |
| `src/app/(clinical)/review/[noteId]/_components/flag-review-panel.tsx` | (1) Hide `Re-analyze` when `runCount >= 2`; (2) "Final analysis used — resolve remaining flags or sign." badge near the panel header when `runCount === 2`; (3) "Carried forward from prior analysis" affordance on rows where `resolutionAction === 'CARRIED_FORWARD'`. |
| `src/app/(clinical)/sign/[noteId]/_components/sign-client.tsx` | When sign returns 409 `edited_since_analysis_unattested`, surface an inline `AlertDialog`-confirmed checkbox ("I've reviewed my edits since the last analysis and accept them without re-analysis"); on confirm, re-POST sign with `editedSinceAnalysisAttested: true`. |
| `src/app/api/notes/[id]/flags/route.ts` | `meta` payload extended with `{ runCount, runsRemaining, canReanalyze, lastAnalyzedAt, editedSinceLastAnalysis }` so the panel + sign client read one source of truth. |
| `test/api/analyze-flags-cap.test.ts` | New — cap enforcement at the route. |
| `test/lib/flag-analysis-state.test.ts` | New — signature + hash + edits-detection unit tests. |
| `test/workers/analyze-flags-carry-forward.test.ts` | New — carry-forward branch + diff-skip branch + pipeline-chained run #1 + runCount bump in finally. |
| `test/api/sign-route-edited-since-analysis.test.ts` | New — 409 without attestation; succeeds with attestation; audit row written. |

### Edge cases handled

1. **Pre-deploy notes (runCount = 0).** First click of `Analyze for flags` consumes run #1 normally. Subsequent re-analyzes follow the new cap.
2. **Inline run #1 throws (Bedrock outage).** `handler.ts` catches, audits `FLAGS_AUTO_ANALYSIS_FAILED`, sets `flagAnalysisCompletedAt = now`, stamps `flagAnalysisRunCount = 1` (consumed), flips to `DRAFT`. Clinician sees the "Flag analysis unavailable" banner and the `Re-analyze` button is still available (run #2 budget intact).
3. **Sonnet draft generation fails for a section but succeeds for others.** Existing behavior unchanged — failed section has `status: 'failed'` in `_sectionStatus`. The inline analyzer skips empty/failed sections (it already does — `content?.trim()` check at handler.ts:107). Hash for failed sections is empty string; re-analyze won't pick them up either.
4. **Clinician resolves a flag on run #1, edits its section, re-analyzes on run #2, LLM emits a new claim with a different signature.** Treated as a new finding — gets an OPEN row. Decision memory only fires on exact-signature match. This is correct: if the clinician's edit produced a new compliance risk, it should surface.
5. **Clinician dismisses a RED flag (`status: 'DISMISSED'`), edits the section, re-analyzes.** Same as #4 — new claim signature = new flag. The prior dismissal is preserved historically but doesn't auto-suppress a structurally-different finding.
6. **Clinician runs re-analyze immediately without any edits.** Diff-skip skips every section. Worker stamps `runCount = 2` + same hashes. UI flips to locked. Net effect: cap is honored; no LLM tokens spent. This is intentional — clicking re-analyze with no edits is a no-op semantically AND now operationally.
7. **Sign route gets the attestation tick but no actual edits happened (hashes match).** The attestation is silently dropped (no audit row written) — the gate was a no-op for this request.
8. **Two re-analyze requests race (clinician double-clicks button).** BullMQ jobId includes `requestId` → second is collapsed. If two distinct requestIds slip through: the worker's `finally` runCount bump uses `{ increment: 1 }`, so the second run would push count to 3 → route refuses subsequent POSTs even more strictly. UI button is disabled during pending — minimal real-world risk.

## Dependencies

- Unit 14 (`flag-review-panel.tsx`, `analyze-flags-handler.ts`, `FlagAnalyzer.ts`, `/flags` + `/analyze-flags` routes) — modifying.
- Sprint 0 hardening (`flag-analysis-state.ts` lifecycle helpers, sign-route `flag_analysis_pending` gate) — extending.
- LLM abstraction `model: 'haiku'` switch in `bedrock.ts` — already wired (depends on `BEDROCK_FAST_MODEL_ID` env). In stub mode both `sonnet` and `haiku` return `{ stub: true }` which the analyzer coerces to `{ flags: [] }` — dev flow unaffected.
- `pgcrypto` extension for the SQL backfill — verified present in dev DB.

## Verify when done

### Functional

- [ ] After finishing a recording, the `/review` page renders WITH flags already loaded (no longer requires the clinician to click `Analyze`).
- [ ] `FlagReviewPanel` shows the `Re-analyze` button on first land (runCount = 1), and shows "Final analysis used" with the button hidden after run #2 completes.
- [ ] Clicking `Re-analyze` on a note where the clinician resolved a flag in run #1 does NOT re-surface that finding (decision memory works on exact-signature match).
- [ ] Clicking `Re-analyze` on a note where the clinician didn't edit anything produces no LLM calls (diff-skip works).
- [ ] Signing a note without edits succeeds without the attestation gate firing.
- [ ] Editing prose and immediately clicking Sign returns 409 `edited_since_analysis_unattested` with the list of edited section ids; the sign client surfaces the attestation checkbox; ticking it + retrying signs successfully and writes the `NOTE_SIGNED_WITH_EDITED_SINCE_ANALYSIS_ATTESTATION` audit row.
- [ ] Forcing the analyzer to throw (e.g., `throw new Error('test')` inside the worker temporarily) results in: status flips to DRAFT, banner shows "Flag analysis unavailable", `Re-analyze` budget shows 1 run remaining.

### Tests

- [ ] `test/lib/flag-analysis-state.test.ts` — signature normalization (case / whitespace / punctuation invariant), hash determinism, edits-detection true/false matrix.
- [ ] `test/workers/analyze-flags-carry-forward.test.ts` — verifies a RESOLVED row with matching signature on run #1 causes run #2 to write the new row already RESOLVED with `resolutionAction = 'CARRIED_FORWARD'`; unchanged sections are skipped; runCount finalizes at 2.
- [ ] `test/api/analyze-flags-cap.test.ts` — third POST returns 409 `analysis_cap_reached` and writes `FLAGS_ANALYSIS_CAP_REACHED` audit row.
- [ ] `test/api/sign-route-edited-since-analysis.test.ts` — sign refuses 409 when hashes mismatch + no attestation; succeeds + audits when attested.
- [ ] Existing `analyze-flags-handler.test.ts` (if present) continues to pass; sign-race tests still pass.
- [ ] `npm run typecheck` clean; `npx vitest run` all green; lint on touched files clean.

### Three-lens evaluation

- **Clinician** — One predictable workflow: review → optionally fix → sign. At most one extra re-analysis. Same-finding never resurfaces after resolution. Edits made without re-running analysis are gated by an explicit attestation tap (not silent), preserving the clinician's autonomy without removing the safety check.
- **Medicare compliance** — Note compliance posture at sign time is the audited posture, and every step of getting there is recorded: inline pipeline run, optional re-analyze, every carried-forward decision, the cap-reached event, and the edited-since-analysis attestation. RED-resolution requirement preserved; no path to sign past unresolved RED flags.
- **Insurance auditor** — Provenance fully reconstructible. Each `ReviewFlag` row has `claimSignature` to link it to prior decisions. `CARRIED_FORWARD` rows reference the prior `resolvedByUserId` so authorship survives. Section content hashes at run time + at sign time + edit-since attestation audit row let an auditor prove what the clinician saw vs. what they signed.

## Out of scope (deliberate)

- **Section-level lock** ("once a section's flags are all resolved, never re-analyze it"). Considered and rejected (Option 4 from the design discussion): hides genuinely-new findings after later edits, and breaks the diff-skip's promise of "what's preserved is what's unchanged." Decision memory + diff-skip cover the legitimate use cases.
- **Owner / admin override on the cap.** The cap is hard. If a clinician genuinely needs a third look, the path is to resolve or dismiss the remaining flags with a written resolution note (which IS audited) — not to add an authority surface.
- **Embedding-based signature similarity.** Lexical normalize + sha256 covers the common LLM re-wording cases. Embedding similarity would catch deep paraphrases but adds a vector dependency + a confidence threshold the auditor would have to defend. Reconsider only if we see real-world false-negatives where the same claim escapes signature match.
- **Prompt-side determinism work** (structured outputs API, constrained decoding). Separate effort; orthogonal to this spec. Temperature is already 0.
- **Migrating to a new `ANALYZING` NoteStatus enum value.** Rule 2 allows append-only enum changes, but the surface is small enough that overloading `DRAFTING` is cleaner. Reconsider if a future surface needs to distinguish the two phases for routing.
