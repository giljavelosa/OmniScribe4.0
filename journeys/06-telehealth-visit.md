# Journey 06 — Telehealth Visit

> An in-network telehealth visit, end-to-end. The patient joins via a magic link from their phone — no app install, no account creation. The clinician runs the visit on desktop. The audio integrates seamlessly with the same transcription pipeline. The artifact of record is the *note*, not the video.

## Who

**Dr. Marcus Reyes**, family medicine, 8-clinician practice. Telehealth visit scheduled at 4:30 PM with **Jennifer Liu**, 34F, follow-up for migraine medication. Jennifer is at home with her phone. Marcus is at his desk.

## The journey at a glance

Marcus opens the schedule, clicks the telehealth room. Jennifer received an SMS earlier with a magic link; she taps it 2 minutes before the appointment, lands in a waiting room, enters her DOB to verify identity, accepts video + audio. Marcus admits her. They talk for 12 minutes. Marcus signs the note 4 minutes after the call ends. Jennifer goes about her day.

## The journey, step by step

### Step 1 — Schedule appears, 12:00 PM the morning of

Jennifer received an SMS the day before:

> Hi Jennifer — your telehealth visit with Dr. Reyes is tomorrow at 4:30 PM. Tap to join when ready:
> [link.omniscribe.app/v/8K3J-FQXP-2V7W]
>
> Works on any modern browser, no app needed. We'll ask you to confirm your date of birth before joining the call.

Jennifer doesn't act on it yet. The link goes to OmniScribe's magic-link route.

### Step 2 — Pre-call checks, 4:25 PM (Marcus's side)

Marcus opens `/home` on desktop. Today's schedule shows Jennifer's appointment with a green "Telehealth" badge and an `Enter waiting room` action.

He clicks **Enter waiting room** → routes to `/telehealth/room/[scheduleId]`.

**Screen: `/telehealth/room/[scheduleId]` (clinician view, pre-call)**:

- **Top**: patient identity header (Jennifer Liu · 34F · MRN ...)
- **Center**: black video frame with "Waiting for patient to join…" + an animated dot
- **Left side panel**: pre-call diagnostic — mic ✓, camera ✓, network quality ✓
- **Right side panel**: brief + setup form (same as `/prepare`)
- **Bottom right**: "End visit" button (red outline; disabled until call starts)

Marcus reviews Jennifer's brief while waiting. (Per Journey 03.)

### Step 3 — Jennifer joins, 4:28 PM

Jennifer taps the SMS link.

**Screen: `/v/[magicToken]`** (patient-facing, public):

- **Header**: OmniScribe wordmark + "Welcome, Jennifer"
- **Body**: "You're joining a telehealth visit with **Dr. Marcus Reyes** at **Pinecrest Family Practice**. Scheduled for **4:30 PM today**."
- **Identity verification**: "Please confirm your date of birth: [MM/DD/YYYY]"
- **Primary button**: "Continue"

She enters her DOB. Server validates it matches the patient on file.

**Behind the scenes**: `POST /api/telehealth/verify` with `{ magicToken, dob }`. Server hashes DOB and compares against `Patient.dob` hash (or direct comparison if not hashed; depends on org config). On success, returns a short-lived session token (15 min) scoped to this telehealth session only.

**Screen update**: "Allow OmniScribe to use your microphone and camera." Browser permission prompt. Jennifer taps Allow.

**Behind the scenes**: Browser captures audio + video. WebRTC connection established via Daily.co (HIPAA BAA covers the transport).

**Screen: `/telehealth/waiting/[scheduleId]`** (patient view, in waiting room):

- Self-preview video (small, top-right)
- Body: "Dr. Reyes will be with you in a moment."
- **Audio check**: VU meter shows mic input ("Speak — we should see this move")
- **Tip**: "If you need to step away, you can rejoin from the same link."

She waits.

### Step 4 — Marcus admits Jennifer, 4:29 PM

Marcus's screen updates: "Jennifer is in the waiting room." Big "Admit" button. He clicks it.

**Behind the scenes**: Daily.co connection promotes Jennifer from waiting to main room. Two-way A/V active.

**Screen: `/telehealth/room/[scheduleId]` (in-call)**:

- **Center**: Jennifer's video (main) + Marcus's preview (small, bottom-right)
- **Top status chip**: `● Recording · 00:00` (the visit started recording automatically per consent captured in Step 3)
- **Left side panel** (Marcus's only):
  - Live transcript scrolling
  - 3-bar VU meter for combined audio
  - Speaker labels: blue for Marcus, purple for Jennifer
- **Right side panel** (Marcus's only):
  - Brief + setup
  - Section progress strip + live note panel (once Marcus taps Start Drafting)
- **Bottom controls bar**: Mute mic, Mute cam, Start Drafting, End visit

Jennifer's side: video + audio + a non-blocking banner: "This session is being recorded for note documentation. Audio is processed but not stored. Video is not recorded. Learn more →"

**Behind the scenes (audio)**: Marcus's browser uses `MediaStreamTrackProcessor` to tap the *audio* track of the WebRTC connection. The tapped audio is pumped through the **same Soniox real-time pipeline** as in-person visits (Journey 02 Step 1–2). Same ephemeral key mint, same WebSocket, same diarization. The only difference: the audio source is WebRTC instead of a direct mic worklet.

### Step 5 — The visit, 4:30 → 4:42 PM

Marcus and Jennifer talk normally. Live transcript scrolls. Around 4:36 Marcus taps **Start Drafting**. Section progress strip activates. By 4:41 the draft is mostly populated.

Marcus thanks Jennifer, mentions the medication change is coming, says he'll send a message with the patient instructions and refill request. He says "Bye for now."

He taps **End visit**.

**Behind the scenes**: Daily.co room shuts down. Jennifer's session token expires. Audio capture stops. The final audio + transcript are sent to `/api/notes/[noteId]/complete-stream` (same endpoint as in-person). Note transitions `RECORDING → TRANSCRIBING → DRAFTING`.

**Important**: The video stream is **discarded**. It was never stored. Only the audio is captured + transcribed, and the audio is retained per S3 lifecycle policy. **The note is the artifact of record**, not the video.

### Step 6 — Review + sign, 4:42 → 4:46 PM

Marcus follows Journey 02 from this point: process screen → review screen → edit → sign. The note signs at 4:46 PM. Patient instructions get generated. Marcus sends them via the customer portal (Stripe-integrated billing handles the visit invoicing automatically).

Jennifer receives a text 2 minutes later: "Your visit summary and instructions from Dr. Reyes are ready: [link]." She taps and reads them on her phone.

---

## What just happened — behind the scenes summary

| Step | What | Audit |
|---|---|---|
| Magic link sent | `POST /api/telehealth/magic-link` (admin or clinician triggers in advance) | `TELEHEALTH_LINK_SENT` |
| Patient taps link | Server validates `TelehealthSession.magicToken`, checks unexpired | `TELEHEALTH_LINK_OPENED` |
| Patient DOB verify | `POST /api/telehealth/verify` | `TELEHEALTH_PATIENT_IDENTITY_VERIFIED` |
| Patient enters waiting room | Daily.co room created (lazy, on first patient join); patient session token issued | `TELEHEALTH_WAITING` |
| Clinician admits | Daily.co room promotes patient to active | `TELEHEALTH_CALL_STARTED` |
| Audio tapped + sent to Soniox | Same realtime-key + WS as in-person | `REALTIME_KEY_ISSUED` |
| Start drafting / finish / process / review / sign | Same as Journey 02 | (Journey 02 audit trail) |
| End call | Daily.co room destroyed; patient session token expired | `TELEHEALTH_CALL_ENDED` |
| Post-call cleanup | Video discarded (never stored); audio retained in S3 per lifecycle | (per S3 lifecycle config) |

## What makes this work (build-team mental model)

**Daily.co for video transport.** Recommended over Twilio for v1 per [`references/telehealth-architecture-spec.md`](../references/telehealth-architecture-spec.md): HIPAA BAA, ~$0.003/min, raw-audio webhook capability. Sessions are ephemeral; rooms are created on first patient join and destroyed on end-call.

**Magic link, not patient account.** Patients don't sign up. The link is the auth. The 22-char token + DOB verification = light identity check (the link itself is the primary auth; DOB is the second factor). Token is single-use within a 15-minute window post-verification.

**Audio joins the existing transcription pipeline.** Browser-side `MediaStreamTrackProcessor` taps the WebRTC audio track and pumps it through the same Soniox real-time WS pipeline as in-person visits. **No new transcription stack.** The capture page knows the source is WebRTC instead of direct mic via a `captureSubMode: 'TELEHEALTH'` field on the recording session, but downstream code doesn't care.

**Video is not the artifact of record.** This is a deliberate choice (per spec). Video introduces massive storage + retention + privacy + DSAR complications. The note is the durable artifact, just like in-person. The video helps the encounter happen; once the note is signed, the video is gone.

**Pre-call checks.** Mic, camera, network. Clinician's side shows what's wrong; patient's side guides them through fixes. Detected before they're talking — not during.

## The data model addition (Unit 15)

```prisma
model TelehealthSession {
  id            String   @id @default(cuid())
  scheduleId    String   @unique
  schedule      Schedule @relation(fields: [scheduleId], references: [id])
  noteId        String?  @unique          // populated when recording starts
  note          Note?    @relation(fields: [noteId], references: [id])
  
  magicToken    String   @unique          // 22-char URL-safe
  magicTokenExpiresAt DateTime            // 24h before scheduled start + 2h grace
  patientVerifiedAt DateTime?              // when DOB was confirmed
  patientSessionToken String?              // short-lived (15m); null after end
  
  dailyRoomUrl  String?                   // Daily.co room URL; created lazy
  dailyRoomCreatedAt DateTime?
  dailyRoomEndedAt   DateTime?
  
  status        TelehealthSessionStatus @default(SCHEDULED)
  startedAt     DateTime?
  endedAt       DateTime?
  
  consentCapturedAt DateTime?              // patient's recording consent
}

enum TelehealthSessionStatus {
  SCHEDULED
  WAITING        // patient in waiting room
  IN_PROGRESS    // clinician admitted
  COMPLETED
  CANCELLED
  NO_SHOW
}
```

## Edge cases this journey handles

- **Patient doesn't show up.** Schedule status auto-flips to `NO_SHOW` 15 minutes after scheduled time if `TelehealthSession.startedAt` is null. Clinician can manually mark `NO_SHOW` earlier.
- **Patient joins late.** Magic link works until `scheduled_start + 2h`. Beyond that, link returns "This session has ended; contact the practice."
- **Patient's DOB doesn't match.** "We couldn't verify your identity. Please call the practice." Server logs the attempt (`TELEHEALTH_IDENTITY_VERIFICATION_FAILED`) for audit; doesn't reveal the correct DOB.
- **Patient is on a flaky network.** Daily.co handles WebRTC reconnects automatically (5-attempt; brief audio-only fallback). Audio capture on clinician's browser is resilient to short drops.
- **Clinician forgets to start drafting.** Same as Journey 02 — the recording captures the full conversation; drafting can begin at any time before End visit; if End visit is tapped without drafting started, the note still progresses through transcription and auto-enters `DRAFT` for review later.
- **Patient says "I want to stop the recording."** Clinician taps Pause; recording chip turns yellow. If patient explicitly revokes consent mid-call, clinician taps End visit; the audio captured up to that moment is processed per agreement (or per org policy — discardable on request).
- **Patient closes the browser mid-call.** Daily.co fires a disconnect event; clinician's side shows "Patient disconnected." Patient can rejoin via the same magic link within the active window. If they don't return within 5 minutes, clinician taps End visit; note proceeds with the audio captured so far.
- **Patient is on a public computer.** No special handling at v1 (no patient account; magic-link is the auth). Patient is advised in the SMS/email to use their own device.
- **Patient requires a translator** (live or third-party). Out of scope for v1; clinician can join a 3-party call manually outside the OmniScribe waiting room. (Phase 2 telehealth: in-call invite for translators.)
- **Clinician needs to invite a colleague** (consultation). Out of scope for v1 (single-clinician calls only). (Future phase: in-call invite.)

## Three-lens evaluation

**Clinician** — The call works. The transcription is the same quality as in-person. The note flow is identical. There's no new workflow to learn.

**Medicare Compliance Officer** — Patient identity is verified before any PHI exchange. Recording consent is captured + logged. Audio is processed under BAA (Soniox, AWS). The signed note is the artifact of record + meets the same documentation standards as in-person.

**Insurance Auditor** — TelehealthSession state transitions are logged. The audio + note can be cross-referenced. Video is intentionally not stored (documented choice, not a coverage gap).

## What this journey doesn't cover

- Patient with no smartphone or browser-capable device (out of scope; alternative arranged outside OmniScribe)
- Group sessions / 3-party calls (Phase 2)
- In-call screen-share (out of scope for v1)
- Recording the video as an artifact (explicitly out of scope per architecture choice)
- Asynchronous async-chat consults (different surface, not telehealth)

## Build-team checklist for "this journey works"

- [ ] `TelehealthSession` model + status enum + index on `magicToken`.
- [ ] Magic-link generation (`POST /api/telehealth/magic-link`); SMS + email delivery via Resend / Twilio.
- [ ] Public `/v/[magicToken]` route with DOB verification + consent capture.
- [ ] Patient waiting-room screen with mic/cam check + VU meter.
- [ ] Clinician room screen (`/telehealth/room/[scheduleId]`) with pre-call diagnostic, admit button, in-call surface.
- [ ] Daily.co integration: room creation, admit, end, webhook handling for events.
- [ ] Browser-side `MediaStreamTrackProcessor` audio tap → Soniox real-time pipeline (same ephemeral key + WS as in-person).
- [ ] Video is NEVER stored; verify by code grep + DB schema audit (no `videoFileKey` field).
- [ ] Magic-link tokens expire `scheduled_start + 2h`; patient session tokens expire 15 min after DOB verify.
- [ ] Audit log captures all telehealth-specific events listed in the table above.
- [ ] 3-tap test on clinician side: from `/home`, reach in-call state in ≤ 2 taps (enter waiting room → admit).
- [ ] 3-tap test on patient side: from magic link, reach video in ≤ 3 taps (DOB → continue → allow permissions).
- [ ] Three-lens evaluation passes.

## Related references

- Telehealth architecture (Daily.co, audio integration, magic-link auth): [`references/telehealth-architecture-spec.md`](../references/telehealth-architecture-spec.md)
- Build units delivering this journey: [`context/specs/00-build-plan.md`](../context/specs/00-build-plan.md) Units 15–18 (Telehealth wave)
- In-person sibling: [`journeys/02-typical-visit.md`](02-typical-visit.md)
