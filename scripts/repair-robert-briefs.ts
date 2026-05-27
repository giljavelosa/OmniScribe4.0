/**
 * One-off repair script: regenerate the 3 dead briefs for Robert Hays
 * (patient cmpj1qq98000gm1uuebt5e8im). Bypasses BullMQ — calls the worker
 * handler in-process so the fix in your working tree is what runs, even if
 * the background worker isn't restarted with the latest code.
 *
 *   npx tsx scripts/repair-robert-briefs.ts
 *
 * Idempotent: NoteBrief is unique on noteId; an upsert means a re-run is
 * safe.
 */

import type { Job } from 'bullmq';

import { prisma } from '@/lib/prisma';
import { handle } from '@/workers/note-brief/handler';

const PATIENT_ID = 'cmpj1qq98000gm1uuebt5e8im';

async function main() {
  const notes = await prisma.note.findMany({
    where: { patientId: PATIENT_ID, status: 'SIGNED' },
    select: { id: true, orgId: true, signedAt: true },
    orderBy: { signedAt: 'asc' },
  });

  console.log(`Found ${notes.length} signed notes for Robert. Re-running each in-process…\n`);

  for (const note of notes) {
    process.stdout.write(`- ${note.id} (signed ${note.signedAt?.toISOString()}) … `);
    try {
      const fakeJob = { data: { noteId: note.id, orgId: note.orgId } } as Job<{
        noteId: string;
        orgId: string;
      }>;
      const result = await handle(fakeJob);
      console.log('OK', JSON.stringify(result));
    } catch (err) {
      console.log('FAILED');
      console.error('  ', err instanceof Error ? err.message : err);
    }
  }

  // Final verification: how many NoteBrief rows now exist for Robert?
  const briefCount = await prisma.noteBrief.count({
    where: { patientId: PATIENT_ID },
  });
  console.log(`\nDone. NoteBrief rows for Robert: ${briefCount}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Top-level error:', err);
  process.exit(1);
});
