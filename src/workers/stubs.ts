import type { Job } from 'bullmq';

/**
 * Stub worker handlers for queues whose real implementation lands in later
 * units. They log + complete so the worker fleet stays healthy and any
 * accidental enqueue surfaces in the log without exploding the job queue.
 *
 * - ai-generation handler → real impl in Unit 05 (LLM abstraction).
 * - note-finalize handler → real impl in Unit 05 (sign + finalJson freeze).
 * - note-brief handler    → real impl in Unit 06 (BriefGenerator).
 * - post-sign-artifacts   → real impl in Unit 05 (patient instructions + referral letters).
 */

function logStub(name: string) {
  return async (job: Job) => {
    console.log(`[${name}.stub] job=${job.id} name=${job.name} payload=`, job.data);
    return { stub: true, queue: name };
  };
}

export const aiGenerationStub = logStub('ai-generation');
export const noteFinalizeStub = logStub('note-finalize');
export const noteBriefStub = logStub('note-brief');
export const postSignArtifactsStub = logStub('post-sign-artifacts');
