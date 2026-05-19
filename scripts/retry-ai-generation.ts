// One-off: re-enqueue ai-generation for a noteId stuck in INTERRUPTED. Flips
// status back to DRAFTING and pushes a new generate-note job onto BullMQ.
// Usage: node --env-file=.env --import=tsx scripts/retry-ai-generation.ts <noteId>
import { prisma } from '@/lib/prisma';
import { enqueueAiGenerationJob } from '@/lib/queue';
import { NoteStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';

const noteId = process.argv[2];
if (!noteId) {
  console.error('usage: retry-ai-generation.ts <noteId>');
  process.exit(1);
}

const note = await prisma.note.findUnique({
  where: { id: noteId },
  select: { id: true, orgId: true, status: true, division: true, lastWorkerError: true },
});
if (!note) {
  console.error(`note ${noteId} not found`);
  process.exit(1);
}
console.log('before:', note);

if (note.status === NoteStatus.INTERRUPTED) {
  await prisma.note.update({
    where: { id: noteId },
    data: { status: NoteStatus.DRAFTING, interruptedAt: null, lastWorkerError: null },
  });
  console.log('flipped INTERRUPTED → DRAFTING');
}

const requestId = `manual-retry-${randomBytes(4).toString('hex')}`;
const job = await enqueueAiGenerationJob({
  noteId,
  orgId: note.orgId,
  type: 'generate-note',
  requestId,
});
console.log(`enqueued ai-generation job: ${job.id}`);
process.exit(0);
