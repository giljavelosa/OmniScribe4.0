import type { Job } from 'bullmq';

/**
 * Stub worker handlers for queues whose real implementation lands in later
 * units. They log + complete so the worker fleet stays healthy and any
 * accidental enqueue surfaces in the log without exploding the job queue.
 *
 * - ai-generation handler   → REAL in Unit 05 (lives in ./ai-generation.worker.ts)
 * - post-sign-artifacts     → REAL in Unit 05 (lives in ./post-sign-artifacts.worker.ts)
 * - note-brief handler      → REAL in Unit 06 (lives in ./note-brief.worker.ts)
 * - note-finalize handler   → no production use today; sign is a synchronous
 *   transaction in /api/notes/[id]/sign (spec §H). The queue is retained for
 *   future async-finalize use cases (telehealth post-call handoff, batch
 *   re-sign workflows).
 */

function logStub(name: string) {
  return async (job: Job) => {
    console.log(`[${name}.stub] job=${job.id} name=${job.name} payload=`, job.data);
    return { stub: true, queue: name };
  };
}

export const noteFinalizeStub = logStub('note-finalize');
