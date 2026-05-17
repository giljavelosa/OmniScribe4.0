# Unit 16: Telehealth Audio Integration

## Goal

Wave 3 Phase 1 (per `references/telehealth-architecture-spec.md`). Pipe a telehealth call's audio through the existing Soniox real-time pipeline so the clinician's live transcript flows during the call exactly the way it does for an in-person visit. Two browser audio sources — the clinician's local mic and the patient's inbound WebRTC track — multiplexed into a single Soniox WebSocket; diarization handled on Soniox's side; reconnect-resilient via a 30 s client ring buffer.

Unit 15 shipped the session lifecycle + magic-link auth. Unit 17 ships the clinician-facing `/telehealth/room/[scheduleId]` surface that wires the audio pipeline into the Daily.co video iframe. **Unit 16 ships the audio plumbing + the server-side note creation hook so Unit 17 can compose it.**

## Design

### Server side: Note creation on session start

A telehealth session in `CONSENT_CAPTURED` has a Patient + a Schedule + (now) a need for a Note that the live transcript will write into. Today's `POST /api/admin/telehealth/sessions/[id]/start` only creates the Daily.co room and flips status to ACTIVE. Unit 16 extends it to also:

1. Run the existing `startVisit({ tx, scheduleId, ... })` helper inside the same `$transaction` that creates the room — this produces the Encounter + Note exactly the way `POST /api/schedules/[id]/start` does. Note enters at status `PREPARING`.
2. Persist `TelehealthSession.noteId` (new field, `String? @unique`) so the clinician room surface (Unit 17) can resolve session → noteId in one hop without a join.
3. Audit row `TELEHEALTH_SESSION_STARTED` gets `noteId` and `encounterId` in metadata for the auditor lens.

Idempotency: starting a session twice (e.g. clinician double-clicks) finds the existing `session.noteId`, reuses it, no duplicate Notes or rooms. Rooms are recreated only if the prior room URL is missing — covers the "session was cancelled, manually un-cancelled" recovery path (Wave 3 polish; v1 just respects the existing room).

### Browser side: Two-source audio pipeline

`src/lib/telehealth/audio-pipeline.ts` exports `TelehealthAudioPipeline`, a class the Unit 17 room page constructs once it has:

- A clinician local mic `MediaStream`
- A patient remote `MediaStreamTrack` (from Daily.co's `participants.<id>.tracks.audio.persistentTrack`)
- A noteId (from the session's newly-set `noteId`)

The pipeline:

1. Hits `POST /api/notes/[noteId]/realtime-key` to mint a Soniox ephemeral key — **exact same endpoint** the in-person capture flow uses. Soniox config locked at the server (rule 12: `enable_speaker_diarization: true`, `audio_format: 'pcm_s16le'`).
2. Opens **one** WebSocket to Soniox; sends config init.
3. Constructs an `AudioContext({ sampleRate: 16000 })` and loads `/audio/pcm-worklet.js` (the existing in-person worklet — reused unchanged).
4. For **each** source (clinician + patient) constructs its own `AudioWorkletNode`, wires `source → worklet`, and pumps the worklet's Int16Array output to the shared WebSocket. Soniox's diarization model labels speakers across the merged stream.
5. Buffers the most recent 30 s of audio in a `ReconnectBuffer` so a transient WS drop replays the buffer on reopen — protects against the most common telehealth audio loss (1-3 s WiFi blip).
6. Emits transcript events via a callback (`onTranscript(text, isFinal, speakerTag)`) shaped exactly like the in-person flow's transcript pump.

The patient track arrives via `MediaStreamTrackProcessor` in the Unit 17 surface; the pipeline accepts a plain `MediaStreamTrack` and constructs the `MediaStream` wrapper itself, keeping the wrapping detail out of the room page.

#### Why two worklet instances instead of mixing in the worklet

Mixing two streams to mono in JS land sounds simpler but loses Soniox's ability to diarize across sources — Soniox sees one merged signal and has to guess where the speaker turns are. Sending two streams to one WebSocket lets Soniox use the per-stream variance to produce better speaker labels. Cost: 2× WS bandwidth (still trivial — 16 kHz × Int16 = 32 KB/s per source).

#### Why we don't introduce a new ephemeral-key endpoint

The existing `POST /api/notes/[id]/realtime-key` already auth-gates by clinician ownership + checks the note's status is capture-ready. As soon as Unit 16 sets `TelehealthSession.noteId`, the telehealth flow can authenticate the same way an in-person visit does. Adding a telehealth-specific endpoint would duplicate the gating logic for zero benefit; one endpoint serves both call modes.

### ReconnectBuffer

Plain ring buffer of `Int16Array` chunks, capped at 30 s of audio (480_000 samples @ 16 kHz). Two operations:

- `push(samples)` — append; drop oldest when over cap.
- `drain()` — return all buffered samples and clear; called on WS reopen.

Pure data structure, no DOM, no React — testable in isolation.

### Audit additions

The Note lifecycle's existing audit (RECORDING_STARTED, REALTIME_KEY_ISSUED, etc.) covers the audio plumbing because the pipeline calls the SAME endpoints. **One** new action for the session-level lens:

- `TELEHEALTH_AUDIO_RECONNECTED` — emitted by the Unit 17 surface (not the pipeline lib — the lib has no DB) when the pipeline drains the reconnect buffer after a WS reopen. Lets the auditor see if a session had connectivity problems.

The existing audit row `TELEHEALTH_SESSION_STARTED` (Unit 15) gains `noteId` + `encounterId` metadata — no new action, richer payload.

## Implementation

### A. Schema

```prisma
model TelehealthSession {
  // ...
  /** Note this session writes its transcript into. Created in the same
   *  transaction as the room on session start; null until then. 1:1 — a
   *  telehealth session has at most one Note. */
  noteId           String?   @unique
  note             Note?     @relation(fields: [noteId], references: [id])
  // ...
}
```

Migration: ALTER TABLE add column + unique index. Existing rows (none in prod; demo seed has zero) get NULL. No backfill needed.

Back-relation on `Note`: `telehealthSession TelehealthSession?`

### B. Audit action

Add `TELEHEALTH_AUDIO_RECONNECTED` to the AuditAction union in `src/lib/audit/actions.ts`.

### C. Server: session start writes the Note

Modify `POST /api/admin/telehealth/sessions/[id]/start`:

```
guard: TELEHEALTH_SESSION_MANAGE
fetch session w/ schedule
require status === 'CONSENT_CAPTURED'
if session.noteId exists: reuse (idempotent)
else: $transaction { startVisit(...) → encounter+note; flip status to ACTIVE; createRoom; persist roomUrl + roomName + roomExpiresAt + noteId }
audit TELEHEALTH_SESSION_STARTED w/ noteId + encounterId
audit TELEHEALTH_ROOM_CREATED (existing)
return { data: { status, roomUrl, noteId } }
```

Today's endpoint requires `VERIFIED` — Unit 15's start was permissive because consent capture hadn't shipped. Now consent IS the prerequisite (Wave 3 contract: consent before any audio).

### D. Browser library

- `src/lib/telehealth/reconnect-buffer.ts` — `ReconnectBuffer` class.
- `src/lib/telehealth/audio-pipeline.ts` — `TelehealthAudioPipeline` class with `start(opts) → Promise`, `stop()`, `onTranscript`, `onConnectionChange`. Stub-mode aware (when realtime-key returns `stub: true`, the pipeline pumps worklet output into the buffer + drops the bytes instead of opening a fake WS).

### E. Tests

- `test/lib/reconnect-buffer.test.ts` — push/drain/cap behaviors.
- `test/lib/audio-pipeline.test.ts` — pure logic exercised against a fake WebSocket + fake MediaStreamTrack (happy-dom provides the constructors). Verifies: realtime-key fetch is called with the right noteId; config init is sent before audio bytes; buffer drains on reconnect; stop() closes the WS and the worklets cleanly.

## Out of scope (v1)

- Real Daily.co integration — pipeline accepts a `MediaStreamTrack`; how Unit 17 obtains the patient's track from Daily.co's SDK is Unit 17's problem.
- Clinician-facing `/telehealth/room/[scheduleId]` surface — Unit 17.
- Mid-call note-status orchestration (PAUSED on patient leaves, RESUMING on rejoin) — Wave 3 polish.
- Network-quality indicator on the patient tile — Unit 18.
- Recording for redundancy (Option C in the architecture spec) — explicitly deferred; only the note is the artifact.
- TitaNet voice-ID on the post-call review screen — Wave 3 polish.

## Verify when done

- Schema migration applied; demo seed unchanged.
- `POST /api/admin/telehealth/sessions/[id]/start` creates Note + Encounter on first call; reuses both on second call (idempotent).
- The created Note is reachable via the existing `/api/notes/[id]/realtime-key` flow — confirms the pipeline can reuse the in-person ephemeral-key endpoint.
- `ReconnectBuffer` push/drain/cap tests pass.
- `TelehealthAudioPipeline` tests pass against fake WebSocket + happy-dom MediaStreamTrack.
- `TELEHEALTH_AUDIO_RECONNECTED` action is in the AuditAction union and exported.
- progress-tracker.md updated; PR #17 stacked on Unit 15.
