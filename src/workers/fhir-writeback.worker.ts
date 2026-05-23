import type { Job } from 'bullmq';

/**
 * Sprint 0.17 — thin wrapper around fhir-writeback/handler.ts so the
 * fleet entry can dynamic-import without a circular type ref. Same
 * pattern as the other workers in this folder.
 */
export async function fhirWritebackHandler(job: Job) {
  const mod = await import('./fhir-writeback/handler');
  return mod.handle(job);
}
