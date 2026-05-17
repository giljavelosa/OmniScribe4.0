# Capture Flow Critique — End to End

**Reviewed by:** Claude
**Date:** April 29, 2026
**Scope:** The single workflow that earns or loses every user — from clicking into a patient encounter to handing off to processing.

> The capture screen is OmniScribe's product. Everything else (drafts, admin, billing) is supporting infrastructure. If a clinician can't trust this flow, none of the rest matters. So this pass is deliberately picky.

---

## The Flow at a Glance

A clinician moves through five phases:

1. **Prepare** — `/prepare/[noteId]`. Pick capture mode (record / upload / paste), confirm patient, see prior context.
2. **Listening** — `/capture/[noteId]`. Mic is hot, transcript streaming, but no AI draft yet. Clinician picks division → discipline → note type → style.
3. **Drafting** — same screen, after "Start Draft." Live note fills in section by section while the encounter continues.
4. **Finish** — clinician hits Finish & Review. Recording stops, transcript finalizes, server completes.
5. **Handoff** — routes to `/review/[noteId]` if ready, else `/processing/[noteId]`.

The bones are right. Three things bend the whole flow out of shape:

- **Button polarity is inverted.** The most affirmative action ("Start Draft") looks secondary; the most reversible one ("Finish") screams.
- **Recording status is told to the user in 4–5 places.** No single source of truth.
- **The entire capture page is one 2,245-line React component.** That's a finding all by itself — design polish requires the ability to find and change one thing without breaking another, and at this size that's no longer possible.

---

## Critical Findings

### 1. The 2,245-line monolith

`src/app/(clinical)/capture/[noteId]/page.tsx` is 2,245 lines and ~31,000 tokens. It owns: WebSocket connection management, audio worklet drain timing, state machine for pipeline status, render of two complete layouts (desktop + mobile), every conditional banner, every button variant, native `confirm()` dialogs, and a half-dozen helper functions. This is **the single biggest blocker to design polish** on this product.

Why this is a UX problem, not just an engineering one: when one file holds every conditional state, the only way to make a small change is to read the whole file. So nothing gets refactored, the same status string drifts in 3 places, button hierarchy never gets revisited because nobody wants to touch it. Design quality decays toward whoever last edited it under deadline pressure.

🔴 **Severity: Critical (foundational)**
**Fix:** Extract roughly seven pieces — `useRecordingStream` (WS + worklet), `useRecordingTimer`, `useCapturePipelineStatus`, `<TranscriptPanel>`, `<RecordingControls>`, `<DesktopCaptureLayout>`, `<MobileCaptureLayout>`. The page itself should be ~150 lines of orchestration. This is a 1–2 sprint refactor with no visible user change, but it makes every subsequent design improvement on this list cheap instead of scary.

### 2. Button hierarchy is inverted on the recording controls

In the live recording mode the three buttons sit side by side at the bottom:

| Button | Current style | What it is |
|---|---|---|
| Pause | Outlined circular icon | Reversible utility |
| Start Draft | Outlined pill, primary border, transparent background, primary text | **The affirmative primary action — what success looks like** |
| Finish | Filled bright red, large drop shadow | Recoverable end action (you can still review) |

The clinician's eye lands on the red Finish button because it has the most weight, but pressing it before "Start Draft" gets you to processing without an AI draft running — which is almost certainly not what they wanted. The tooltip on Finish (`"Click Start Draft first to generate your note"`) is correct evidence the team knows this: users *do* hit Finish first. The fix is visual, not copy.

After draft started, the polarity is fine: "Draft Started ✓" disabled green, "Finish & Review →" neutral. So the issue is specifically the pre-draft moment.

🔴 **Severity: Critical (this is the moment users get confused)**
**Fix:**
- Pre-draft: Start Draft = filled primary teal (loud). Finish = outlined neutral or destructive ghost (quiet).
- Pause stays neutral.
- Drop the red on Finish entirely. Red is for destructive irreversible. Finish is reversible (you go to review).
- Reserve red for "Cancel Visit" / "Discard recording" — actions that genuinely lose data.

### 3. Recording status is communicated in 4–5 places

For a single ongoing recording, the user sees recording status in:

1. The **header trust indicator card** (top right): pulsing dot, "RECORDING" label, secondary label, elapsed timer.
2. The **pipeline status banner** (conditional): "Reconnecting to transcription," "Waiting for speech," "Transcription interrupted," "Connection failed."
3. The **CaptureHeader component** (mobile setup tab only): patient block, recording label, elapsed time, plus a *third* metadata pill that re-shows "recording label" with a UserRound icon (`CaptureHeader.tsx` line 84–91).
4. The **LiveNotePanel** status text: "Shaping from transcript," "Draft live," "Preparing first pass," "Starts after draft," "Listening," "Listening for speech."
5. The **transcript empty state**: "Listening for speech" with a mic icon.

Each one was added by someone solving a real problem. Together they form an information surface where the clinician can't tell what is authoritative. "Listening" appears twice with different scopes (audio-listening vs. transcript-not-arriving-yet). "Recording label" appears as a metadata pill *inside* the patient header on the mobile setup tab — that's three nested levels of recording-status display.

🟡 **Severity: Moderate (cumulative confusion, not a single broken thing)**
**Fix:**
- One authoritative `<RecordingStatus>` component lives in the header. It shows: state (initializing / listening / paused / reconnecting / stalled / failed), elapsed, and a single secondary line.
- Pipeline issues become inline modifiers of that single status, not a separate banner.
- Remove the recording-label metadata pill from CaptureHeader — it's redundant with the status block above it.
- LiveNotePanel uses *generation* status only ("Drafting," "Awaiting more detail," "Draft live") — never "Listening." Listening is the header's job.

### 4. Native `confirm()` dialog when leaving a recording

`page.tsx:1912`:
```js
if (!confirm("Leave this encounter? Recording will be interrupted.")) return;
```

Three problems with the browser-native `confirm()`:
- It looks nothing like the rest of the app — clinicians on a tablet see a generic system dialog.
- Some browsers attach the URL to the dialog, others don't — visual inconsistency you can't control.
- Screen readers handle it inconsistently.

🟡 **Severity: Moderate (visible quality regression at the worst possible moment — when a clinician is exiting an active session)**
**Fix:** Use the existing `<AlertDialog>` from shadcn. Title: "Leave this encounter?" Body: "Your recording will be paused and the encounter marked as interrupted. You can resume it from Drafts." Buttons: "Cancel" (ghost), "Leave & save progress" (destructive variant). Same pattern for "Cancel Visit" on the prepare screen.

---

## The Phase-by-Phase Friction Map

### Phase 1 — Prepare

**What works**
- Two-column layout (prior context left, capture setup + actions right) maps to clinician mental model: "what happened last time" + "how I'll capture today."
- The capture-mode summary card ("1. Start recording → 2. Verify the live transcript → 3. Choose documentation setup → 4. Start the live draft") is genuinely useful for first-time users. Most products skip this.
- Auto-expanding the right capture mode panel based on `note.captureMode` is a small smart touch.

**What hurts**
- **The "Cancel Visit" affordance is buried.** It's a 12px ghost link tucked at the very bottom of the action stack, after Change Patient and Return to Patients. If a clinician realizes they opened the wrong note, they hunt for an exit. Move it up or make it a header-level "Discard" with confirm.
- **Three different exit paths** ("Change Patient," "Return to Patients," "Cancel Visit") with overlapping behavior — all three delete the prepping note. Pick one verb. "Discard and start over" covers most of the cases.
- **Upload/Paste collapse panels are 4-step modals inside the right column.** When uploading audio there's idle → uploading → transcribing → done → error. The transitions are fine, but they share visual space with the action stack so the clinician sometimes scrolls during a transcription. Lock the upload card sticky-to-top while it's processing.
- **`text-red-600` for upload errors** (`page.tsx:756, 803, 836`) — same hardcoded-color issue flagged in the main critique. Use `text-destructive`.
- **Patient identity meta uses `text-muted-foreground/50`** at 12px. The DOB and MRN are the *most safety-critical text on the screen* — wrong-patient is a sentinel event in clinical care. /50 is too washed out for that. Bump to /70 minimum.

### Phase 2 — Listening (recording started, no draft yet)

**What works**
- The left/right split is the right call: transcript = primary workspace, setup = secondary configuration. Clinician focus stays on the conversation.
- Live transcript segments use a left border in primary color while still being finalized — subtle and informative.
- Speaker labels intentionally neutral ("Speaker A" / "Speaker B") with a comment explaining why. That's mature thinking — diarization isn't role-aware and pretending it is would be dangerous.

**What hurts**
- **The screen wastes the right panel before draft.** The PriorContextPanel sits there at 400px wide for the entire pre-draft phase, then is *replaced* by the LiveNotePanel after Start Draft. Two issues:
  - Replaced, not added — the prior context disappears the moment the live note appears. A clinician mid-encounter often wants both visible. The History sheet exists but is an extra click.
  - The width also jumps from 400px to `min(46vw, 680px)` on Start Draft — a hard resize with no transition. Animate the width change over 250ms; it'll feel intentional instead of glitchy.
- **No live audio-level visualization.** The clinician has no way to verify the mic is actually catching the conversation until the first transcript segment shows up — which can be 5–10 seconds in. A small VU meter beside the recording dot would close that uncertainty gap. (Most competitors do this for exactly this reason.)
- **"Speaker A / Speaker B" stays neutral forever.** Once the AI has reasonable confidence (typically 30 seconds in), swap to "Speaker A · likely clinician" with a click-to-flip affordance. Keep neutral as the default for safety, but help the clinician scan.
- **Empty transcript state ("Listening for speech")** is two small lines centered. A user under stress (it's the first time, the clinic is busy) will not feel reassured by 14px text. Add a quiet pulsing waveform animation so they know things are alive.

### Phase 3 — Documentation Setup (right panel, top half)

This is where I suspect most user time gets wasted. The setup panel asks for: division → discipline (sometimes) → note type → template → writing style → measures (rehab only). Five-to-six decisions before they can hit Start Draft, mid-recording.

**What works**
- Adaptive complexity (Discipline only for non-Medical divisions, Goals checkbox only for Rehab, etc.) is the right pattern.
- Step numbering ("1. Division → 2. Subtype → 3. Note Type") helps progress feel finite.

**What hurts**
- **The clinician has to do this work *while the patient is in the room*.** Start Draft only unlocks after setup is complete. Right now setup is treated as a configuration task; in reality it's a barrier between the user and their primary action. This deserves a strategic rethink.
  - **Recommendation:** Move setup to *prepare* — use the time before the patient walks in. By the time the clinician hits Start Recording, defaults should already be locked in based on the patient's most-recent note's setup. The capture screen should only show the setup panel if those defaults are missing or the clinician explicitly wants to change them.
- **`<Select>` dropdowns inside a sheet inside the layout** on mobile. (Documented in the main critique; flagging again because it's particularly painful here — this is the moment a clinician switches templates one-handed on a tablet.)
- **`NoteStyleSelector` uses a custom popover** with manual `mousedown` listeners while every other selector uses Radix Select. That style inconsistency is invisible per-component but visible across the panel.
- **"Start Draft" lives inside the setup panel.** The button at the bottom of the recording controls is a *second* Start Draft. Two of the same button on one screen is a tell that there's no clear owner.

### Phase 4 — Drafting (after Start Draft)

**What works**
- The escalating LiveNotePanel status is well-judged: "Preparing first pass" → "Shaping from transcript" → "Draft live."
- Section-level progress (`{populatedSectionCount}/{sections.length} sections`) is genuinely informative — it gives the clinician a sense of completeness without demanding their attention.
- The transcript-turn counter ("X transcript turns") subtly reinforces "the AI is hearing what you're saying."
- Per-section "generating" pulse dot is delightful and unobtrusive.

**What hurts**
- **"Shaping from transcript"** — atmospheric copy. Clinicians are practical. "Drafting from the recording" is clearer.
- **"Awaiting more clinical detail"** vs. **"Will update as more information is captured"** — two different empty messages for waiting sections. Pick one.
- **The Draft Started chip (green-50 / green-700) breaks token discipline.** Every other status in the app uses tokenized colors — this hardcodes Tailwind palette colors. Same bug as the Drafts page badges.
- **No "regenerate this section" affordance.** The single biggest thing a clinician will want once a draft is partially live is "this Plan section came out wrong, retry with the latest transcript." Add a small refresh icon per section once content exists.

### Phase 5 — Finish

**What works**
- The Finish handoff routes intelligently: review-ready → `/review/[noteId]`, otherwise `/processing/[noteId]`.
- Fallback is graceful: if finalization fails, it tries to preserve the draft and continue to review.

**What hurts**
- **The Finish button is currently red (pre-draft) or neutral (post-draft).** Red here is wrong-color: this isn't destructive. It's the user's success exit. (Covered in finding #2.)
- **"Save Draft"** as a 13px uppercase tracked-out ghost link below the main controls reads as a section label, not an action. If saving is a real verb, give it a button shape. If autosave is happening anyway, remove the manual button entirely.
- **No "Discard recording" path during recording.** Only Back-arrow-with-confirm. A clinician who realizes they recorded the wrong patient should have a clearly labeled, slightly hidden "discard" — not have to use back-arrow as the trapdoor.

### Phase 6 — Handoff to Processing

This is the previous critique's section; the only capture-specific note is:

- **Routing decision (`reviewReady` → review, else → processing) is opaque to the user.** From the clinician's POV, hitting Finish & Review sometimes goes to review, sometimes to a waiting screen, with no preview of which. A 200ms delay where the button text changes to "Finalizing recording..." → "Going to review" / "Generating note..." would close the gap.

---

## Cross-Cutting Capture Findings

| Finding | Severity | Recommendation |
|---|---|---|
| Mobile tab order (Transcript / Live Note / History / Setup) puts Setup last, but Setup is the *only* thing blocking Start Draft pre-draft | 🟡 Moderate | Reorder to Setup / Transcript / Live Note / History pre-draft; reorder to Live Note / Transcript / History post-draft. Tabs should reflect what the user is doing right now |
| The unread-update dot on the Live Note tab (when on Transcript) is good. There's no equivalent for Setup-incomplete | 🟢 Minor | Add a subtle red dot on the Setup tab when `setupComplete === false`. Mirrors the same pattern, helps mobile users notice |
| `"Listening for speech"` transcript empty state has no animation | 🟢 Minor | Subtle pulsing waveform. Reassures the user the mic is hot |
| Pipeline status banners use 4 different border-color + bg-color combos (blue, amber, red, red) hardcoded inline | 🟡 Moderate | One `<StatusBanner tone="info|warning|critical|fatal">` component. Same pattern as #2 in the main critique |
| `WS_CONNECT_PARAMS` and worklet URLs are hardcoded in the page component | 🟢 Minor (engineering, not UX) | Move to a service module. Symptom of the monolith |
| The header trust card combines status + secondary label + elapsed in one shape, separated by a vertical divider | 🟢 Minor (works) | Keep — one of the better pieces of design on this screen |
| Speaker color palette (`sky-700/80` for A, `teal-700/80` for B) is hardcoded outside the design tokens | 🟢 Minor | Define `--speaker-1`, `--speaker-2` as tokens. Reuse on review screen |
| `confirm()` for leave (already flagged in #4) | 🟡 Moderate | AlertDialog |
| No keyboard shortcuts for the most-used actions during recording (pause/resume/start-draft/finish) | 🟢 Minor (power users) | Space = pause/resume, Enter = primary action when setup complete. Show a `?` shortcut overlay |
| The History sheet on desktop is redundant with the right-panel pre-draft (both show PriorContext) | 🟢 Minor | Hide the History button pre-draft; show only after Start Draft swaps the right panel to LiveNotePanel |

---

## What Works Well (Capture-Specific)

- The conceptual split (transcript primary, setup secondary, draft replacing setup mid-encounter) is correct.
- Section-level "generating" pulses + transcript-turn counter make the AI feel responsive, not magic.
- The pipeline status state machine ("transcript-delayed" / "stalled" / "reconnecting" / "failed") is far more nuanced than most products bother with — and the corresponding banners give the clinician actionable trust information.
- The fallback path on Finish (try to preserve draft, send to review even if finalization stumbles) is the right safety choice.
- Comment around speaker labels (`page.tsx:124–131`) correctly identifies that diarization clusters aren't roles. That kind of clinical conservatism deserves to land in product copy.
- Auto-expanding the upload/paste capture mode based on saved `captureMode` is a quiet touch.

---

## Priority Recommendations for the Capture Screen

1. **Fix the button polarity.** Pre-draft, Start Draft becomes filled primary, Finish becomes outlined neutral. This single change reduces the most common user error (hitting Finish before drafting). Half a day of work.

2. **Move setup to prepare.** A clinician shouldn't be navigating five dropdowns while a patient is talking. Use the patient's most recent note as the default. Show the setup panel on capture only if no default exists or the clinician explicitly opens it. This requires product judgment, not just engineering — but it's the highest-leverage UX change available on this screen.

3. **Replace `confirm()` with the design system's AlertDialog.** Trivial code change; meaningful trust signal at the most fragile moment of the workflow.

4. **Consolidate the four-to-five recording status surfaces** into one `<RecordingStatus>` component owned by the header, plus a generation-only status in LiveNotePanel. Stop showing "Listening" twice with different meanings.

5. **Break the 2,245-line page into ~7 focused modules.** No visible user-facing change, but every other improvement on this list becomes 5x cheaper afterward.

6. **Add an audio level meter beside the recording indicator.** First-time users distrust the mic until they see proof. This is a 30-line change with a disproportionate impact on first-encounter confidence.

---

## Things I Couldn't Verify Without Running The App

- The width-change behavior when the right panel grows from 400px to 46vw on Start Draft — I'm assuming it's an instant resize because no Tailwind transition class is on the container. Worth verifying visually.
- Whether the "transcript-turn counter" actually increments live or batches.
- How the live transcript scrolls during fast back-and-forth — the auto-scroll on `[sections, isGenerating]` might fight a clinician who has scrolled up to read.
- Whether the Pause button correctly halts WebSocket sending vs. just muting locally — the UX implications differ.
- The mobile layout under heavy load (lots of transcript, partial draft generation, system events) — I can read structure but not feel.

If you want a third pass, the highest-value next focuses are:
- **The review screen end-to-end** (the screen the clinician spends most time on after capture).
- **A live render-only walkthrough** — open the app in a browser, take screenshots of the capture flow at 5 representative states, and let me critique what's actually rendered vs. what's coded.
