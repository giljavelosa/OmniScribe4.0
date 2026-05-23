import type { Job } from 'bullmq';

/**
 * Sprint 0.13 — thin wrapper around case-router/handler.ts so the fleet
 * entry can dynamic-import without a circular type ref. Same pattern as the
 * other workers in this folder (note-brief, ai-generation, etc.).
 */
export async function caseRouterHandler(job: Job) {
  const mod = await import('./case-router/handler');
  return mod.handle(job);
}
