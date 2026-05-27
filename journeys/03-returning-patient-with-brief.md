# Journey 03 — Returning Patient + Prior-Context Brief + Copilot Watch

> **Sprint 0.20 — MFA removed.** Any reference to MFA, /mfa-challenge, /mfa-setup, TOTP, authenticator app setup, or login-verified gates in this document is HISTORICAL. Authentication is now password-only. See `context/specs/01-foundation-auth-tenant.md` and `progress-tracker.md`.


> The 30-second-card experience. This is the journey that converts OmniScribe from "scribe" to "copilot." Read after Journey 02.

## Who

**Dr. Lena Park**, physical therapist, working in a 12-clinician multi-discipline rehab clinic in Austin. Her patient today is **Maria González**, 68F, mid-episode for a right-shoulder rehab program (4 weeks into a 6-week protocol after a fall in February). Maria was last seen 6 days ago by **Dr. Smith** (covering for Lena that day).

Lena hasn't seen Maria in 3 weeks. Lena would normally need 10–15 minutes pre-visit to scroll through 4 prior notes to remember where Maria is. With OmniScribe she takes 30 seconds.

## The journey at a glance

Lena walks into the room cold. By the time the patient sits down, Lena knows: where Maria is in her episode, what's been done, what's working, what Dr. Smith planned for today, and what follow-ups are open. Her interaction with Maria is grounded; her note captures the *new* clinical reasoning, not a recap of what she should have already known.

## The journey, step by step

### Step 1 — Open the prepare screen, 2:14 PM

**Screen: `/prepare/[noteId]`** (auto-created Note in `PREPARING`):

The screen renders in this exact order (top to bottom on mobile, left+right on desktop):

#### Patient identity header
```
Maria González · 68F · MRN 00472891 · DOB 1957-03-12 · Spanish-preferred · ♿ ambulatory with cane
Episode: R shoulder, week 4 of 6 (post-fall, 2026-02-08) · Authorized visits remaining: 8
```

#### Prior-context brief (`<BriefCard>`)

```
Last seen 6 days ago by Dr. Smith — Progress Note

WHY SHE'S HERE
R shoulder pain post fall, addressing ROM + scap stability + sleep posture.

LAST CLINICAL IMPRESSION
Improving — pain trending down, AROM gains in flex/abd. MMT static.

TRAJECTORY                                                ↑ improving
Pain VAS    7   →   5   →   4
Flex AROM   95° →  110° →  125°
Abd AROM    80° →  100° →  118°
MMT ER      3+/5 (unchanged ×2 visits)
ER AROM (pas) 100% — full

LAST VISIT DID
• Manual GH joint mob grade III
• Scap stability progression — band rows × 3, theraband I-Y-T × 2
• HEP updated · Sleep posture education

PLAN SAID FOR TODAY
• Progress band rows to red (next color)
• Recheck scap dyskinesis
• Address sleep complaint if still present

ACTIVE GOALS (3)
○ STG: Reduce pain VAS to ≤2 in 2 weeks (current: 4)
○ STG: Achieve 140° flex AROM in 2 weeks (current: 125°)
● LTG: Return to overhead reach for cabinet access (week 8) (on track)

WATCH
• Pt mentions sleeping on R side reawakens pain — sleep posture worth re-emphasis

OPEN FOLLOW-UPS FROM LAST VISIT (2)
□ Trial NSAID (started by primary 2/15) — confirm if still taking
□ Imaging (March 28 shoulder X-ray) — confirm reviewed
```

Every fact has a **source pill** ("from Progress Note · 2026-05-11"). The trajectory is rendered as a `<TrajectoryTable>` with arrows; the goals as `<GoalsSnapshot>`; the watch items as `<WatchList>`; the follow-ups as `<FollowUpPreviewList>`.

The brief loaded < 1 second after the page opened — it was precomputed at sign-time of Dr. Smith's note 6 days ago. Stored on `NoteBrief` (1:1 with that signed note). Retrieved via `GET /api/patients/[patientId]/brief`.

#### Copilot Watch cards (right side, alongside the brief)

`<OpenFollowUpsCard>`:
```
Open follow-ups from last visit
─────────────────────────────
○ Trial NSAID — confirm if still taking
  from Progress Note · 2026-05-11   [Met] [Drop] [Carry]

○ Imaging (March 28 shoulder X-ray) — confirm reviewed
  from Progress Note · 2026-05-11   [Met] [Drop] [Carry]
```

`<PlanForTodayCard>`:
```
Plan said for today
─────────────────────────────
• Progress band rows to red (next color)
  from Progress Note · 2026-05-11

• Recheck scap dyskinesis
  from Progress Note · 2026-05-11

• Address sleep complaint if still present
  from Progress Note · 2026-05-11
```

These cards are NOT recommendations. They are facts the prior clinician documented. The current clinician decides what to act on.

#### Setup form (below the brief on mobile; below the cards on desktop)

Template: **Rehab Progress Note** (auto-selected — Maria's episode template).
Style: **Hybrid** (Lena's default).
Division: **REHAB** (Maria's episode division).

Lena leaves it as-is.

### Step 2 — The 30 seconds, 2:14:00 → 2:14:30 PM

Lena reads the brief from top to bottom in 25 seconds. She notes:
- Maria is improving (the ↑ arrow + numbers tell her).
- Pain trending down, AROM still climbing.
- MMT static — that's worth pushing today.
- Dr. Smith planned to progress band rows to red — Lena agrees.
- Sleep complaint may still be present — she'll ask.
- 2 open follow-ups: she'll ask Maria about the NSAID; the imaging follow-up was Dr. Smith's note, not Lena's responsibility (but it's worth mentioning).

She taps **Start Recording**.

### Step 3 — The visit, 2:14:30 → 2:42 PM (28 min)

Standard recording flow per Journey 02. Lena and Maria talk, work through exercises, do hands-on therapy. Lena occasionally references the cards in the right pane — at one point she taps the **PlanForTodayCard** source pill on "Progress band rows" to confirm exactly what color they were on.

About 18 min in, Lena starts drafting. The note populates section by section.

About 26 min in, Lena addresses the follow-ups in conversation:
- NSAID: "Are you still taking the ibuprofen your primary started?" → Maria: "Yes, twice a day, helps a lot."
- Imaging: "Did you and your primary review the shoulder X-ray?" → Maria: "Yes, no fracture, just soft tissue."

Lena taps the **Met** button on the NSAID follow-up card immediately (mid-conversation feels right). She taps **Met** on the imaging follow-up too.

**Behind the scenes**: Each tap POSTs `/api/follow-ups/[id]/close` with `status: 'MET'`, `closingNoteId: <current noteId>`. The cards update optimistically; the rows in the FollowUp table get `status: 'MET'`, `closedAt: now()`, `closingNoteId: currentNoteId`. Audit: `FOLLOWUP_CLOSED × 2`.

### Step 4 — Finish & review, 2:42 → 2:46 PM

Lena taps **Finish & Review**. Transit through `/processing/[noteId]` (10 seconds). Lands on `/review/[noteId]`.

The Plan section reads:
- Continue band rows, progressed to red (5 reps × 3 sets, scapular setting cue)
- Recheck scap dyskinesis — improved, no obvious winging at rest
- Sleep posture re-emphasized (pillow setup, demonstrated)
- Continue HEP — no changes
- Next visit: progress to T-band with red, recheck flex AROM

Lena's edits today: minor tweaks to Subjective wording, no changes to Objective or Assessment. Adds one bullet to Plan: "Reassess STG flex 140° goal at week 6."

She scrolls down to the **open follow-ups** section — both prior-visit items are already shown as **Met** (closed in capture). The sign-time sweep modal won't appear.

She taps **Sign Note**, completes MFA challenge, signs.

### Step 5 — What happens next, 2:47 PM onward

Asynchronously after sign:

1. **`note-brief` worker runs** — generates Maria's new prior-context brief, computed from today's signed note + the 2 prior ones. Stored on `NoteBrief` for next visit. ~30 seconds. Audit: `BRIEF_GENERATED`.

2. **Goal progress entries written** — Lena's note mentioned MMT improved (today she actually noted it was 4-/5, up from 3+/5). The `FollowupExtractor` service (which also extracts goal progress for rehab) writes a `GoalProgressEntry` linked to today's note: `goalId: mmt-er-goal, measureValue: '4-/5', date: today`. Audit: `GOAL_PROGRESS_RECORDED`.

3. **Follow-ups extracted from today's plan** — the FollowupExtractor parses today's Plan section. Two new follow-ups extracted:
   - "Reassess STG flex 140° goal at week 6"
   - "Progress to T-band with red at next visit"
   Both written as `FollowUp` rows with `status: OPEN`, `originNoteId: currentNoteId`. Audit: `FOLLOWUP_CREATED × 2`. These will appear in next visit's brief.

4. **Post-sign artifacts** — patient instructions generated (HEP reminders, sleep posture diagram URL). No referral letter today.

### Step 6 — Three weeks later

Lena is on vacation. Her colleague **Dr. Tanaka** sees Maria for the next visit. Tanaka opens `/prepare/[noteId]` for Maria's appointment and sees the brief computed at Lena's sign-time three weeks ago:

```
Last seen 21 days ago by Dr. Park — Progress Note

WHY SHE'S HERE
R shoulder rehab, week 7 of 6+ (extended). Focus this episode: ROM + scap stability + sleep posture.

LAST CLINICAL IMPRESSION
Continuing to improve. MMT ER now 4-/5 (up from 3+/5). Sleep complaint improved with posture changes.

TRAJECTORY                                                ↑ improving
Pain VAS    7 → 5 → 4 → 3
Flex AROM   95° → 110° → 125° → 132°
MMT ER      3+/5 → 4-/5

PLAN SAID FOR TODAY
• Reassess STG flex 140° goal at week 6 (was due 3w ago — overdue)
• Progress to T-band with red

OPEN FOLLOW-UPS FROM LAST 2 VISITS (2)
□ Reassess STG flex 140° goal at week 6 (carried from 3 weeks ago)
□ Progress to T-band with red at next visit
```

Tanaka has continuity. She doesn't need to find Lena. She doesn't need to read 5 notes. The brief did the chart review. **This is the 30-second card.**

---

## What just happened — behind the scenes summary

| Event | Source | Data |
|---|---|---|
| Brief load on `/prepare` | `GET /api/patients/[id]/brief` | Returns `NoteBrief.content` (precomputed) |
| Watch cards render | Same brief query + `GET /api/patients/[id]/follow-ups?status=OPEN` | Cards consume; no extra round-trips |
| Tap source pill on brief field | Client-side route to `/review/<sourceNoteId>?section=<section>&highlight=<measureKey>` | Opens source in drawer |
| Tap "Met" on follow-up in capture | `POST /api/follow-ups/[id]/close { status: MET, closingNoteId: currentNoteId }` | `FollowUp.status → MET`, audit `FOLLOWUP_CLOSED` |
| Sign | Per Journey 02 | + enqueues `note-brief` job for next visit |
| Brief regenerated (~30s post-sign) | `note-brief` worker | `NoteBrief` upserted; visible on next `/prepare` |

## What makes this work (build-team mental model)

**Three architectural choices make the 30-second card real:**

1. **Brief is precomputed at sign, not per render.** Reading happens 100s of times; computing happens once. Costs $0.05/brief (Bedrock Sonnet 4.5, temp 0) instead of $0.05 × every clinician glance.
2. **Brief reads only signed notes** (`Note.status ∈ {SIGNED, TRANSFERRED}`). No drafts. No inferences beyond source. This is Rule 20 — the foundation of copilot trust.
3. **Source pills are clickable links to the source.** Provenance isn't a label, it's an interaction. Clinicians who don't trust the brief click through; clinicians who do trust it skip them. Either way, the data is verifiable.

The **Watch cards** (`<OpenFollowUpsCard>`, `<PlanForTodayCard>`) are a thin UI layer over the brief + FollowUp data. No new generation. No new prompts. Same trust model.

## Edge cases this journey handles

- **No prior signed notes.** Brief is empty: shows "First visit — no prior context." Cards say "No open follow-ups from prior visits" / "No carry-forward plan from prior visits."
- **Brief generation failed at last sign.** Brief shows a banner: "Couldn't generate brief from last visit — show source notes instead." Links to last 2 signed notes directly.
- **Brief is stale (>30 days since last visit).** Brief still shows but adds a staleness chip: "Last visit was 47 days ago — verify clinical relevance."
- **Patient has multiple open episodes** (e.g., one rehab + one chronic disease management). Brief is keyed to the episode of today's note. Other episodes' briefs accessible via patient detail page.
- **The "Met" closure was a mistake.** The closure can be reverted in the review screen by tapping the follow-up row and selecting a different status. Audit logs both close + revert.
- **A follow-up references a lab result the patient hasn't actually completed.** Clinician taps **Drop** with no further obligation (the original commitment was made by a prior clinician; this clinician is not responsible).
- **The brief contains a number that's wrong** (typo from prior note). Clinician taps the source pill → reads the source note → finds the typo. Brief regenerates on next sign (no manual edit of brief; brief is a derived artifact, not a primary one). Auditor sees both the wrong number in the prior brief AND the corrected one in next visit's brief.
- **Multi-division patient** (rehab + behavioral health). Brief is keyed to the episode + division of today's note; a BH visit gets a BH-flavored brief (PHQ-9 / GAD-7 trajectory; rehab brief shows ROM/strength/etc.).

## Three-lens evaluation

**Clinician** — The brief is a real thing that real clinicians use, every visit, in the field. It's grounded (every fact is sourced), respects clinical reasoning (no recommendations), and saves real minutes per patient.

**Medicare Compliance Officer** — The brief doesn't *replace* the clinician's own clinical reasoning — it *informs* it. The clinician still documents what they did, why, and the plan. Medical necessity is established in the clinician's *new* note, not in the brief.

**Insurance Auditor** — Every brief field traces to a signed source note. Every follow-up closure is logged with `closingNoteId`. The brief itself is regenerable from source (audit reconstructability).

## What this journey doesn't cover

- First-time onboarding (Journey 01)
- The recording mechanics in detail (Journey 02)
- Section regenerate when a section is off (Journey 04)
- Asking the copilot a question (Journey 05)
- The FHIR-enriched version of the brief (Wave 4; brief gets additional `<external_ehr_context>` block from FHIR cache)

## Build-team checklist for "this journey works"

- [ ] Brief precomputes < 30 seconds after sign.
- [ ] Brief loads < 1 second on `/prepare/[noteId]` (read from `NoteBrief`, no LLM call).
- [ ] Brief reads only `Note.status ∈ {SIGNED, TRANSFERRED}` (Rule 20 verified by code grep).
- [ ] Every brief field has a source pill that links to source note + section.
- [ ] Brief content schema is Zod-validated; malformed briefs are rejected (don't store, don't render).
- [ ] Brief generation falls back from Sonnet 4.5 → Haiku 4.5 on second failure; thinner brief is still valid.
- [ ] Empty / no-prior-notes / first-visit states render correctly.
- [ ] Stale brief (>30d) renders staleness chip.
- [ ] Open follow-ups can be closed (Met / Drop / Carry / Closed-by-Discharge) in capture inline, in review section, or in sign-sweep modal.
- [ ] Closing a follow-up writes audit log + updates row + propagates `closingNoteId`.
- [ ] Three-lens evaluation passes.

## Related references

- Brief data model + lifecycle: [`references/prior-context-brief-spec.md`](../references/prior-context-brief-spec.md)
- Brief LLM prompt: [`references/prior-context-brief-prompt.md`](../references/prior-context-brief-prompt.md)
- Brief UI components: [`references/prior-context-brief-ui-spec.md`](../references/prior-context-brief-ui-spec.md)
- Watch v0 cards: [`context/specs/07-encounter-copilot-watch-v0.md`](../context/specs/07-encounter-copilot-watch-v0.md)
- Copilot architecture (the why): [`references/encounter-copilot-spec.md`](../references/encounter-copilot-spec.md)
- Build units delivering this journey: [`context/specs/06-prior-context-brief.md`](../context/specs/06-prior-context-brief.md), [`context/specs/07-encounter-copilot-watch-v0.md`](../context/specs/07-encounter-copilot-watch-v0.md)
