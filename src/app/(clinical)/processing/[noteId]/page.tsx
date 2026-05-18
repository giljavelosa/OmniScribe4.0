import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ProcessingClient } from './_components/processing-client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Processing…' };

/**
 * /processing/[noteId] — transient reassurance screen (spec §K).
 *
 * Server component does ONLY the auth check + status branch. The actual
 * UX is the ProcessingClient (SSE subscriber + escalating empathy copy +
 * auto-route on exit).
 */
export default async function ProcessingPage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: session.user.orgId },
    select: { id: true, status: true, clinicianOrgUserId: true },
  });
  if (!note) notFound();

  // If the note has already cleared the pipeline, skip /processing entirely.
  if (['DRAFT', 'REVIEWING', 'SIGNED', 'TRANSFERRED'].includes(note.status)) {
    redirect(`/review/${noteId}`);
  }
  // If we're earlier in the lifecycle, /processing isn't the right surface —
  // bounce back to capture/prepare.
  if (['PREPARING', 'RECORDING', 'PAUSED'].includes(note.status)) {
    redirect(`/capture/${noteId}`);
  }

  return <ProcessingClient noteId={note.id} initialStatus={note.status} />;
}
