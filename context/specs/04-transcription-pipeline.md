# Unit 04: Transcription Pipeline

## Goal

Build the server-side pipeline that takes a finalized audio + raw Soniox transcript from the browser (Unit 03), persists it durably, cleans it for downstream consumers (note generation in Unit 05, voice-id, brief), and transitions the note through the `NoteStatus` state machine. Includes the SSE status stream that drives the `/processing` page reassurance UX and the section progress strip (Unit 05+10).

## Design

No new user-facing UI in this unit (the `/processing` page lives in Unit 05). This is the data plane connecting capture (Unit 03) to generation (Unit 05).

## Implementation

### A. BullMQ infrastructure

`src/lib/queue.ts`:

```ts
import { Queue, QueueOptions } from 'bullmq';
import { redis } from './redis';

const defaultOptions: QueueOptions = {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 1000 },
  },
};

export const transcriptionQueue = new Queue('transcription', defaultOptions);
export const aiGenerationQueue = new Queue('ai-generation', defaultOptions);
export const noteFinalizeQueue = new Queue('note-finalize', defaultOptions);
export const voiceIdQueue = new Queue('voice-id', { ...defaultOptions, defaultJobOptions: { ...defaultOptions.defaultJobOptions, attempts: 2 } });
export const noteBriefQueue = new Queue('note-brief', defaultOptions);
export const postSignArtifactsQueue = new Queue('post-sign-artifacts', defaultOptions);

export async function enqueueTranscriptionJob(payload: { noteId: string; orgId: string; type: 'finalize-realtime-transcript' | 'transcribe-uploaded-audio'; requestId: string }) {
  return transcriptionQueue.add(payload.type, payload, { jobId: `transcription:${payload.noteId}:${payload.requestId}` });
}
// ... similar helpers per queue
```

### B. Worker entry point

`src/workers/index.ts`:

```ts
import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { transcriptionHandler } from './transcription.worker';
import { aiGenerationHandler } from './ai-generation.worker';
import { voiceIdHandler } from './voice-id.worker';
import { noteBriefHandler } from './note-brief.worker';
import { postSignArtifactsHandler } from './post-sign-artifacts.worker';
import { noteFinalizeHandler } from './note-finalize.worker';

const workers = [
  new Worker('transcription', transcriptionHandler, { connection: redis }),
  new Worker('ai-generation', aiGenerationHandler, { connection: redis }),
  new Worker('note-finalize', noteFinalizeHandler, { connection: redis }),
  new Worker('voice-id', voiceIdHandler, { connection: redis }),
  new Worker('note-brief', noteBriefHandler, { connection: redis }),
  new Worker('post-sign-artifacts', postSignArtifactsHandler, { connection: redis }),
];

// Graceful shutdown
process.on('SIGTERM', async () => {
  await Promise.all(workers.map(w => w.close()));
  process.exit(0);
});

console.log('OmniScribe workers running. Queues:', workers.map(w => w.name));
```

Run via `npm run dev:workers` → `npx tsx src/workers/index.ts`.

**Rule 16**: dev workers MUST be running for any flow ending in a generated note.
**Rule 18**: only ONE worker fleet per Redis per environment.

### C. Transcription handler (`src/workers/transcription.worker.ts`)

```ts
export const transcriptionHandler = async (job: Job<{ noteId: string; orgId: string; type: string; requestId: string }>) => {
  const { noteId, type } = job.data;
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note || note.status !== 'TRANSCRIBING') return; // idempotent guard
  
  let rawTranscript;
  if (type === 'finalize-realtime-transcript') {
    rawTranscript = note.transcriptRaw; // already written by /complete-stream
  } else if (type === 'transcribe-uploaded-audio') {
    // Fetch audio from S3, call Soniox batch
    const audioBuffer = await s3.getObject({ Bucket: AUDIO_BUCKET, Key: note.audioFileKey! }).then(r => r.Body!.transformToByteArray());
    rawTranscript = await sonioxService.transcribeBatch(audioBuffer);
    await prisma.note.update({ where: { id: noteId }, data: { transcriptRaw: rawTranscript } });
  }
  
  // Clean transcript
  const clean = await cleanTranscript(rawTranscript);
  
  await prisma.note.update({
    where: { id: noteId },
    data: { transcriptClean: clean, status: 'DRAFTING' },
  });
  
  // Fan out
  await enqueueAiGenerationJob({ noteId, orgId: job.data.orgId, type: 'generate-note', requestId: nanoid() });
  await enqueueVoiceIdJob({ noteId, orgId: job.data.orgId, requestId: nanoid() });
  
  await writeAuditLog({
    orgId: job.data.orgId,
    action: 'TRANSCRIPT_FINALIZED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: { durationMs: computeDuration(clean), wordCount: computeWordCount(clean), speakerCount: countSpeakers(clean) },
  });
};
```

### D. Transcript cleaning (`src/services/transcription/clean.ts`)

```ts
export async function cleanTranscript(raw: SonioxRawJson): Promise<TranscriptClean> {
  // 1. Dedupe — drop is_final: false partials that have final replacements
  // 2. Normalize whitespace
  // 3. Map Soniox speaker ints (1, 2, 3...) to roles: default speaker_1 = CLINICIAN, speaker_2 = PATIENT (voice-id worker refines)
  // 4. Apply vocabulary swaps from template (if any)
  // 5. Return both plaintext (for prompts) + structured array (for UI)
  return { plaintext, structured };
}
```

### E. Voice-ID handler (`src/workers/voice-id.worker.ts`)

```ts
export const voiceIdHandler = async (job: Job<{ noteId: string; orgId: string; requestId: string }>) => {
  // Best-effort; failure does not block ai-generation
  try {
    const note = await prisma.note.findUnique({ where: { id: job.data.noteId } });
    if (!note?.transcriptClean) return;
    
    const segments = (note.transcriptClean as TranscriptClean).structured;
    const uniqueSpeakers = new Set(segments.map(s => s.speaker));
    
    for (const speaker of uniqueSpeakers) {
      // Extract audio window for this speaker from S3
      const audioWindow = await extractSpeakerAudioWindow(note.audioFileKey!, segments, speaker);
      // Compute TitaNet embedding
      const embedding = await titaNetService.embed(audioWindow);
      // Query VoiceProfile pgvector for cosine similarity match within org
      const match = await prisma.$queryRaw`
        SELECT id, "defaultRole", embedding <=> ${embedding}::vector AS distance
        FROM "VoiceProfile"
        WHERE "orgId" = ${job.data.orgId} AND "isDeleted" = false
        ORDER BY embedding <=> ${embedding}::vector
        LIMIT 1
      `;
      if (match[0] && match[0].distance < 0.3) { // cosine threshold
        // Update segments with this speaker to match's defaultRole
      }
    }
    
    await prisma.note.update({ where: { id: job.data.noteId }, data: { transcriptClean: updatedClean } });
    
    await writeAuditLog({
      orgId: job.data.orgId,
      action: 'VOICE_ID_MATCHED',
      resourceType: 'Note',
      resourceId: job.data.noteId,
      metadata: { segmentCount: segments.length, matchCount: matched },
    });
  } catch (err) {
    // Log + move on; voice-id is decorative
    console.error('voice-id failed', err);
  }
};
```

### F. SSE status stream (`GET /api/notes/[id]/stream`)

```ts
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, orgUser, error } = await requireFeatureAccess('NOTE_REVIEW', req);
  if (error) return error;
  
  const url = new URL(req.url);
  const includeSections = url.searchParams.get('include')?.includes('sections') ?? false;
  // Default: just status. With ?include=sections: also section events (Unit 05).
  
  const stream = new ReadableStream({
    async start(controller) {
      let lastStatus: NoteStatus | null = null;
      let lastSectionStatus: any = null;
      let elapsed = 0;
      const intervalId = setInterval(async () => {
        elapsed += 2000;
        if (elapsed > 600000) { // 10 min cap
          controller.close();
          clearInterval(intervalId);
          return;
        }
        const note = await prisma.note.findFirst({
          where: { id: params.id, orgId: orgUser.orgId },
          select: { status: true, inferenceLog: true },
        });
        if (!note) {
          controller.close();
          clearInterval(intervalId);
          return;
        }
        if (note.status !== lastStatus) {
          controller.enqueue(`event: STATUS\ndata: ${JSON.stringify({ status: note.status })}\n\n`);
          lastStatus = note.status;
        }
        if (includeSections) {
          const sectionStatus = (note.inferenceLog as any)?._sectionStatus;
          if (JSON.stringify(sectionStatus) !== JSON.stringify(lastSectionStatus)) {
            // Diff and emit section.generating / section.completed events
            // ... (detail in Unit 05)
            lastSectionStatus = sectionStatus;
          }
        }
        // PROCESSING mode closes when note exits DRAFTING
        if (!includeSections && !['DRAFTING', 'TRANSCRIBING'].includes(note.status)) {
          controller.close();
          clearInterval(intervalId);
        }
      }, 2000);
    },
  });
  
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}
```

Race-safety: wrap `controller.enqueue` + `controller.close` in try/catch to handle rapid client disconnect.

### G. `NoteStatus` state machine

Append-only enum. Canonical transitions:

```
PREPARING → RECORDING → (PAUSED ↔ RECORDING) → TRANSCRIBING → DRAFTING → DRAFT → REVIEWING → SIGNED → (TRANSFERRED)
                                                       ↓
                                                   INTERRUPTED (recoverable; retry restores)
```

Every transition writes audit log. `INTERRUPTED` reachable from any in-flight state on worker failure; retry policy restores.

### H. Failure modes

- **Soniox WS disconnect mid-recording** — Unit 03 reconnect handles; pipeline sees final transcript intact.
- **S3 upload fails** — retry from worker; if 3 attempts fail → `Note.status = INTERRUPTED`, audit, alert.
- **Transcription worker fails 3×** — `Note.status = INTERRUPTED`; surface error to clinician on `/processing` with "we'll retry" + manual retry button.
- **Voice-id fails** — best-effort; do not block ai-generation; log warning.

## Dependencies

- `bullmq@5.x`, `ioredis@5.x`
- `@aws-sdk/client-s3@3.x`
- `nanoid@5.x` (for requestIds)
- The Soniox WS client lives in `src/services/transcription/`.

## Verify when done

- [ ] Live capture: 5-min recording finalizes successfully; `Note.transcriptClean` populated with diarized segments; status advances to `DRAFTING`.
- [ ] Upload mode: WAV file → Soniox batch → cleaned transcript → AI generation enqueued.
- [ ] `Note.transcriptRaw` is unmodified Soniox response (audit reconstructibility).
- [ ] `Note.transcriptClean.structured` has speaker labels (`CLINICIAN`/`PATIENT`/`OTHER`).
- [ ] Audio in S3 never hard-deleted (rule 7); soft-delete in `AudioSegment` only.
- [ ] Voice-id fan-out runs (or fails gracefully); does not block ai-generation.
- [ ] `NoteStatus` transitions audit-logged with PHI-free metadata.
- [ ] SSE PROCESSING stream delivers transitions within 2 seconds; closes on exit from DRAFTING.
- [ ] Race-safety: rapid client disconnect on SSE doesn't double-close the controller.
- [ ] Failure recovery: kill the transcription worker mid-job, restart, job retries cleanly (idempotent via stable jobId).
- [ ] Only one BullMQ worker fleet running against Redis (rule 18).
- [ ] Three-lens evaluation: Clinician (transcript appears quickly with clear speaker colors), Compliance (raw transcript preserved; cleaned for downstream), Auditor (every state transition + worker retry logged).
- [ ] `progress-tracker.md` updated.
