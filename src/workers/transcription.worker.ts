import type { Job } from 'bullmq';

/**
 * Real implementation lands in Commit 4. This thin wrapper exists in Commit 2
 * so the worker entry point compiles + the queue has a handler the moment
 * the fleet boots.
 */
export async function transcriptionHandler(job: Job) {
  const mod = await import('./transcription/handler');
  return mod.handle(job);
}
