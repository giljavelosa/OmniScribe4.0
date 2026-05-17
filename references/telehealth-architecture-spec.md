# Telehealth — Architecture Spec

**Status:** Recommendation, ready for engineering review
**Stack assumed:** Whisper (faster-whisper-server) + pyannote (bundled in Whisper container) + TitaNet (voice ID) + Anthropic Claude (notes)

## What we're building

A real-time video visit between **clinician** and **patient**, with the patient joining via a magic link (no app install, no account creation). Audio captured during the call feeds the existing transcription + diarization + voice-ID + note-generation pipeline. The clinician sees the same capture flow they use for in-person visits, just with a video tile attached.

## What we're NOT building

- A general-purpose video conferencing product. This is single-clinician-to-single-patient. Group consults, family-member-on-the-call, screen-sharing, file transfer — all out of scope for v1.
- A custom WebRTC implementation. Not worth the maintenance burden for a clinical product.
- Recording for compliance / replay. Audio is processed and discarded; the **note** is the artifact of record. Recording the video itself adds HIPAA storage burden with limited clinical value.

## Decision 1 — Video provider

Don't build WebRTC yourself. Pick a HIPAA-eligible managed provider. Comparison:

| Provider | HIPAA / BAA | Pricing model | Recording | Audio extraction | Notes |
|---|---|---|---|---|---|
| **Daily.co** | Yes | $0.0015/participant-min, $99/mo min | Yes (S3) | Webhook on raw audio track | Best DX, fastest setup. Recommended. |
| **LiveKit** | Yes (self-hosted; Cloud BAA on Pro) | $50/mo + $0.0009/min | Self-hosted recording | Server-side audio room hook | Best if you already self-host infrastructure. |
| **Twilio Video** | Yes | $0.0015/participant-min | Yes (S3) | Group rooms can capture audio tracks | Mature, expensive, heavy SDK. |
| **Vonage (Tokbox)** | Yes | $0.00475/participant-min | Yes (S3) | Audio composer addon | Older API, good support. |

**Recommendation: Daily.co.** Cheapest at this volume, BAA available on the standard $99/mo plan, raw-audio webhook makes the audio routing problem trivial. Their `daily-js` client integrates cleanly into your existing Next.js app.

Estimated cost at typical telehealth volume:

```
Daily.co:    ~$0.003 / minute (2 participants × $0.0015)
Whisper:     self-hosted compute already paid for
TitaNet:     self-hosted compute already paid for
Anthropic:   ~$0.50 per generated note (already in your unit economics)

Total marginal cost per 30-min telehealth visit: ~$0.59
```

## Decision 2 — How audio reaches Whisper

Three architecturally distinct options. Pick one early and stick with it.

### Option A — Browser-side WebRTC tap to Whisper (recommended)

```
Patient browser ─┐
                 ├─► WebRTC media server (Daily) ─► Both videos rendered
Clinician browser┘                              │
                                                ▼
                            Clinician browser taps the inbound audio track,
                            converts to PCM 16 kHz, streams to your existing
                            Whisper WebSocket the same way `useRecordingStream`
                            does today for in-person.
```

**Pros:** Reuses your existing capture flow. No new server-side audio plumbing. Clinician's transcript appears live (same UX as in-person visits).

**Cons:** Audio quality depends on the WebRTC negotiation; you're transcribing what the clinician hears, not the original mic. In practice this is fine — Daily's audio is 48 kHz Opus, and Whisper handles compressed audio well.

**Engineering notes:**
- Use `MediaStreamTrackProcessor` API (Chrome) to tap the inbound audio track from Daily's `participantTracks`. Convert to `Float32Array` at 16 kHz, then post to your Whisper WS.
- Safari fallback: use `Web Audio API` with an `AudioWorklet` that captures the `<audio>` element's stream. Same conversion path.
- The clinician's own voice is already captured by their local mic, so no extra wiring needed there.

### Option B — Server-side audio hook (Daily webhook)

```
Daily.co media server ─► On-call audio webhook ─► Your /api/telehealth/audio
                                                              │
                                                              ▼
                                                     Forward to Whisper
                                                              │
                                                              ▼
                                                  Push transcript via SSE
                                                  to clinician browser
```

**Pros:** No client-side audio plumbing. Server-side processing is more resilient to clinician-laptop quirks.

**Cons:** Extra hop adds latency (typically 800–1500 ms vs. 200–500 ms for Option A). Live transcript will feel laggy.

### Option C — Two parallel audio paths

Run both. Browser-side tap drives the live transcript (low latency). Server-side recording is the source of truth used for the final note generation pass.

**Pros:** Best of both. Fault-tolerant.

**Cons:** More moving parts. Probably overkill for v1.

**My recommendation: Option A for v1, add Option C in v2 if telehealth becomes a meaningful share of volume.**

## Decision 3 — Patient identity / link flow

Clinician creates a telehealth visit → system generates a unique session URL → patient clicks the link → joins the video call.

The **link itself** is the auth. No password, no account.

```
https://app.omniscribe.com/v/{patientToken}
```

`patientToken` is a 22-character random URL-safe token. Lookup table:

```typescript
table TelehealthSession {
  id              uuid PK
  noteId          uuid FK → Note
  patientToken    string (22-char random, indexed, unique)
  expiresAt       datetime  // 24h after the scheduled visit time
  scheduledAt     datetime
  joinedClinicianAt datetime?
  joinedPatientAt   datetime?
  endedAt           datetime?
  videoProviderSessionId string  // Daily room name
  patientNetworkQuality jsonb?   // logged for audit
  consentedAt       datetime?
}
```

**Verification step on join:**
- Patient lands on the page → sees "Hi Jane — please confirm your date of birth to join."
- Light verification by DOB match. Wrong DOB → block with "Please contact your clinician."
- This is intentionally not strong auth. The combination of (random link sent to known patient contact + DOB confirmation) is the standard telehealth pattern; full account auth is too much friction for the patient side.

**Link delivery:** SMS or email at the time the visit is scheduled. Reminder 15 minutes before the visit. Out-of-scope for the architecture spec; assumed to use whatever messaging service you already have for appointment reminders.

## Decision 4 — Recording + consent

Two separate decisions:

**Audio recording for transcription:** Required (this is the whole point). Patient consents to this on the waiting room screen before joining (the consent checkbox in the mockup is pre-checked but explicit; tap to deselect).

**Video recording for replay:** Don't do it for v1. Storage burden is high, clinical value is low, HIPAA exposure is amplified. Audio is discarded after the note is generated and signed; only the transcript text is retained.

**Audit log entries** required per CLAUDE.md rule 8:
- `telehealth.session.scheduled` (clinician)
- `telehealth.session.patient_consented` (patient, with timestamp + IP)
- `telehealth.session.joined` (each side)
- `telehealth.session.recording_started` / `recording_stopped`
- `telehealth.session.ended`

## Decision 5 — Network resilience

Telehealth introduces three new failure modes that in-person doesn't have:

1. **Patient drops connection mid-call.** Daily.co's client SDK auto-reconnects with exponential backoff. While reconnecting, the clinician sees the patient's tile turn into a "reconnecting" state (matching the existing pipeline-status pattern from in-person capture). Audio buffers for up to 60 s; transcription resumes when reconnected. If reconnect fails after 60 s, session enters "interrupted" state — clinician can save the partial note and follow up.

2. **Whisper server hiccups.** The browser-side tap (Option A) means audio buffering on the client. If Whisper WS disconnects, audio is buffered locally for up to 30 s and replayed on reconnect. If reconnect fails, fall back to the server-side recording (if you've shipped Option C).

3. **Clinician closes the tab.** Same handling as in-person capture today — save current state, allow resume from `/drafts`. The Daily session stays open for 60 s waiting for the clinician to come back; after that the patient sees "your clinician will rejoin shortly" with a 5-minute timeout before the session is marked interrupted.

## Decision 6 — Where TitaNet plays

TitaNet runs **after** the call ends, not during. Its job is matching audio segments to a clinician's voice profile (so the diarization output's "Speaker A" / "Speaker B" gets a confidence-weighted "likely clinician" / "likely patient" assignment).

For telehealth specifically:
- Clinician's voice profile is already in TitaNet (from previous in-person visits + their voice profile setup).
- Patient's voice is unknown — TitaNet returns "no match" for the patient. That's fine; "Speaker B · unknown" is the correct label.
- Speaker assignment review on the post-call review screen lets the clinician confirm "Speaker B was the patient" and that gets persisted.

No telehealth-specific TitaNet changes required. The existing pipeline works.

## Decision 7 — Clinician scheduling integration

For v1, telehealth visits are scheduled inside OmniScribe (the existing `Schedule` model that CLAUDE.md hints at). The clinician picks a patient, picks a time, picks "Telehealth," and the system generates the session + sends the link.

For v2, integrate with external scheduling (Google Calendar, EHR scheduling, etc.). Out of scope here.

## Phased rollout

### Phase 0 — Infra + auth (1 sprint)

- Daily.co account + BAA in place
- `TelehealthSession` table + Prisma migration
- `patientToken` generation + DOB verification flow
- Patient-side waiting room UI (mobile-first, friendly visual language)
- Patient-side video room UI (Daily SDK integration)
- Audit log entries

### Phase 1 — Audio integration (1 sprint)

- Clinician browser taps inbound audio track via `MediaStreamTrackProcessor`
- Stream to existing Whisper WS endpoint
- Live transcript appears in clinician view (reusing capture flow components)
- Browser-side audio buffering for 30 s reconnect window
- Network-quality indicator on patient tile

### Phase 2 — Capture flow integration (1 sprint)

- Note generation kicks off when transcript begins
- Same live-note panel as in-person capture
- "Start drafting" button repositioned for in-call ergonomics
- End-visit handoff to review screen (existing flow)

### Phase 3 — Polish (1 sprint)

- Patient consent tracking + audit
- Patient pre-call checks (camera/mic/network)
- Reconnection / interrupted-session handling
- Clinician "patient is ready" notification
- Mobile clinician path (tablet patient is fine; phone clinician is a nice-to-have)
- TitaNet voice-ID integration on the post-call review screen

### Phase 4 (later) — Optional improvements

- Server-side recording (Option C) for redundancy
- Patient-side captions (live transcript shown to patient — useful for accessibility, hearing-impaired patients)
- Family member / caregiver as third participant (different consent flow)
- Screen share (clinician shows imaging or patient shows skin condition)
- Multi-clinician consult (referring + consulting)

## Cost summary

For a clinic doing 50 telehealth visits / week (avg 30 min each):

```
Visits: 50 × 30 min = 1500 min/week
       × 2 participants = 3000 participant-minutes/week

Daily.co:    3000 × $0.0015 = $4.50/week  + $99/mo base = ~$120/month
Whisper:     existing self-hosted compute (no marginal increase)
TitaNet:     existing self-hosted compute (no marginal increase)
Anthropic:   50 × ~$0.50 = $25/week (~$108/month) — already in your unit economics

Marginal monthly cost: ~$120 (Daily.co BAA + minutes)
Per-visit marginal cost: ~$0.60
```

Compare to typical commercial telehealth platforms ($30–$80/clinician/month for white-label video) — significantly cheaper because you're paying for the medium, not the SaaS wrapper around it.

## Open questions for product

These need a product decision before engineering can finalize:

1. **Patient identity strength.** DOB confirmation is the recommended baseline. Some practices may want stronger (address match, last 4 of SSN, photo ID). Decision affects HIPAA stance.

2. **Recording retention.** Is the audio truly discarded after note signing, or kept for X days for QA / dispute resolution? Industry varies. Either choice is defensible; pick one.

3. **Patient-side captions.** Accessibility win, but means patient sees the transcript in real-time. Does that change the clinician's behavior? (Some clinicians may be self-conscious knowing the patient sees what's being captured.) Worth user-testing.

4. **Multi-tenant isolation.** Daily.co rooms are per-session; PHI doesn't cross orgs. But verify the BAA covers your multi-tenant model.

5. **EHR integration.** Many clinics need the telehealth visit + note to flow to their EHR (Epic, Cerner, Athena). Out of scope for v1, but ratchets up urgency for the EHR integration roadmap that's been in the spec since Phase 14.

## Files in this telehealth slice (when complete)

```
src/app/(telehealth)/
  waiting/[sessionId]/page.tsx          ← patient waiting + pre-call checks
  room/[sessionId]/page.tsx             ← patient + clinician in-call
  consent/page.tsx                       ← (optional) standalone consent

src/app/v/[patientToken]/page.tsx        ← public patient entry route

src/services/telehealth/
  daily.service.ts                       ← Daily.co SDK wrapper
  session.service.ts                     ← TelehealthSession CRUD
  audio-tap.ts                           ← browser-side audio extraction

src/app/api/telehealth/
  sessions/route.ts                      ← create / list sessions
  sessions/[id]/route.ts                 ← get / update / end
  consent/route.ts                       ← record patient consent

src/components/telehealth/
  WaitingRoom.tsx                        ← patient pre-call shell
  VideoRoom.tsx                          ← shared video tile component
  ClinicianControls.tsx                  ← in-call controls for clinician
  PatientControls.tsx                    ← simpler in-call controls for patient
  PreCallChecks.tsx                      ← camera / mic / network probes
  NetworkQualityIndicator.tsx            ← shared bars indicator
```

## Files in this folder

- `design-redesign-spec.md` — main spec with all 18 phases of the redesign
- `design-mockups.html` — visual mockups for all redesigned screens (open in browser)
- `design-critique.md` — original full-app design audit
- `design-critique-capture-flow.md` — capture flow deep dive
- **`telehealth-architecture-spec.md`** ← this file
- `src/app/api/healthcheck/route.ts` — health check endpoint (Whisper-aware)
