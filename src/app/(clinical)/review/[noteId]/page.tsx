import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { readSectionStatus } from '@/lib/notes/section-status';
import type { NoteSectionDef } from '@/lib/notes/build-prompt';
import { ReviewClient } from './_components/review-client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Review note' };

/**
 * /review/[noteId] — server component shell. Loads the note + template +
 * patient + section status synchronously so the first paint has real
 * content. The ReviewClient takes over from there with SSE + auto-save.
 */
export default async function ReviewPage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: session.user.orgId },
    include: {
      template: true,
      patient: true,
    },
  });
  if (!note) notFound();

  // Capture-stage notes belong on /capture or /processing.
  if (['PREPARING', 'RECORDING', 'PAUSED'].includes(note.status)) redirect(`/capture/${noteId}`);
  if (['TRANSCRIBING', 'DRAFTING'].includes(note.status)) redirect(`/processing/${noteId}`);

  // Audit the PHI surface read.
  await writeAuditLog({
    userId: session.user.id,
    orgId: session.user.orgId,
    action: 'PATIENT_VIEWED',
    resourceType: 'Note',
    resourceId: note.id,
    metadata: { surface: 'review', status: note.status },
  });

  const sections =
    (note.template?.sectionSchema as { sections: NoteSectionDef[] } | null)?.sections ?? [];
  const sectionStatus = readSectionStatus(note.inferenceLog);

  return (
    <ReviewClient
      noteId={note.id}
      initial={{
        id: note.id,
        status: note.status,
        division: note.division,
        noteStyle: note.noteStyle,
        patient: {
          firstName: note.patient.firstName,
          lastName: note.patient.lastName,
          mrn: note.patient.mrn,
          dob: note.patient.dob.toISOString(),
          sex: note.patient.sex,
          division: note.patient.division,
          preferredLanguage: note.patient.preferredLanguage,
          isDeleted: note.patient.isDeleted,
        },
        sections,
        sectionStatus,
        draftJson: note.draftJson as Record<string, { content: string; updatedAt: string }> | null,
        finalJson: note.finalJson as Record<string, { content: string; updatedAt: string }> | null,
        lastWorkerError: note.lastWorkerError,
        interruptedAt: note.interruptedAt?.toISOString() ?? null,
      }}
    />
  );
}
