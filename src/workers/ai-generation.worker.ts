import type { Job } from 'bullmq';

/**
 * Thin wrapper — real implementation in ai-generation/handler.ts so the
 * fleet entry can dynamic-import without a circular type ref.
 */
export async function aiGenerationHandler(job: Job) {
  const mod = await import('./ai-generation/handler');
  return mod.handle(job);
}
