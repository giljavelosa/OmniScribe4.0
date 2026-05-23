import type { Job } from 'bullmq';

/**
 * Sprint 0.14 — thin wrapper around cleo-state/handler.ts so the fleet
 * entry can dynamic-import without a circular type ref. Same pattern as
 * the other workers in this folder.
 */
export async function cleoStateHandler(job: Job) {
  const mod = await import('./cleo-state/handler');
  return mod.handle(job);
}
