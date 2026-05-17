# Unit 17: Telehealth Clinician Room

## Goal

Wave 3 Phase 2 (per `references/telehealth-architecture-spec.md`). Ship the clinician-facing `/telehealth/room/[scheduleId]` surface so a telehealth visit is a complete clinician journey: open the room → see the patient on video → live transcript while you talk → end call → land on `/processing` for the standard note-generation pipeline. Reuses the in-person capture flow's `TranscriptWorkspace` + `LiveNotePanel` + Soniox transcript shape so the clinician sees one mental model, not two.

Unit 16 shipped the audio pipeline + the note-on-session-start hook. Unit 17 composes them into the live clinician surface and closes the loop with an end-call handoff to the existing post-recording flow.

## Design

### Route group + path

Lives under `(clinical)/telehealth/room/[scheduleId]/page.tsx` → URL `/telehealth/room/[scheduleId]`. Same auth gate as every other clinical surface (NextAuth + MFA chain via `(clinical)/layout.tsx`).

### Server-side gate

```
ScheduleId → TelehealthSession (1:1 via @unique)
  - session must exist + be ACTIVE
  - session.noteId must be set (Unit 16 always sets it on start)
  - schedule.clinicianOrgUserId must equal the signed-in clinician's orgUserId
    (or the user is SUPER_ADMIN — defense in depth)
```

A clinician hitting the URL pre-start sees a friendly "Session not started — start it from /home" page. Patient hits the URL? They don't — the patient is on `/telehealth/waiting/[scheduleId]` (Unit 15). The auth gate refuses non-clinicians anyway.

### Daily.co iframe vs. SDK

v1 ships the **iframe** embed (one `<iframe src={roomUrl}>` element). Rationale: zero Daily SDK dependency in the bundle until we wire real-mode; iframe loads from `https://stub.daily.co/...` in stub mode (which 404s but doesn't break the page); when DAILY_API_KEY is set the iframe loads the real Daily room and the clinician sees video. Patient track for the audio pipeline still requires the SDK to access `participants.X.tracks.audio.persistentTrack` — see "Stub-mode audio path" below.

### Stub-mode audio path

Without the Daily SDK we don't have access to the patient's inbound audio track. v1 wires the pipeline with:

- **Clinician track:** real, from `navigator.mediaDevices.getUserMedia({ audio: ... })` — same call the in-person capture flow makes.
- **Patient track:** synthetic, generated from a `MediaStreamAudioDestinationNode` fed by a paused oscillator. Silent. The pipeline runs end-to-end (initializes both wiring sources, opens WS in real mode or stays stub) and produces a clinician-only transcript — accurate to the architecture: when DAILY_API_KEY is set, swap the synthetic patient track for the real Daily participant track via SDK and Soniox transcribes both speakers.

The synthetic-patient-track path is explicitly stub-mode plumbing. Wave 3 polish (Daily SDK wiring) is a separate unit; the pipeline lib already accepts a `MediaStreamTrack` so the swap is one-line.

### End-call handoff

Click "End call" → in this order:

1. `pipeline.stop()` — closes Soniox WS, tears down audio.
2. Encode buffered samples into a WAV via the shared `encodeWavBlob()` (extracted from `(clinical)/capture/_hooks/capture-state.tsx` in Commit 2).
3. `POST /api/notes/[noteId]/complete-stream` with WAV + final transcript — flips Note to TRANSCRIBING + enqueues the existing transcription/AI pipeline. Identical to the in-person finish path.
4. `POST /api/admin/telehealth/sessions/[id]/end` — flips session to COMPLETED + destroys Daily room.
5. `router.push('/processing/${noteId}')` — clinician lands on the same post-call screen as in-person.

Order matters: complete-stream BEFORE end-session so the audio is durable before we touch session state. If end-session fails after a successful complete-stream, the Note exists + the audio is uploaded; the clinician can retry end-session from a small banner.

### Pipeline `retainSamples` mode

The Unit 16 pipeline pumps samples to the WS but doesn't retain them. End-of-call WAV upload needs retained samples. Commit 2 adds an optional `retainSamples: true` constructor option; when set, the pipeline accumulates the merged stream's samples in an internal `Int16Array[]` (clinician + patient sources interleaved is fine — Soniox's diarization labels are what disambiguates speakers; for upload, we just need the audio bytes). Memory cap: ~115 MB for 30 min of two 16 kHz Int16 streams; acceptable per single-call. A `drainRetainedSamples()` method returns + clears the buffer for the WAV encoder.

### Audit

The pipeline's `onReconnected` callback fires when ReconnectBuffer drains after a WS reopen. Room shell wires that callback to `fetch('/api/audit/copilot-event', { ..., action: 'TELEHEALTH_AUDIO_RECONNECTED' })` — uses the existing client-side audit ingress (Unit 07) extended in Unit 16 to accept the new action. Auditor lens can see connectivity blips per session without the pipeline lib taking a DB dependency.

### Layout

Patient + session header (top, mirrors capture page).
Two-pane body:

- Left (flex-1): Daily iframe + AudioLevelBars + TranscriptWorkspace.
- Right (46vw max 680px): brief panel (when available) + LiveNotePanel.

Bottom: Room controls (Mic mute toggle + Camera placeholder + End call). Mute is a real local-track enable toggle; camera is a placeholder for v1 (no clinician camera in the iframe model — the video tile is the Daily iframe's responsibility).

## Implementation

### A. Extract WAV encoder

Move `encodeWavBlob` from `src/app/(clinical)/capture/[noteId]/_hooks/capture-state.tsx` into `src/lib/audio/wav-encoder.ts`. Capture-state imports it; the telehealth room imports it. Identical behavior. Add a small vitest case so the encoder shape (header bytes, sample count) doesn't drift.

### B. Pipeline `retainSamples` mode

Extend `TelehealthAudioPipeline` constructor with `retainSamples?: boolean`. Internal `#retained: Int16Array[]` only allocated when the flag is set. `drainRetainedSamples(): Int16Array[]` returns + clears.

### C. Server: room page

`src/app/(clinical)/telehealth/room/[scheduleId]/page.tsx` server component:

- Read schedule + session + verify session.status === ACTIVE
- Verify clinicianOrgUserId === current orgUserId (or SUPER_ADMIN)
- Fetch session.noteId — must be set
- Optional: fetch brief if note has an associated episode + a prior NoteBrief exists
- Render `<TelehealthRoomShell noteId scheduleId roomUrl patientHeader brief />`

### D. Client: room shell

`(clinical)/telehealth/room/[scheduleId]/_components/room-shell.tsx`:

- Owns the `TelehealthAudioPipeline` instance + the stub patient track
- On mount: grab clinician mic + start pipeline
- Renders the layout described above
- Renders `<DailyIframe roomUrl>` (just an `<iframe>`)
- Wires onReconnected → audit endpoint
- End-call button → handleEndCall (see flow above)

### E. Audio level + transcript reuse

The pipeline's audio wiring already emits rmsLevel per source. Room shell wires the clinician source's rmsLevel into a local state that drives a reused `AudioLevelBars` (extracted to a shared location, OR a local copy — pick the shared route if it's a clean lift, else the local copy avoids touching the in-person capture surface).

For the transcript: pipeline's `onTranscript` callback emits the same shape capture-state.tsx parses internally. Room shell maintains `transcript: TranscriptSegment[]` + `partial: string` and renders the shared `<TranscriptWorkspace>` component. If `<TranscriptWorkspace>` reads from `useTranscript()` (a capture-context hook), we either extract the context-free version into a shared component or pass props directly to a smaller `<TranscriptDisplay>`. Pick whichever requires the smaller diff.

## Out of scope (v1)

- Daily.co SDK integration for the patient audio track — pipeline accepts the swap when DAILY_API_KEY is set + the SDK is wired.
- Mid-call rejoin if the clinician disconnects — Wave 3 polish.
- Clinician camera tile separate from the iframe — Wave 3 polish.
- Network-quality indicator on the patient tile — Unit 18.
- Server-side recording for redundancy — explicitly deferred per architecture spec.
- TitaNet voice-ID on post-call review — Wave 3 polish.

## Verify when done

- `/telehealth/room/[scheduleId]` page renders for the owning clinician when session is ACTIVE.
- Non-owning clinician + non-clinician roles get 403/redirect.
- Pipeline starts on mount; stub-mode produces synthetic patient track; mic-only transcript flows when real Soniox key is set.
- "End call" runs the three-step handoff (complete-stream → end-session → push /processing) in order.
- TELEHEALTH_AUDIO_RECONNECTED audit emitted when reconnect happens.
- progress-tracker.md updated; PR #18 stacked on Unit 16.
