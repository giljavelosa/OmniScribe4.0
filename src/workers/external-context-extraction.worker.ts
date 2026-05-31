import type { Job } from 'bullmq';

export async function externalContextExtractionHandler(job: Job) {
  const mod = await import('./external-context-extraction/handler');
  return mod.handle(job);
}
