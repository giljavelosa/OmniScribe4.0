# Journey 04 — Section Regenerate

> **Sprint 0.20 — MFA removed.** Any reference to MFA, /mfa-challenge, /mfa-setup, TOTP, authenticator app setup, or login-verified gates in this document is HISTORICAL. Authentication is now password-only. See `context/specs/01-foundation-auth-tenant.md` and `progress-tracker.md`.


> The clinician spots a section that's wrong and fixes it without losing the rest of their work. This is a small journey but it's where trust is built — or lost — on whether the AI behaves like a tool, not a tyrant.

## Who

**Dr. Tariq Hassan**, internal medicine, 7-clinician primary care practice in Boston. Mid-day clinic. He's just finished recording a 22-minute visit with a complex patient (Susan, 71F, multiple chronic conditions). He's on the review screen.

## The journey at a glance

Tariq reads the Plan section and it's wrong — the AI captured the wrong dose for a medication change. He regenerates just that section, lasting < 10 seconds, without touching his already-edited Assessment. He signs.

## The journey, step by step

### Step 1 — Review screen, 11:14 AM

**Screen: `/review/[noteId]`**. Tariq scrolls through the sections:

- **Subjective** (`● populated`) — fine
- **Objective** (`● populated`) — vitals look right
- **Assessment** (`✏ edited`) — he edited 30 seconds ago to add reasoning about CKD progression
- **Plan** (`● populated`) — reads:
  > "Continue metformin 500 mg twice daily. Increase lisinopril to 20 mg daily. Add atorvastatin 40 mg daily. Recheck A1c in 3 months."

Tariq stops. He raised the lisinopril to **10 mg**, not 20. He remembers saying "ten" three times during the visit. The AI heard "twenty." This needs fixing.

### Step 2 — Decide: edit or regenerate?

Two options:
- **Edit inline** — click into the Plan section, change "20 mg" to "10 mg." Done in 5 seconds.
- **Regenerate** — tap the regenerate button on the Plan section. AI re-reads the full transcript for just the Plan and rewrites.

For a single number, **edit inline** is faster. Tariq picks that.

But the AI also wrote "Add atorvastatin 40 mg" — and Tariq doesn't remember discussing atorvastatin at all. Did he mention it? Did the AI hallucinate? He's not sure. **This is where regenerate matters** — he wants a fresh look at the Plan from transcript, not a guess about what he meant.

He taps the **Regenerate** button on the Plan section's header.

### Step 3 — Confirmation (if needed)

The Plan section status is `● populated` (not `✏ edited`). So no confirmation needed — regenerate fires immediately.

If the section had been `✏ edited` (which Assessment is), tapping Regenerate would have opened a `<SectionRegenerateConfirmDialog>`:

> **Overwrite your edits?**
>
> You've already edited the Plan section. Regenerating will replace your changes with new AI output.
>
> [Cancel] [Yes, regenerate]

Tariq sees no dialog (Plan isn't edited) and the section status changes:

```
○ Subjective ●   ⟳ Objective ●   ✏ Assessment ✏   ⟳ Plan ⟳   ○ Education ●
populated         populated         edited            generating  populated
```

The Plan section's content area replaces with a `<ProcessingIndicator>` (the 3-gear spinner) and the section header shows "regenerating…"

**Behind the scenes**:
- Client POSTs `/api/notes/[noteId]/regenerate-section` with `{ sectionId: 'plan', requestId: <uuid> }`.
- Server enqueues a `regenerate-section` job on the **same** `ai-generation` queue (anti-regression rule 18 — no second queue, no second worker fleet). `jobId: regenerate-section:{noteId}:plan:{requestId}` for idempotency.
- Worker loads the full `transcriptClean`, loads the template's Plan section schema, composes a Plan-only prompt, streams the result.
- `Note.draftJson['plan']` is replaced **atomically** with the new section. **No other section is touched.** Tariq's `✏ edited` Assessment stays exactly as he left it.
- `_sectionStatus['plan'].status: 'generating' → 'populated'`, `lastGeneratedAt: now()`.
- SSE event `section.completed` for `'plan'` fires; client re-renders.
- Audit: `SECTION_REGENERATED` with `noteId`, `sectionId: 'plan'`, `overwroteEdited: false`, `triggeredByUserId`.

About 8 seconds later, the section re-renders:

```
Plan
─────
• Continue metformin 500 mg twice daily.
• Increase lisinopril from 5 mg to 10 mg daily.
• A1c recheck in 3 months.
```

No atorvastatin. Tariq listens — yes, the original AI was wrong about atorvastatin. He didn't mention it. Good catch.

Tariq notices the new draft says "Increase lisinopril from 5 mg to 10 mg daily" — which is correct (he did say "from five to ten"). The first draft's "20 mg" was a Soniox transcription error or a Bedrock interpretation error; the second pass got it right.

### Step 4 — Verify Assessment still has his edits

Tariq scrolls up. The Assessment section still has his CKD-progression paragraph. `✏ edited` badge still shows. **His work was preserved.** This is the rule the regenerate behavior protects.

### Step 5 — Sign, 11:16 AM

He scrolls to bottom. Open-follow-ups from last visit are addressed (Met / Carry as appropriate). He taps **Sign Note**, MFA challenges him, he signs.

Total time on this regenerate exchange: ~30 seconds (read → decide → tap → wait 8 seconds → confirm → keep going).

---

## What just happened — behind the scenes summary

| Step | User action | Data state | Audit log |
|---|---|---|---|
| 1 | Identify wrong section | (none) | (none) |
| 2 | Tap regenerate button | Client POST `/api/notes/[id]/regenerate-section` with `requestId` | (request received; no audit yet) |
| 3 | (Optional) Confirm overwrite | Dialog only if `_sectionStatus[sectionId].status === 'edited'` | `SECTION_REGENERATE_REQUESTED` with `overwroteEdited` flag |
| 4 | Worker runs | `_sectionStatus[sectionId].status: generating`; section content cleared; `<ProcessingIndicator>` renders | `SECTION_REGENERATION_STARTED` |
| 5 | Worker writes new section | `Note.draftJson[sectionId]` replaced atomically; `_sectionStatus[sectionId].status: populated`, `lastGeneratedAt: now()`; SSE `section.completed` fires | `SECTION_REGENERATED` with model, latency, tokens |
| 6 | Sign | Per Journey 02 | `NOTE_SIGNED` |

## What makes this work (build-team mental model)

**Atomic section write.** The regenerate-section worker replaces *only* one path in `Note.draftJson`, leaving all other sections untouched. Code-wise: `await prisma.note.update({ where: { id }, data: { draftJson: { ...note.draftJson, [sectionId]: newContent } } })` — JSON merge, NOT full replacement.

**Same queue, not a new one.** This is rule 18 in disguise. A "regenerate-section" feature naïvely suggests "let's have a `section-regeneration` queue." That's a second worker fleet against Redis. Quota cap doubled; production breaks. Discriminate on `job.data.type` instead — same queue, same fleet.

**Stable jobId for idempotency.** `regenerate-section:{noteId}:{sectionId}:{requestId}` — if the user double-taps, the second job is deduped. The `requestId` comes from the client (UUID generated on tap); idempotent even if the network is flaky.

**Edited-confirmation dialog is a guard, not a barrier.** It exists because clinicians make typos and don't realize they edited; if they're certain, one tap and they're through. If they're unsure, they pause. The dialog *trusts* the clinician — it doesn't shame them.

**Provenance: the section knows it was regenerated.** `_sectionStatus[sectionId].lastGeneratedAt` updates; `Note.inferenceLog.regenerations` appends an entry with `triggeredByUserId`, `at`, `requestId`, `overwroteEdited`. The auditor can reconstruct: this section was generated at T1, regenerated at T2 (no edit between), final state at T3.

## The status badge legend (so build team gets the visual model)

| Glyph | Status | Meaning |
|---|---|---|
| `○` | `empty` | No content yet (rare; means generation hasn't started for this section) |
| `⟳` | `generating` | LLM is writing (spinner; regenerate button disabled — prevents double-fire) |
| `●` | `populated` | Content complete; not yet edited by clinician |
| `✏` | `edited` | Clinician edited after population; regenerate prompts for confirmation |
| `⚠` | `failed` | LLM failed; regenerate available without confirmation (the failure was unintentional) |

## Edge cases this journey handles

- **User double-taps regenerate.** First tap fires; second is deduped via `jobId`. UI disables the button while `generating` to make this rare.
- **Worker fails mid-regeneration.** `_sectionStatus[sectionId].status: failed`, error message captured. Regenerate button is enabled again (no confirmation needed for failed sections). Retry policy on the queue handles transient failures automatically (3 retries, exp backoff).
- **Network drops between SSE events.** Client polls `/api/notes/[id]/stream?include=sections` and reconnects automatically; section status syncs to server state on reconnect.
- **Clinician regenerates a section, then immediately edits the new content.** Status: `populated → edited` per usual. Second regenerate would prompt for confirmation again. No special handling.
- **Clinician regenerates an `edited` section after confirming.** New content fully replaces the edit. Audit log captures `overwroteEdited: true` and the previous edit's content is **not** preserved in `draftJson` (it's gone). The transcript is the durable source; the section can always be regenerated again from transcript.
- **Two clinicians have the review page open simultaneously** (e.g., supervisor + trainee). Last-writer-wins on edits; regenerate by either user fires the same way. v1 doesn't have real-time co-editing (explicitly out of scope per `project-overview.md`); the data model is single-author.
- **The clinician regenerates the *only* required section that's edited, and they want to sign without that edit.** No special handling — the regenerated content stands; clinician can edit again if needed. Sign readiness only checks "is the section populated," not "is the section's content acceptable" — that's the clinician's judgment.

## Three-lens evaluation

**Clinician** — Regenerate is one tap. Edited content is protected by confirmation. The clinician stays in control. The AI is a tool, not a manager.

**Medicare Compliance Officer** — The section regenerate doesn't undermine signature integrity (sign happens AFTER all regenerations are done; `finalJson` is frozen at sign). Audit captures who triggered which regeneration when.

**Insurance Auditor** — Every regeneration is logged with `requestId`, `triggeredByUserId`, `overwroteEdited`, `at`. The note's full edit + regeneration history can be reconstructed from `inferenceLog.regenerations` + `AuditLog` queries.

## Build-team checklist for "this journey works"

- [ ] `<SectionProgressCell>` renders the correct glyph per status (`○ ⟳ ● ✏ ⚠`).
- [ ] Regenerate button: disabled during `generating`; opens confirm dialog if `edited`; fires immediately for `empty / populated / failed`.
- [ ] `<SectionRegenerateConfirmDialog>` uses `<AlertDialog>` from the design system — never native `confirm()`.
- [ ] Job uses the `ai-generation` queue with `type: 'regenerate-section'` discriminator — not a new queue.
- [ ] Stable jobId `regenerate-section:{noteId}:{sectionId}:{requestId}` — double-tap is deduped.
- [ ] Worker replaces **only** the specified path in `draftJson` atomically; other sections untouched (regression test).
- [ ] `_sectionStatus[sectionId].lastGeneratedAt` updated on every regeneration.
- [ ] `Note.inferenceLog.regenerations` appends an entry on every regeneration with required fields.
- [ ] Audit log: `SECTION_REGENERATE_REQUESTED`, `SECTION_REGENERATION_STARTED`, `SECTION_REGENERATED` — all PHI-free metadata.
- [ ] SSE event `section.completed` fires for the regenerated section.
- [ ] 3-tap test: from review screen, regenerate one section in ≤ 1 tap (≤ 2 if confirmation dialog).
- [ ] Three-lens evaluation passes.

## Related references

- Section progress + regenerate architecture: [`references/section-progress-spec.md`](../references/section-progress-spec.md)
- Section progress UI components: [`references/section-progress-ui-spec.md`](../references/section-progress-ui-spec.md)
- Build units delivering this journey: [`context/specs/05-note-generation-and-sign.md`](../context/specs/05-note-generation-and-sign.md), [`context/specs/00-build-plan.md`](../context/specs/00-build-plan.md) Unit 10 (Section-regenerate UX maturity)
