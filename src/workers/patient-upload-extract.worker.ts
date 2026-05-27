import type { Job } from 'bullmq';

/**
 * Sprint 0.19 / Tier 13 — thin wrapper around
 * patient-upload-extract/handler.ts so the fleet entry can dynamic-
 * import without a circular type ref. Same pattern as the other
 * workers in this folder.
 */
export async function patientUploadExtractHandler(job: Job) {
  const mod = await import('./patient-upload-extract/handler');
  return mod.handle(job);
}
