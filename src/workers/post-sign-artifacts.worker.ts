import type { Job } from 'bullmq';

/**
 * Thin wrapper — real implementation in post-sign-artifacts/handler.ts so the
 * fleet entry can dynamic-import without a circular type ref.
 */
export async function postSignArtifactsHandler(job: Job) {
  const mod = await import('./post-sign-artifacts/handler');
  return mod.handle(job);
}
