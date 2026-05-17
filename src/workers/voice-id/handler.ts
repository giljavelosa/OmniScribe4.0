import type { Job } from 'bullmq';

// Real implementation lands in Commit 4. Stub returns immediately so the
// fleet boots cleanly even if a job arrives between Commits 2 and 4.
export async function handle(job: Job) {
  console.log(`[voice-id.stub] job=${job.id} name=${job.name} — real handler in Commit 4`);
  return { stub: true };
}
