import { Worker, type WorkerOptions } from 'bullmq';

import { redis } from '@/lib/redis';
import { QUEUE_NAMES } from '@/lib/queue';
import { transcriptionHandler } from './transcription.worker';
import { voiceIdHandler } from './voice-id.worker';
import {
  aiGenerationStub,
  noteFinalizeStub,
  noteBriefStub,
  postSignArtifactsStub,
} from './stubs';

/**
 * OmniScribe worker fleet entry point.
 *
 * Anti-regression rule 16: this process MUST be running for any flow that
 * ends in a generated note. If you see notes stuck in TRANSCRIBING / DRAFTING,
 * check `npm run dev:workers` is alive BEFORE debugging anything else.
 *
 * Anti-regression rule 18: only ONE fleet per Redis per environment. Two
 * fleets double the daily Redis request volume (BullMQ polls aggressively
 * via bzpopmin per worker per queue) and can exhaust quota-capped providers.
 *
 * Each queue gets exactly one Worker instance. Concurrency is per-queue; we
 * leave it at the default 1 for now — Unit 05 may tune ai-generation up
 * once it stops being a stub.
 */

const baseOptions: WorkerOptions = { connection: redis };

const workers = [
  new Worker(QUEUE_NAMES.transcription, transcriptionHandler, baseOptions),
  new Worker(QUEUE_NAMES.aiGeneration, aiGenerationStub, baseOptions),
  new Worker(QUEUE_NAMES.noteFinalize, noteFinalizeStub, baseOptions),
  new Worker(QUEUE_NAMES.voiceId, voiceIdHandler, baseOptions),
  new Worker(QUEUE_NAMES.noteBrief, noteBriefStub, baseOptions),
  new Worker(QUEUE_NAMES.postSignArtifacts, postSignArtifactsStub, baseOptions),
];

for (const w of workers) {
  w.on('failed', (job, err) => {
    console.error(`[worker:${w.name}] job ${job?.id ?? '?'} failed:`, err.message);
  });
  w.on('error', (err) => {
    console.error(`[worker:${w.name}] runtime error:`, err.message);
  });
}

async function shutdown(signal: NodeJS.Signals) {
  console.log(`workers: ${signal} received, draining…`);
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

console.log(
  `OmniScribe workers running. Queues: ${workers.map((w) => w.name).join(', ')}`,
);
