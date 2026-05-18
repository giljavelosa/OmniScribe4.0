import type { Job } from 'bullmq';

/**
 * Thin wrapper — real implementation in external-context/handler.ts so the
 * fleet entry can dynamic-import without a circular type ref. Pattern mirrors
 * note-brief.worker.ts.
 */
export async function externalContextHandler(job: Job) {
  const mod = await import('./external-context/handler');
  return mod.handle(job);
}
