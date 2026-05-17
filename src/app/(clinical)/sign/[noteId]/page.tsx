import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { readSectionStatus } from '@/lib/notes/section-status';
import { deriveProgressStrip, isReadyForSign } from '@/lib/notes/derive-progress-strip';
import type { NoteSectionDef } from '@/lib/notes/build-prompt';
import { SignClient } from './_components/sign-client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign note' };

/**
 * /sign/[noteId] — server-side check + read-only final preview surface.
 * The actual transaction lives in POST /api/notes/[id]/sign so finalJson
 * has exactly ONE write path (rule 3 — grep-verified).
 */
export default async function SignPage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: session.user.orgId },
    include: { template: true, patient: true },
  });
  if (!note) notFound();

  // Bounce to /review for any non-sign-ready status.
  if (note.status !== 'DRAFT' && note.status !== 'REVIEWING') {
    redirect(`/review/${noteId}`);
  }

  const sections =
    (note.template?.sectionSchema as { sections: NoteSectionDef[] } | null)?.sections ?? [];
  const sectionStatus = readSectionStatus(note.inferenceLog);
  const progress = deriveProgressStrip(sections, sectionStatus);
  if (!isReadyForSign(progress)) {
    // Hard-bounce back to review with the warning surfaced there.
    redirect(`/review/${noteId}`);
  }

  await writeAuditLog({
    userId: session.user.id,
    orgId: session.user.orgId,
    action: 'NOTE_SIGN_OPENED',
    resourceType: 'Note',
    resourceId: note.id,
  });

  const draft = (note.draftJson as Record<string, { content: string }> | null) ?? {};
  const previewSections = sections
    .map((s) => ({
      id: s.id,
      label: s.label,
      content: (draft[s.id]?.content ?? '').trim(),
      required: !!s.required,
    }))
    .filter((s) => s.required || s.content);

  return (
    <SignClient
      noteId={note.id}
      patientName={`${note.patient.lastName}, ${note.patient.firstName}`}
      mrn={note.patient.mrn}
      division={note.division}
      sections={previewSections}
    />
  );
}
