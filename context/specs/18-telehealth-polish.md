# Unit 18: Telehealth Polish

## Goal

Wave 3 closing unit (per `references/telehealth-architecture-spec.md` Phase 3+4 polish). With Units 15–17 the telehealth happy-path works end-to-end. Unit 18 hardens the rough edges that clinicians actually hit: clinicians want to know their setup works *before* the patient is staring at them; a 30 s WS-blip recovery is great but the clinician needs to see it happening; a tab-closed-mid-call shouldn't silently lose the visit; an auditor needs to see call quality metrics post-hoc.

What this unit DOES ship:
- **Pre-call diagnostic** at `/telehealth/preflight/[scheduleId]` — mic permission + audio level test + network connectivity probe + a clear pass/fail UI before the clinician enters the room.
- **Reconnect surfacing + manual retry** — banner the clinician when the pipeline is reconnecting; show a "Retry now" button when auto-retries exhaust.
- **Rejoin banner** — when re-entering an ACTIVE room mid-call, surface "Resuming session — first audio segment may be incomplete" so the clinician understands the gap.
- **Call quality metrics** — capture reconnect count + sample-pump count + transcript-segment count + call duration; store as `TelehealthSession.qualityMetrics` JSON on end. Auditor lens + future ops dashboards can read it.
- **Preflight audit** — `TELEHEALTH_PRECALL_CHECK_FAILED` when a clinician fails the diagnostic; gives ops visibility into setup-side trends.

What this unit DOES NOT ship (explicitly out of scope):
- Daily SDK swap for the patient audio track — needs real Daily account + token-mint flow; ships when DAILY_API_KEY lands.
- TitaNet voice-ID match — sizable ML integration; lands as its own unit alongside the post-call review surface for clinician-vs-patient labeling.
- Mid-call audio recovery on tab-close — fundamentally limited by browser memory loss; the rejoin banner is the honest UX.
- A "Start telehealth visit" CTA on the schedule list — ships in a Wave 3.5 unit alongside the broader scheduling-surface polish.

## Design

### Pre-call diagnostic

`/telehealth/preflight/[scheduleId]` — server-gated by clinician ownership (same gate as the room page). Renders a card with three checks:

1. **Mic permission + audio level** — `getUserMedia({ audio: true })`; on success show a live VU meter so the clinician can see their voice register. "I hear myself" confirmation step (not just permission-granted).
2. **Network reachability** — `fetch('/api/telehealth/preflight/ping', { method: 'GET' })` with a 5 s timeout. The endpoint just returns `{ ok: true, t: Date.now() }`. Measures round-trip; surfaces RTT in ms.
3. **Browser compatibility** — checks `window.MediaStreamTrackProcessor !== undefined` (Chrome-only API; the audio pipeline depends on it). On unsupported browsers, hard-block with a "Use Chrome or Edge" message.

Each check has an inline status (idle / running / pass / fail) and a retry button. When all three pass, a "Continue to telehealth room" button enables and links to `/telehealth/room/[scheduleId]`.

Pure helpers in `src/lib/telehealth/preflight.ts` (testable): `checkBrowserCompat()`, `measureRoundTrip(fetchImpl, timeoutMs)`. Mic check stays in the client component since it touches getUserMedia.

### Reconnect surfacing

Room shell already wires `onConnectionChange` from the pipeline. Today it drives the `<ConnectionChip>` in the header. Unit 18 adds:

- **Inline reconnecting banner** in the transcript pane when `connState === 'reconnecting'`: "Connection lost — reconnecting…" with a small spinner.
- **Failed state with manual retry** when `connState === 'failed'`: banner with a "Retry connection" button that constructs a new pipeline + restarts. Three attempts before pipeline gives up; the manual button restarts the count.

Manual retry is implemented via a new `resetAndStart()` flow in the room shell — tear down current pipeline, construct a fresh one, call start. The retained samples + transcript stay (they're component state, survive pipeline restart).

### Rejoin banner

Pipeline retains samples in browser memory; tab close destroys those. On re-mount, the room shell detects "we've already been here" via a brief check against the session row's `lastEnteredAt` (new field — populated by the room page on each visit). If the session has `lastEnteredAt` from a prior visit AND the current visit is starting fresh, banner: "Resuming session — audio from the previous tab couldn't be recovered."

Simpler v1: use sessionStorage. On first room mount, set `sessionStorage[telehealth-room-${sessionId}] = Date.now()`. On subsequent mounts (page reload), read the key; if set, show the banner. This is cheap (no schema change), client-only, and accurate for the "page reloaded mid-call" case. The "different browser / device" case is a tab-close-equivalent that the banner can't help with anyway.

### Call quality metrics

Pipeline tracks two counters internally (Unit 18 adds them):
- `sampleChunksProcessed: number`
- `reconnectCount: number`

Exposed via a single getter `getQualityMetrics(): { sampleChunksProcessed, reconnectCount }`. Room shell reads on end-call, packages with `callDurationMs` (start-to-end elapsed) + `transcriptSegmentCount`, POSTs as `qualityMetrics` to a new endpoint **OR** extends the existing `/end` route to accept the metrics payload. Extending /end is cleaner — one POST, one audit row.

Schema: `TelehealthSession.qualityMetrics Json?`. Set in the /end handler when payload present. Audit metadata on TELEHEALTH_SESSION_ENDED gains a `qualityMetrics` block (PHI-free — pure numbers).

### Audit additions

- `TELEHEALTH_PRECALL_CHECK_FAILED` — emitted by the preflight surface when any check fails. Metadata: `check: 'mic' | 'network' | 'browser_compat'`, `reason: string` (PHI-free), `scheduleId`. Gives ops insight into common setup failures.

## Implementation

### A. Schema

```prisma
model TelehealthSession {
  // ...
  /** Unit 18 — PHI-free call quality metrics written by the /end handler.
   *  Shape: { sampleChunksProcessed, reconnectCount, callDurationMs,
   *  transcriptSegmentCount }. Auditor lens + future ops dashboards. */
  qualityMetrics   Json?
  // ...
}
```

Migration: ADD COLUMN qualityMetrics jsonb. No backfill needed.

### B. Audit action

`TELEHEALTH_PRECALL_CHECK_FAILED` in `src/lib/audit/actions.ts`.

### C. Preflight helpers + ping endpoint

- `src/lib/telehealth/preflight.ts` — `checkBrowserCompat()`, `measureRoundTrip()`. Pure logic, testable.
- `src/app/api/telehealth/preflight/ping/route.ts` — `GET` returns `{ ok: true, t: Date.now() }`. Auth-gated by NextAuth session (preflight is clinician-only).

### D. Pre-call diagnostic page

- `(clinical)/telehealth/preflight/[scheduleId]/page.tsx` — server gate identical to the room page (schedule + clinician ownership; allows ANY session state since preflight is meaningful before the patient consents too).
- `_components/preflight-shell.tsx` — three-check card with live VU meter for the mic check, RTT chip for the network check, blocking message for browser compat.
- On all-pass: enables "Continue to telehealth room" button → `/telehealth/room/[scheduleId]`.

### E. Pipeline metrics

Add to `TelehealthAudioPipeline`:
- `#sampleChunksProcessed: number` — incremented in `#pump`
- `#reconnectCount: number` — incremented in `#handleSocketClose` when a reconnect actually fires
- `getQualityMetrics(): { sampleChunksProcessed: number; reconnectCount: number }`

### F. Room shell polish

- `<ReconnectingBanner>` when `connState === 'reconnecting'` — inline above the transcript pane.
- `<FailedBanner>` when `connState === 'failed'` — with manual retry button that calls a new `restartPipeline()` helper.
- Rejoin banner on remount when sessionStorage flag is set.
- End-call packages quality metrics into the `/end` POST body.

### G. /end route extension

Accept optional `qualityMetrics` object in the request body. Validate shape (Zod). Persist on the session row + include in audit metadata.

## Out of scope (deferred)

- Daily SDK integration for patient audio track — see "What this unit DOES NOT ship" above.
- TitaNet voice-ID match — own unit.
- Mid-call audio recovery on tab-close — browser-memory-bound; rejoin banner is the honest UX.
- "Start telehealth visit" CTA on schedule list — Wave 3.5 scheduling polish.
- Patient-side network quality tile — would require Daily SDK to read participant track stats; deferred with the SDK.

## Verify when done

- Schema migration applied; quality metrics column ready.
- `/telehealth/preflight/[scheduleId]` renders for the owning clinician; runs three checks; surfaces RTT in ms; passes all three on a healthy local browser.
- Mic check fails → TELEHEALTH_PRECALL_CHECK_FAILED audit row with `check: 'mic'`.
- Room shell shows reconnecting banner during reconnect; failed banner after auto-retries exhaust; manual retry restarts a fresh pipeline.
- Tab reload mid-call surfaces "Resuming session" banner.
- End-call POST carries qualityMetrics; /end handler persists them on the session row and includes them in the TELEHEALTH_SESSION_ENDED audit metadata.
- progress-tracker.md updated; PR #19 stacked on Unit 17.
