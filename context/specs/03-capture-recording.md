# Unit 03: Capture & Recording

## Goal

Build the live in-encounter capture workspace from day one **without the design pitfalls catalogued in `references/design-critique-capture-flow.md`**. After this unit, a clinician can land at `/capture/[noteId]`, record live audio with diarized transcript streaming, see the audio level, control the recording, and finish to advance the note. Build it modular (no 2,000-line monolith), with correct button polarity, single recording-status source of truth, AlertDialog leave-confirm, and audio-level meter on day one. Also supports UPLOADED and PASTED capture modes.

## Design

Authoritative references for what to build: [`journeys/02-typical-visit.md`](../../journeys/02-typical-visit.md), [`references/design-critique-capture-flow.md`](../../references/design-critique-capture-flow.md), [`references/design-redesign-spec.md`](../../references/design-redesign-spec.md).

### Two layouts (one per breakpoint)

In `src/app/(clinical)/capture/[noteId]/_components/`:

- **`<DesktopCaptureLayout>`** (`lg:flex`) — left transcript pane (`flex-1`) with VU meter at top; right pane (`46vw, max 680px`) with prior context + live note (placeholder until Units 05+06); fixed-bottom controls bar.
- **`<MobileCaptureLayout>`** (`lg:hidden`) — Tabs: Transcript / Live Note / History / Setup. Pulsing dot on un-viewed tabs when content updates. Full-width controls bar.

### Button polarity (P0 design rule)

**Pre-draft** (recording, no draft started yet):
- `<RecordingControls>` shows: **Pause/Resume** (outlined secondary), **Start Drafting** (filled teal — loud primary CTA), **Finish & Review** (outlined neutral — quiet)

**Post-draft** (drafting in progress or complete):
- **Re-draft** (outlined secondary), **Finish & Review** (filled teal — loud primary CTA)

This inverts the natural intuition; clinicians WILL hit Finish first if it's the loud button mid-recording. Per `design-critique-capture-flow.md` this was the #1 friction in prior prototypes.

### Recording status — single source of truth

One `<RecordingStatus>` chip at the top of the page consumes a `useRecordingState` hook. No other surface (transcript empty state, mobile setup metadata pill, live note panel header) renders its own status. They read the same state.

States: `idle` / `requesting-mic` / `recording` / `paused` / `finalizing` / `drafting` / `complete` / `error`.

### Leave-without-saving

`<AlertDialog>` from `src/components/ui/dialog.tsx`. Title: "Discard recording?" Body: explains audio + draft will be lost. Actions: "Keep recording" (primary teal) + "Discard" (destructive). **Never native `confirm()`.**

### Audio level meter

3-bar `<AudioLevelBars>` at the top of the left pane (desktop) / inside the Transcript tab (mobile). Driven by the AudioWorklet's RMS calculation per buffer. Animates with input level.

### Capture modes

- **LIVE** (default) — browser worklet + ephemeral Soniox WS
- **UPLOADED** — clinician taps "Upload audio" → file picker → S3 upload via presigned URL → enqueues transcription (Soniox batch path)
- **PASTED** — clinician taps "Paste text" → opens TipTap composer → on save, sets `transcriptClean` directly → enqueues ai-generation (skipping transcription)

Toggle in setup form (which is on `/prepare`, not nested in capture).

## Implementation

### A. AudioWorklet (`public/audio/pcm-worklet.js`)

```js
class PcmWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const samples = new Int16Array(input.length);
    let sumSquares = 0;
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      sumSquares += s * s;
    }
    const rmsLevel = Math.sqrt(sumSquares / input.length);
    this.port.postMessage({ samples, rmsLevel }, [samples.buffer]);
    return true;
  }
}
registerProcessor('pcm-worklet', PcmWorklet);
```

Constraints: 16,000 Hz, mono, Int16 LE, 256 buffer. Do NOT change format — rule 12 + downstream code assumes Int16 LE PCM.

### B. Ephemeral key mint (`POST /api/notes/[id]/realtime-key`)

```ts
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, orgUser, error } = await requireFeatureAccess('NOTE_CREATE', req);
  if (error) return error;
  
  const note = await prisma.note.findFirst({ where: { id: params.id, orgId: orgUser.orgId } });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  if (!['PREPARING', 'RECORDING', 'PAUSED'].includes(note.status)) {
    return NextResponse.json({ error: { code: 'invalid_state' } }, { status: 409 });
  }
  
  // Mint ephemeral Soniox key via SonioxService
  const { apiKey, websocketUrl, config } = await sonioxService.mintEphemeralKey({
    noteId: params.id,
    ttlSeconds: 60,
    scope: 'stt-ws-only',
  });
  
  // Transition to RECORDING if PREPARING
  if (note.status === 'PREPARING') {
    await prisma.note.update({ where: { id: params.id }, data: { status: 'RECORDING' } });
  }
  
  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'REALTIME_KEY_ISSUED',
    resourceType: 'Note',
    resourceId: params.id,
    metadata: { expiresInSeconds: 60 },
  });
  
  return NextResponse.json({ data: { apiKey, websocketUrl, config } });
}
```

`sonioxService.mintEphemeralKey` lives in `src/services/transcription/SonioxService.ts` — the **sole** path to Soniox (rule 11). App code never imports the Soniox SDK directly.

Config payload includes: `model: 'stt-rt-v4'`, `audio_format: 'pcm_s16le'`, `sample_rate: 16000`, `enable_speaker_diarization: true` (rule 12), optional `vocabulary` from `Note.template.vocabulary`.

### C. Browser WS lifecycle hook (`_hooks/useRealtimeTranscription.ts`)

```ts
export function useRealtimeTranscription(noteId: string) {
  const [transcript, setTranscript] = useState<Segment[]>([]);
  const [partial, setPartial] = useState<string>('');
  // ...
  
  async function start() {
    // 1. Fetch ephemeral key
    const { data } = await fetch(`/api/notes/${noteId}/realtime-key`, { method: 'POST' }).then(r => r.json());
    
    // 2. Start AudioWorklet
    const ctx = new AudioContext({ sampleRate: 16000 });
    await ctx.audioWorklet.addModule('/audio/pcm-worklet.js');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
    const source = ctx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(ctx, 'pcm-worklet');
    source.connect(worklet);
    
    // 3. Open Soniox WS (BROWSER-SIDE, direct to Soniox)
    const ws = new WebSocket(data.websocketUrl);
    ws.onopen = () => ws.send(JSON.stringify({ api_key: data.apiKey, ...data.config }));
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      // Handle partials, finals, speaker labels
      // ...
    };
    
    // 4. Pump worklet output to WS
    worklet.port.onmessage = (e) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(e.data.samples.buffer);
      // also update audio level state via context
    };
  }
  // ...
}
```

Reconnect handling: on WS close, mint a new ephemeral key and resume (one attempt; failure → show banner).

### D. Recording state machine (`_hooks/useRecordingState.ts`)

Discriminated union per `code-standards.md`:

```ts
type State =
  | { kind: 'idle' }
  | { kind: 'requesting-mic' }
  | { kind: 'recording'; startedAt: number; bufferedSamples: number }
  | { kind: 'paused'; pausedAt: number }
  | { kind: 'finalizing' }
  | { kind: 'drafting' }
  | { kind: 'complete' }
  | { kind: 'error'; reason: string };
```

Single source for the `<RecordingStatus>` chip; all other UI consumes via Context or Zustand.

### E. Complete-stream (`POST /api/notes/[id]/complete-stream`)

Accepts multipart `{ finalTranscript: SonioxFinalJson, audioBlob: Blob }`. Writes `Note.transcriptRaw`, uploads audio to S3 (`audio/raw/{noteId}/{segmentId}.wav`), creates `AudioSegment` row, transitions `Note.status: RECORDING → TRANSCRIBING`, enqueues `transcription` job + `voice-id` fan-out (Unit 04). Audit `RECORDING_FINALIZED` with `durationMs`, `segmentCount`.

### F. Upload + paste modes

- `POST /api/notes/[id]/upload-audio` — multipart audio; validates format + duration; uploads to S3; creates `AudioSegment`; enqueues `transcription`; sets `captureMode = 'UPLOADED'`.
- `POST /api/notes/[id]/paste-transcript` — accepts pasted text; writes `transcriptClean` directly; enqueues `ai-generation` (Unit 05); sets `captureMode = 'PASTED'`.

### G. Components to build

In `src/app/(clinical)/capture/[noteId]/`:
- `page.tsx` — orchestration only (~150 lines max). Loads Note + Patient + Brief; renders Desktop or Mobile layout based on viewport.
- `_components/RecordingStatus.tsx`
- `_components/AudioLevelBars.tsx`
- `_components/RecordingControls.tsx`
- `_components/TranscriptWorkspace.tsx` — speaker-colored diarized text
- `_components/LiveNotePanel.tsx` — placeholder until Unit 05
- `_components/PriorContextPanel.tsx` — placeholder until Unit 06
- `_components/DesktopCaptureLayout.tsx`
- `_components/MobileCaptureLayout.tsx`
- `_components/LeaveConfirmDialog.tsx` — `<AlertDialog>` wrapper
- `_hooks/useRealtimeTranscription.ts`
- `_hooks/useRecordingState.ts`

### H. Note schema additions

The `Note` model is fully defined in Unit 05 (note generation). For Unit 03, just ensure these fields exist:

```prisma
model Note {
  id              String   @id @default(cuid())
  orgId           String
  encounterId     String   @unique
  encounter       Encounter @relation(fields: [encounterId], references: [id])
  patientId       String
  patient         Patient  @relation(fields: [patientId], references: [id])
  authorOrgUserId String
  status          NoteStatus @default(PREPARING)
  captureMode     CaptureMode @default(LIVE)
  audioFileKey    String?
  transcriptRaw   Json?
  transcriptClean Json?
  // more fields in Unit 05
  
  audioSegments   AudioSegment[]
}

model AudioSegment {
  id            String   @id @default(cuid())
  noteId        String
  note          Note     @relation(fields: [noteId], references: [id])
  segmentIndex  Int
  s3Key         String
  durationMs    Int
  sampleRate    Int
  byteSize      Int
  isDeleted     Boolean  @default(false)
  deletedAt     DateTime?
  createdAt     DateTime @default(now())
}

enum NoteStatus {
  PREPARING RECORDING PAUSED TRANSCRIBING DRAFTING DRAFT REVIEWING SIGNED TRANSFERRED INTERRUPTED PENDING_REVIEW
}

enum CaptureMode {
  LIVE UPLOADED PASTED
}
```

## Dependencies

- `@aws-sdk/client-s3@3.x`, `@aws-sdk/s3-request-presigner@3.x`
- The Soniox WebSocket client lives in `src/services/transcription/`; verify the WS endpoint URL format matches Soniox's current docs.

## Verify when done

- [ ] `page.tsx` < 250 lines; everything else in `_components/` or `_hooks/`.
- [ ] Button polarity: pre-draft Start Drafting is the loud primary CTA; post-draft Finish & Review is.
- [ ] `<RecordingStatus>` rendered ONCE; other surfaces consume state.
- [ ] `<AlertDialog>` for leave-without-save (no `confirm()`).
- [ ] `<AudioLevelBars>` animates with mic input.
- [ ] LIVE recording works end-to-end: ephemeral key minted, WS opens to Soniox, transcript streams with diarization, audio uploads on finish, note transitions to `TRANSCRIBING`.
- [ ] UPLOADED + PASTED modes work.
- [ ] Soniox real-time config has `enable_speaker_diarization: true` + `audio_format: "pcm_s16le"` (rule 12 verified by code grep).
- [ ] Ephemeral key never logged; long-lived key never sent to browser (rule 11 verified).
- [ ] Reconnect path works: kill WS mid-recording, audio resumes on reconnect, final transcript intact.
- [ ] Audit: `REALTIME_KEY_ISSUED`, `RECORDING_STARTED/PAUSED/RESUMED/FINALIZED`, `AUDIO_UPLOADED`, `TRANSCRIPT_PASTED` — all PHI-free.
- [ ] 3-tap test: from `/prepare`, reach recording in ≤ 1 tap; from capture, finish-and-review in ≤ 1 tap.
- [ ] Mobile capture tabs work; pulsing dot on unviewed tabs when they update.
- [ ] Three-lens evaluation: Clinician (button polarity + single status source pass the "I tapped Finish by mistake" trap), Compliance (audio persists in S3 for retention; ephemeral keys never logged), Auditor (every state transition logged).
- [ ] `progress-tracker.md` updated.
