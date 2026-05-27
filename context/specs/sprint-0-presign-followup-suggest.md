# Sprint 0.X: Pre-sign follow-up auto-suggest

> **Status:** APPROVED — design decisions locked 2026-05-24 (walkthrough with Gil).
> **Owner:** Gil
> **Spec date:** 2026-05-24
> **Depends on:** the 2026-05-23 hotfix that unblocked `FollowupExtractor` (centralized `stripJsonFence`).

## Decisions locked (2026-05-24)

| ID | Decision | Choice |
|---|---|---|
| OQ-1 | Rule 20 reconciliation | **(c) Cleo draft-tool channel, auto-triggered.** Route extraction through Cleo's draft-tool pipeline. Rule 20 amended narrowly to allow draft-tool workers to read DRAFT Plan content. |
| OQ-2 | Trigger model | **(c) Regex gate + manual button fallback.** Auto-run when `hasPlanFollowUps` regex says yes; otherwise show a "Suggest follow-ups" button as manual override. |
| OQ-3 | Plan-edit refresh | **(a) Auto-refresh as you type (debounced 5s).** Cleo follows along live. UX must handle "suggestions shifting while you type" gracefully (fade transitions, no cursor-jumping). |
| OQ-4 | Pre-sign + post-sign de-dup | **(b) Post-sign extractor runs, smart de-dup.** Use text-similarity (Jaccard ≥ 0.7) to skip rows that duplicate accepted suggestions. |
| OQ-5 | Bulk-accept | **(a) Per-row only for v1.** Each suggestion accepted individually. Bulk-accept deferred to v1.1 pending real usage data. |
| OQ-6 | Spec filing | **(a) Sprint-style filename** (this file). Matches recent cadence. |

## Problem

On `/review/[noteId]` pre-sign, the **"Follow-ups for next visit"** card is empty unless the clinician manually adds rows or uses Miss Cleo's `followup-cadence` draft tool. The card's regex helper (`hasPlanFollowUps`) ALREADY detects when the Plan text contains follow-up cues — that's why the warning banner ("No follow-up detected") is suppressed. But the system never suggests what those follow-ups should be, even when the Plan plainly contains them ("Next visit: …", "Frequency: Continue skilled PT 1-2x/week", "Reassess overhead tolerance").

The LLM-backed `FollowupExtractor` does excellent extraction — but it only runs POST-SIGN, populating `FollowUp` rows visible to the **next** clinician on the next visit. By then, the moment of value has passed.

This violates the Miss Cleo philosophy (`memory/miss-cleo-philosophy.md`): *"surface her outputs at the moment of use, don't band-aid around them."* The moment of use is /review pre-sign.

## Three-lens framing

- **Clinician:** I see follow-up commitments in my Plan; the card below already knows the Plan has them; suggest them and let me triage in seconds. Don't make me type what I just wrote one paragraph up.
- **Medicare compliance:** Follow-up plans (frequency, reassessment criteria, progression triggers) are medical-necessity evidence. Pre-staging them with explicit clinician confirmation strengthens — not weakens — the record. AI is data, not recommendation.
- **Insurance auditor:** Each PROPOSED row must trace to a Plan text excerpt + AI model + timestamp + clinician disposition (accepted / edited / dropped). Provenance must survive sign.

## Design

### Lifecycle

```
  /review loads → regex gate (hasPlanFollowUps) → yes? → enqueue Cleo draft-tool job
                                                  no?  → show "Suggest follow-ups" button (manual override)
       ↓
  Cleo draft-tool worker reads DRAFT Plan → FollowUp(status=PROPOSED) rows written
       ↓
  /review card renders PROPOSED rows under "Suggested by Miss Cleo"
       ↓
  Plan edit (debounced 5s) → re-run Cleo (OQ-3) → suggestions update in-place via fade
       ↓
  Clinician triages:  accept → OPEN     edit+accept → OPEN     drop → DROPPED
       ↓
  Sign:
    - PROPOSED rows that were accepted (already OPEN) → unchanged
    - PROPOSED rows still PROPOSED at sign-time → auto-DROPPED with reason "unreviewed_at_sign"
    - Manually-added OPEN rows → unchanged
    - Post-sign FollowupExtractor STILL runs (rule: extractor authoritative on signed Plan).
      Each new finding is Jaccard-compared (≥ 0.7) against existing OPEN rows for this note;
      duplicates skipped, genuinely-new rows created.
```

### Schema diff

```prisma
enum FollowUpStatus {
  PROPOSED              // NEW — pre-sign suggestion awaiting clinician triage
  OPEN
  MET
  CARRIED
  DROPPED
  CLOSED_BY_DISCHARGE
}

// FollowUp model: append two fields
model FollowUp {
  // ...existing fields...
  proposedSourceText  String?  @db.Text   // ~200-char Plan excerpt the extractor matched
  proposedExtractorVersion String?         // e.g. "followup-extractor-v1"
  proposedFromHash    String?              // sha256(planContent) at extraction time
  proposedDroppedReason String? // 'unreviewed_at_sign' | 'clinician_dropped' (existing dropReason re-used)
}
```

Anti-regression: Rule 2 (NoteStatus append-only) is about NoteStatus; FollowUpStatus is not under that rule but we honor the same discipline — append only. Existing rows untouched. `npx prisma db seed` must pass.

### Worker (Cleo draft-tool channel)

`src/services/copilot/draft-tools.ts` — extend with a new draft-tool kind `presign-followup-suggest`. Routes through `DRAFT_TOOL_NAMES` so the existing Cleo audit trail (`COPILOT_DRAFT_PROPOSED` etc.) captures every run. This is the OQ-1(c) decision: pre-sign extraction is "Cleo proposing drafts," not a fresh worker.

- **Trigger paths (OQ-2 + OQ-3 combined):**
  1. **/review first mount**: client checks `planHasFollowUps(planContent)`. If true → POST `/api/notes/[id]/presign-followup-suggest` (no body). If false → render "Suggest follow-ups" manual button.
  2. **Plan edit (OQ-3)**: client debounces Plan-section edits 5s; on settle, recomputes `planHasFollowUps` and re-fires the POST if true. Cancels in-flight job (BullMQ jobId is stable per noteId, so it dedupes).
  3. **Manual button**: always available; calls the same endpoint regardless of regex state. Useful when the clinician knows their Plan has cues the regex didn't pick up.
- **Idempotency:** jobId = `presign-followup:{noteId}` (stable, dedup-on-noteId). Handler computes `sha256(planContent)` and stores in `proposedFromHash`. Skip work if the LATEST set of PROPOSED rows for this note has a matching hash (i.e. Plan didn't change since last run). Manual button presses bypass this hash check (user explicitly asked).
- **Skip conditions:** note.status ≠ DRAFT, finalJson absent, Plan section text < 50 chars (no signal).
- **Extraction:** reuses `FollowupExtractor.extractFromFinalJson()` exactly as the post-sign path does. Same Haiku call, same Zod-validated schema, same `{ items: [...] }` shape. The only difference is the write side: status=PROPOSED + the three new provenance fields.
- **Re-extraction superseding:** when the worker re-runs (Plan changed), it transitions all existing PROPOSED rows for this note to `DROPPED` with `dropReason: 'plan_changed_superseded'` BEFORE writing the new PROPOSED set. Accepted rows (already OPEN) are never touched. This guarantees the UI always shows ≤ one set of "Suggested by Cleo" rows, matching the current Plan.
- **Rate limit:** ≤6 extractions per note per 60s (the OQ-3 auto-refresh path can fire more often than the original 3-per-60s suggested). Returns 429 with `retryAfter`.

### UI behavior during auto-refresh (OQ-3 nuance)

Live updates while the clinician edits MUST NOT be jarring:

- **In-flight indicator:** small Cleo glyph + "thinking…" subtitle under the card header while the job is running. Disappears when results land.
- **In-place updates:** when new PROPOSED set arrives, rows that match (by text) keep their position; new rows fade in; superseded rows fade out. NO full re-render that scrolls the page.
- **Cursor protection:** the auto-refresh only fires when the clinician's focus is NOT on the follow-up card itself (intersection-observer + activeElement check). Avoids the "I'm clicking accept and the row I'm about to click just moved" failure mode.
- **Pause-on-interaction:** once the clinician has interacted with ANY proposed row (hover, focus, click), pause the 5s debounce for 30s. They're triaging — don't shuffle the deck under them.

### API endpoints

| Endpoint | Verb | Purpose |
|---|---|---|
| `/api/notes/[id]/presign-followup-suggest` | POST | Enqueue (or skip via hash) the extraction job. Optional body `{ force: true }` for manual-button presses (bypasses hash check). Returns `{ jobId, status: 'enqueued' \| 'cached' }`. |
| `/api/follow-ups/[id]/accept` | POST | PROPOSED → OPEN. Optional body `{ text: string }` for edit-then-accept (rewrites `text`, preserves `proposedSourceText`). Audit: `FOLLOWUP_PROPOSAL_ACCEPTED`. |
| `/api/follow-ups/[id]` PATCH | (existing) | Drop a proposal: `{ status: 'DROPPED', dropReason: 'clinician_dropped' }`. Audit: `FOLLOWUP_PROPOSAL_DROPPED`. |

### UI changes (`follow-ups-for-next-visit.tsx`)

- Card renders TWO list sections when PROPOSED rows exist:
  1. **Suggested by Miss Cleo** — PROPOSED rows. Each row: text, small Cleo sparkle icon, source excerpt on hover, accept (✓) / edit (pencil) / drop (×) actions. **Per-row only (OQ-5) — no "Accept all" button in v1.**
  2. **Confirmed for next visit** — OPEN rows (same UI as today). The "no follow-ups yet" message becomes the empty state ONLY when both sections are empty.
- Card never shows the OLD "No follow-up detected" warning banner if at least one PROPOSED row exists (the AI clearly picked something up).
- "Suggest follow-ups" manual button (OQ-2) — appears under the card header when `planHasFollowUps` is false AND no PROPOSED rows exist for this note. Hidden once Cleo has run at least once.
- In-flight indicator (OQ-3): "Miss Cleo is reading the Plan…" subtitle while a job is running. Auto-clears on completion.

### Sign-time hook (`/api/notes/[id]/sign`)

In the sign transaction, BEFORE the existing `enqueueNoteBriefJob`:

```ts
await tx.followUp.updateMany({
  where: { originNoteId: note.id, status: 'PROPOSED' },
  data: { status: 'DROPPED', dropReason: 'unreviewed_at_sign', closedAt: new Date() },
});
```

This guarantees unreviewed proposals never leak to the next visit. Audit log: `FOLLOWUP_PROPOSALS_AUTO_DROPPED_AT_SIGN { count }`.

### Three-lens audit fields

`FOLLOWUP_PROPOSAL_PROPOSED` metadata: `{ noteId, proposalCount, extractorVersion, planHash, latencyMs, model, stub }`.
`FOLLOWUP_PROPOSAL_ACCEPTED` metadata: `{ noteId, edited: boolean, originalText, finalText }`.

## Decision rationale (for future agents)

Full deliberation lives in the 2026-05-24 walkthrough conversation. Summary of why each choice landed where it did:

- **OQ-1 (c) — Cleo draft-tool channel, auto-triggered.** Honors the Miss Cleo philosophy ("copilot is protagonist") literally — Cleo IS the actor, not a generic worker. Reuses the existing draft-tool audit trail (`COPILOT_DRAFT_PROPOSED` / `COPILOT_DRAFT_CONFIRMED` / `COPILOT_DRAFT_DISCARDED`) so no new audit machinery. Rule 20 amendment is the narrowest possible carve-out: "draft-tool workers may read DRAFT Plan content; outputs are non-binding PROPOSED until clinician confirmation."

- **OQ-2 (c) — Regex gate + manual button.** Cheap regex (`hasPlanFollowUps`) is free and almost-always-right; we use it as the auto-trigger gate. Manual button is the safety valve when the regex misses a subtle cue (e.g. "Watch how she does over the weekend").

- **OQ-3 (a) — Auto-refresh as you type (debounced 5s).** Most aggressive UX choice in the spec, deliberately taken to make Cleo a real-time partner rather than a one-shot suggester. UX safeguards (in-place update, cursor protection, pause-on-interaction) are non-negotiable — see the "UI behavior during auto-refresh" section.

- **OQ-4 (b) — Post-sign extractor still runs, Jaccard ≥ 0.7 de-dup.** Post-sign extraction is the audit-grade authoritative pass; we cannot skip it without weakening the audit story. Smart de-dup keeps duplicate noise off the next visit's /review.

- **OQ-5 (a) — Per-row accept only, v1.** Every accepted follow-up should be an individual clinical decision. Bulk-accept rewards speed over carefulness, which is the wrong trade for clinical AI. Revisit at v1.1 with usage data.

- **OQ-6 (a) — Sprint-style filename.** Matches Sprint 0.10–0.18 cadence; this is a focused single-subsystem improvement, not an architectural Unit.

## Verify when done

- [ ] Empty card on /review (regex false): no auto-run; "Suggest follow-ups" button visible.
- [ ] Plan has cues (regex true): Cleo runs automatically → PROPOSED rows render under "Suggested by Miss Cleo" → clinician can accept (✓) / edit (pencil) / drop (×) each.
- [ ] Plan edited mid-review: 5s debounce → re-run → in-place fade transitions, no scroll jump, no cursor jump.
- [ ] Pause-on-interaction: clinician hovers/focuses a row → debounce paused 30s → no auto-refresh during triage.
- [ ] Sign with unreviewed PROPOSED rows → all auto-DROPPED with `dropReason: 'unreviewed_at_sign'`; audit log written.
- [ ] Sign with mix of accepted (OPEN) + unreviewed (PROPOSED) → only OPEN survives; post-sign extractor runs; Jaccard ≥ 0.7 against OPEN skips duplicates.
- [ ] Audit log carries the full provenance chain for each PROPOSED → ACCEPTED row (origin Plan excerpt + extractor version + clinician + timestamp). Cleo draft-tool audit actions used (`COPILOT_DRAFT_PROPOSED`, `COPILOT_DRAFT_CONFIRMED`, `COPILOT_DRAFT_DISCARDED`).
- [ ] Rule 20 amendment to `context/architecture.md` lands in the same PR (narrow carve-out: "draft-tool workers may read DRAFT Plan").
- [ ] Three-lens block in the PR description: clinician (3-tap), Medicare compliance (necessity strengthened), auditor (provenance traceable).
- [ ] BullMQ retry: 3× exponential per rule 10.
- [ ] No `confirm()`/`alert()` (rule 22) — accept/drop/edit confirmations use `<AlertDialog>`.

## Out of scope (v1)

- Bulk-accept UI (deferred to v1.1).
- Telehealth-specific Plan structures (handled by Unit 48's intent-aware brief pipeline once a follow-up–extraction sibling is added).
- Patient-facing follow-up surfaces (existing AVS workstream owns).
- FHIR write-back of follow-ups (Unit 24 owns Condition; CarePlan write-back is separate).
- Edit-history audit of the proposed text → final-accepted text (single-version `text` field for v1; if compliance demands the diff, add `proposedOriginalText` later).
