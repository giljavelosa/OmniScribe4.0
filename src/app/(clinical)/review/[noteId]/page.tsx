import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { readSectionStatus, readInferenceLog } from '@/lib/notes/section-status';
import type { NoteSectionDef } from '@/lib/notes/build-prompt';
import { CopilotShell } from '@/components/copilot/copilot-shell';
import type { CopilotFollowUp } from '@/components/copilot/cards/open-followups-card';
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
  // Same per-section regen flag as the GET /api/notes/[id] response uses.
  // Drives the "Show what changed" link visibility in SectionAccordion.
  const regenerations = readInferenceLog(note.inferenceLog)._regenerations ?? [];
  const sectionHasRegenHistory: Record<string, boolean> = {};
  for (const r of regenerations) {
    if (r.previousContent !== undefined) sectionHasRegenHistory[r.sectionId] = true;
  }

  // Live open follow-ups for the Watch v0 OpenFollowUpsCard in the sidebar.
  // Rule 20: rows derive from extraction over SIGNED notes only (Unit 06).
  const openFollowUps = await prisma.followUp.findMany({
    where: { patientId: note.patientId, orgId: session.user.orgId, status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
    include: { originNote: { select: { signedAt: true } } },
    take: 20,
  });
  const copilotFollowUps: CopilotFollowUp[] = openFollowUps.map((fu) => ({
    id: fu.id,
    text: fu.text,
    status: fu.status,
    source: {
      noteId: fu.originNoteId,
      date: (fu.originNote?.signedAt ?? fu.createdAt).toISOString().slice(0, 10),
    },
  }));

  return (
    <>
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
          sectionHasRegenHistory,
          draftJson: note.draftJson as Record<string, { content: string; updatedAt: string }> | null,
          finalJson: note.finalJson as Record<string, { content: string; updatedAt: string }> | null,
          lastWorkerError: note.lastWorkerError,
          interruptedAt: note.interruptedAt?.toISOString() ?? null,
        }}
        copilotFollowUps={copilotFollowUps}
      />
      <CopilotShell surface="review" noteId={note.id} patientId={note.patientId} />
    </>
  );
}
