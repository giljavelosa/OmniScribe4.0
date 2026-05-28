# Journey 02 — Typical In-Person Visit

> The heart of the product. If you understand this journey, you understand OmniScribe. Read this first.

## Who

**Dr. Maya Chen**, family medicine physician, employed at a 6-clinician primary-care clinic in Seattle. Uses OmniScribe on an iPad at the kiosk in each exam room, sometimes on her MacBook between visits. Already onboarded (Journey 01); has done ~40 visits with OmniScribe. Today is a normal clinic day, 18 patients scheduled.

## The visit at a glance

10:00 AM. Maya's next appointment is a 15-minute follow-up with **James Park**, 54M, hypertension management. James is a returning patient; the previous visit was 6 weeks ago.

By 10:18 AM — three minutes after James leaves the room — the visit's note is signed and in James's chart. Maya spent **about 4 minutes** of her own time on the documentation: 30 seconds reading the brief, 2 minutes reviewing + editing the draft, 1 minute on follow-up sweep + sign, 30 seconds on the patient-instructions printout.

Compare to her pre-OmniScribe baseline: 8–12 minutes per visit on the note, often done after hours.

## The journey, step by step

### Before the visit — 9:58 AM, kiosk in Exam Room 3

Maya walks into Exam Room 3 between patients. The iPad in the room is already signed in (she logged in this morning; her session lasts the workday). She taps the OmniScribe app.

**Screen: `/home`** — Today's schedule, with James Park's name highlighted as next.

She taps James's card.

**Screen: `/prepare/[noteId]`** — A new Note has been auto-created (status: `PREPARING`). The screen shows:

- **Patient identity header** (top): "James Park · 54M · MRN 00482719 · DOB 1972-03-15 · English"
- **Prior-context brief** (the 30-second card):
  ```
  James Park · 54M · Established patient · English-preferred
  Last seen 6 weeks ago by Dr. Chen — Office Visit

  WHY HE'S HERE
  Hypertension follow-up; medication adjustment was last visit's focus.

  LAST CLINICAL IMPRESSION
  BP improved but not at goal. Patient reports lifestyle changes harder than expected.

  TRAJECTORY                                          ↓
  Systolic BP    158 → 148 → 142
  Diastolic BP    95 →  92 →  88
  Weight         210 → 208 → 207 lb

  PLAN SAID FOR TODAY
  • Recheck BP, target <140/90
  • Discuss adherence to lisinopril
  • Consider adding amlodipine if BP still not at goal
  • Reinforce DASH diet

  OPEN FOLLOW-UPS FROM LAST VISIT (2)
  □ Patient was going to start morning walks — ask if happening
  □ Labs ordered (lipid panel) — confirm reviewed
  ```
- **Copilot Watch cards** (right side):
  - "Open follow-ups from last visit" — same 2 items, with `Met / Drop / Carry` inline actions
  - "Plan said for today" — bulleted list
- **Setup form** (below the brief): Template selector defaults to "Hypertension Follow-up" (her last-used for this patient); style is "HYBRID" (her default); division is `MEDICAL` (org default).

Every fact in the brief has a **source pill** ("from Office Visit · 2025-12-04"). Maya taps the trajectory's "Systolic BP" row to confirm the source is correct — it opens the source note's Vitals section in a side drawer. She closes the drawer.

She doesn't change anything in setup. She taps **Start Recording**.

### Step 1 — Recording begins, 10:00 AM

**Screen: `/capture/[noteId]`** — The capture workspace opens. Maya is on the iPad in landscape mode (tablet-optimized layout):

- **Top bar**: OmniScribe wordmark + `RecordingStatus` chip: `● Recording · 00:00`
- **Left pane** (transcript): empty so far; 3-bar VU meter at the top shows mic input pulsing
- **Right pane**:
  - `PriorContextPanel` — the brief, read-only, scrollable
  - Live note panel below — empty so far
- **Bottom controls bar**:
  - **Pause / Resume** (outlined, secondary)
  - **Start Drafting** (filled teal — the loud primary CTA right now)
  - **Finish & Review** (outlined, quiet — Maya is NOT supposed to tap this yet)
- **Bottom-right corner**: Copilot beacon (Sparkles icon, teal, 48×48 px)

James walks in. Maya greets him.

**Behind the scenes**: The browser AudioWorklet started capturing PCM Int16 LE at 16 kHz mono. The server minted a 60-second ephemeral Soniox key via `POST /api/notes/[noteId]/realtime-key`. The browser opened a WebSocket directly to Soniox using that ephemeral key. Audit log: `REALTIME_KEY_ISSUED`.

### Step 2 — The visit, 10:00–10:13 AM

As Maya and James talk, the transcript builds in the left pane. Speakers are color-coded:
- **Speaker 1 (teal)**: Maya — clinician
- **Speaker 2 (purple)**: James — patient

Live diarized text scrolls. Maya glances at it occasionally to confirm Soniox is hearing them correctly, but mostly she's looking at James.

About 3 minutes in, Maya taps **Start Drafting**.

**Behind the scenes**: The button click POSTs `/api/notes/[noteId]/start-drafting`. The note transitions through the SSE-driven progress channel. The `ai-generation` worker begins consuming transcript chunks. The right pane's live note panel starts populating section by section. The section progress strip appears at the top of the right pane:

```
○ Subjective ⟳ ⟳ Objective ⟳ ○ Assessment ⟳ ○ Plan ⟳ ○ Patient Education ⟳
empty         generating      empty           empty   empty
```

Maya doesn't read the live note — she's still with James. The "Start Drafting" button changes to "Re-draft" (outlined, secondary). The "Finish & Review" button becomes the loud primary teal CTA.

James mentions he's been walking, but only twice this week. Maya makes a mental note to address adherence. Around 10:09 she takes James's BP: 138/86. She says aloud, "Your BP today is 138 over 86" — Soniox captures it, the Objective section's draft updates a few seconds later.

10:13 AM. They wrap up. James leaves.

### Step 3 — Finish, 10:13 AM

Maya taps **Finish & Review**.

**Behind the scenes**:
- AudioWorklet stops capturing.
- Final audio blob is uploaded via `POST /api/notes/[noteId]/complete-stream` along with the final Soniox transcript JSON.
- S3 stores the audio at `audio/raw/{noteId}/{segmentId}.wav` (encrypted, lifecycle-protected, never hard-deleted).
- `AudioSegment` row created.
- Voice-id worker fan-out is enqueued (best-effort speaker matching against `VoiceProfile` cosine similarity).
- The note transitions through `TRANSCRIBING` → `DRAFTING` (it stays in DRAFTING because the ai-generation worker may still be finishing the last section).

Maya is briefly on **screen: `/processing/[noteId]`** — the transient reassurance screen. The `ProcessingIndicator` shows 3 gently rotating gears. Copy says, "Wrapping up James's note…" If it takes longer than usual, the copy escalates: "Taking a bit longer than usual — almost done." (It never does today; it's about 8 seconds.)

The screen auto-routes to `/review/[noteId]`.

### Step 4 — Review and edit, 10:13–10:15 AM

**Screen: `/review/[noteId]`** — Section accordions, top-to-bottom:

- **Subjective** (`● populated`) — clinician's voice transcribed cleanly. Mentions adherence concern, walking twice this week.
- **Objective** (`● populated`) — Vitals: BP 138/86 (today), HR 72, weight 207 lb. Auscultation: clear.
- **Assessment** (`● populated`) — "Hypertension, improving but not at goal. Patient adherence is a barrier."
- **Plan** (`● populated`) — Continue lisinopril 20 mg daily. Add amlodipine 5 mg daily. Walking goal: 30 min, 5 days/week. Recheck in 4 weeks. Order BMP + lipid panel.
- **Patient Education** (`● populated`) — DASH diet handout. Walking starter guide.

Right side: **Readiness panel** — all required sections green. No blocking flags. One AI compliance suggestion: "Consider documenting whether amlodipine was discussed with the patient" (info-level; Maya considers, decides yes, taps the Plan section, edits to add "Discussed amlodipine, patient agreed").

The Plan section's status badge changes from `● populated` → `✏ edited`.

Maya scrolls down. The **Open follow-ups from last visit** section (driven by the prior-context brief) shows the 2 items. Maya considers each:
- **Patient was going to start morning walks — ask if happening** → Maya taps the **Met** button next to it. (She just talked about it; James started, kept it partial. "Met" is a reasonable close — the topic was addressed.)
- **Labs ordered (lipid panel) — confirm reviewed** → Maya taps **Carry** (she still needs to chase the result; carries to next visit's brief).

10:15 AM. She taps **Sign Note**.

### Step 5 — Sign, 10:15–10:17 AM

**Screen: `/sign/[noteId]`** — Read-only final preview. Big "Sign Note" button (filled teal primary). She's prompted for her 4-digit signing PIN (her unlock window had expired since her last signing). She types her PIN, which opens a fresh unlock window. Tap **Sign Note**.

**Behind the scenes**, in one transaction:
- `Note.status = SIGNED`
- `Note.finalJson = canonicalize(draftJson)` (immutable from this moment — anti-regression rule 3)
- `Note.signedAt = now()`, `signedByUserId = maya.userId`, `authorOrgUserId = orgUser.id`
- FollowUp closures applied (Met for walks, Carry for labs)
- Audit log: `NOTE_SIGNED` with `pinVerified: true`, no PHI

Then asynchronously:
- `note-brief` job enqueued (precompute James's next-visit brief — runs in ~30 seconds)
- `post-sign-artifacts` job enqueued:
  - **Patient instructions** — generated as a `NoteArtifact` (separate document, NOT an edit to `finalJson`). Plain-language summary: "Your blood pressure today was 138/86. We're adding a new medication (amlodipine, 5 mg daily). Goals: 30-minute walks 5 days/week. Lab work coming. Next visit in 4 weeks."
  - **No referral letter** today (no referrals in plan).

She's redirected to `/home`. Toast: "Note signed for James Park. Patient instructions ready to print."

### Step 6 — Print the patient instructions, 10:17 AM

Maya taps the toast. A printable view opens. The kiosk printer in the exam-room hallway prints a single page. She hands it to the front-desk admin on her way to Exam Room 5 for her next visit.

10:18 AM — total clinician time on this note: about 4 minutes. James's chart is up to date. The next clinician (or Maya, in 4 weeks) will see today's note in James's brief.

---

## What just happened — behind the scenes summary

| Step | User action | Data state | Audit log |
|---|---|---|---|
| 1 | Open `/prepare/[noteId]` | Note created with `status: PREPARING`; brief loaded from `NoteBrief` | `NOTE_PREPARING_OPENED` |
| 2 | Tap "Start Recording" | `REALTIME_KEY_ISSUED`; `status: RECORDING` | `REALTIME_KEY_ISSUED`, `RECORDING_STARTED` |
| 3 | Speak with patient | Soniox WS streams partials + finals direct to browser | (no per-utterance audit; volume too high) |
| 4 | Tap "Start Drafting" mid-visit | `ai-generation` job enqueued; sections begin streaming via SSE | `DRAFTING_STARTED` |
| 5 | Tap "Finish & Review" | Audio upload + `complete-stream`; `status: TRANSCRIBING → DRAFTING`; voice-id fan-out | `RECORDING_FINALIZED`, `AUDIO_UPLOADED` |
| 6 | Transit `/processing` (SSE) | Wait for last sections to complete | (none) |
| 7 | Land on `/review`; edit Plan section | `_sectionStatus[plan].status: populated → edited`; debounced PATCH `/api/notes/[id]/sections/plan` | `NOTE_EDITED` (PHI-free metadata: sectionId) |
| 8 | Close follow-ups (Met + Carry) | `FollowUp` rows updated | `FOLLOWUP_CLOSED` × 2 |
| 9 | Tap "Sign Note"; signing-PIN prompt; confirm | Transaction freezes `finalJson`, sets signature fields | `NOTE_SIGNED` |
| 10 | Background: brief + artifacts | `note-brief` + `post-sign-artifacts` jobs complete | `BRIEF_GENERATED`, `ARTIFACT_GENERATED × 1` (patient instructions) |

## Edge cases this journey would handle (verify in build)

- **James doesn't show.** Maya cancels the Schedule from `/home`. No Note is created. (Notes are auto-created only when the clinician opens `/prepare/[noteId]` and taps Start.)
- **Mic permission denied.** The capture page shows `<StatusBanner role="alert">`: "OmniScribe needs microphone access to record this visit." Recover via browser permissions; tap Retry.
- **Network drops mid-recording.** Browser buffers audio locally; on reconnect, the Soniox WS opens with a new ephemeral key; the buffered audio is sent. If reconnect fails for >30 seconds, the page shows `<StatusBanner role="alert">`: "Connection lost — recording saved locally. We'll finish processing when you're back online."
- **Maya needs to step out briefly.** She taps **Pause**. The WS stays open; the worklet stops emitting; the status chip says `⏸ Paused · 04:23`. She taps **Resume** and continues.
- **AI generation worker fails mid-stream.** Affected section shows `⚠ failed`. Maya taps **Regenerate** on that section. Other sections remain populated/edited.
- **Maya accidentally taps "Finish & Review" before she meant to.** No data lost. The note is in DRAFT; she can tap a "Resume Recording" button on the review screen to re-open capture (continues the same `Note`).
- **Maya tries to leave the page without finishing.** `<AlertDialog>` (NOT native `confirm`) appears: "Recording in progress — discard or save?" Default action is "Keep recording" (primary teal).
- **The note has 0 prior-visit follow-ups.** Sign-sweep modal does not appear — clinician goes straight to the signing-PIN prompt (or signs directly if the unlock window is still active).
- **Maya is impersonated by a platform owner doing support.** Every action is audited as the impersonator's `actingUserId`, with the impersonated user as `onBehalfOfUserId`. The impersonator cannot sign notes.

## Three-lens evaluation for this journey

**Clinician** — Documentation isn't the work. The clinician keeps eye contact with the patient. The brief makes returning patients feel known. The follow-up sweep means nothing slips between visits. The note is a clinical document, not an AI essay.

**Medicare Compliance Officer** — Every section is populated with audit-traceable provenance. Vitals are quoted. Skilled medical decision-making is documented (decision to add amlodipine, reasoning). Time-based services are time-stamped. Signature + attestation are explicit.

**Insurance Auditor** — `finalJson` is immutable from sign. `transcriptRaw` is the unmodified Soniox response (audit-reconstructable). Every edit (`section.status === 'edited'`) is tagged on the section. Every regenerate is logged with overwrote-edited flag. Every PHI access is logged with PHI-free metadata.

## What surfaces does this journey exercise?

- `/home` — schedule + drafts queue
- `/prepare/[noteId]` — pre-visit brief + setup
- `/capture/[noteId]` — recording workspace (desktop two-pane OR mobile-tabbed)
- `/processing/[noteId]` — transient transit screen
- `/review/[noteId]` — section editor + readiness + follow-up close
- `/sign/[noteId]` — attestation + signing-PIN re-verify
- Patient-instructions printable view (post-sign artifact)
- Copilot beacon (visible but not opened in this journey)

## What this journey does NOT cover

- First-time onboarding (Journey 01)
- Returning patient with detailed copilot Watch interaction (Journey 03)
- Section regenerate when LLM gets it wrong (Journey 04)
- Asking the copilot a question mid-visit (Journey 05)
- Telehealth (Journey 06)
- Template selection / custom templates (Journey 08)
- Multi-clinician handoff to another provider
- Behavioral Health visits (different prompt, sensitivity gating)
- Rehab visits with episode + goals (different snapshot strip + plan format)

## Build-team checklist for "this journey works"

- [ ] A signed-in clinician with `NOTE_CREATE` + `NOTE_EDIT` + `NOTE_REVIEW` + `NOTE_SIGN` features can complete this journey end-to-end on a tablet AND a desktop browser.
- [ ] Total clinician time on the note (review + edit + sign) ≤ 5 minutes for a typical 15-min visit.
- [ ] The brief loads in < 1 second on `/prepare/[noteId]`.
- [ ] Section progress strip updates in < 2 seconds after each section completes (SSE poll = 2s).
- [ ] `finalJson` is frozen and verifiable as immutable after sign.
- [ ] Audit log captures every step listed in the "behind the scenes" table.
- [ ] No native `confirm()`; no hardcoded status colors; no `text-[Npx]` in this surface.
- [ ] 3-tap test: from `/home`, clinician reaches "recording" in ≤ 1 tap; from `/review`, reaches "signed" in ≤ 2 taps.
- [ ] Three-lens evaluation passes.

## Related references

- Capture flow detail: [`references/design-critique-capture-flow.md`](../references/design-critique-capture-flow.md)
- Section progress detail: [`references/section-progress-spec.md`](../references/section-progress-spec.md), [`references/section-progress-ui-spec.md`](../references/section-progress-ui-spec.md)
- Brief generation: [`references/prior-context-brief-spec.md`](../references/prior-context-brief-spec.md), [`references/prior-context-brief-prompt.md`](../references/prior-context-brief-prompt.md)
- Brief UI: [`references/prior-context-brief-ui-spec.md`](../references/prior-context-brief-ui-spec.md)
- Build units that deliver this journey: [`context/specs/03-capture-recording.md`](../context/specs/03-capture-recording.md), [`context/specs/04-transcription-pipeline.md`](../context/specs/04-transcription-pipeline.md), [`context/specs/05-note-generation-and-sign.md`](../context/specs/05-note-generation-and-sign.md), [`context/specs/06-prior-context-brief.md`](../context/specs/06-prior-context-brief.md)
