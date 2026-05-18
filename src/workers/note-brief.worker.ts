import type { Job } from 'bullmq';

/**
 * Thin wrapper — real implementation in note-brief/handler.ts so the fleet
 * entry can dynamic-import without a circular type ref.
 */
export async function noteBriefHandler(job: Job) {
  const mod = await import('./note-brief/handler');
  return mod.handle(job);
}
