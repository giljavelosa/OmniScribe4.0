import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { StatusBadge } from '@/components/ui/status-badge';
import type { PriorContextBriefContent } from '@/types/brief';
import { CaptureStateProvider } from './_hooks/capture-state';
import { DesktopCaptureLayout } from './_components/DesktopCaptureLayout';
import { MobileCaptureLayout } from './_components/MobileCaptureLayout';
import { ClientStubBanner } from './_components/ClientStubBanner';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Capture' };

/**
 * Orchestration only — per spec §G this page stays ≤ ~150 lines. The
 * CaptureStateProvider owns lifecycle; the layout components own structure;
 * the controls + transcript + status components own behavior. No component
 * imports another's implementation — every cross-cut goes through the
 * provider's hooks.
 */
export default async function CapturePage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: session.user.orgId },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
      encounter: { select: { episodeOfCareId: true } },
    },
  });
  if (!note) notFound();

  // The clinical layout enforces MFA + auth. The capture page additionally
  // refuses if the note is already past capture (defense-in-depth alongside
  // the realtime-key 409).
  if (!['PREPARING', 'RECORDING', 'PAUSED'].includes(note.status)) {
    redirect(`/prepare/${note.id}`);
  }

  // Prior-context brief + live open follow-ups (both server-fetched so the
  // panel renders synchronously on first paint).
  const episodeId = note.encounter?.episodeOfCareId ?? null;
  const brief =
    (episodeId
      ? await prisma.noteBrief.findFirst({
          where: { patientId: note.patient.id, orgId: session.user.orgId, episodeId },
          orderBy: { generatedAt: 'desc' },
        })
      : null) ??
    (await prisma.noteBrief.findFirst({
      where: { patientId: note.patient.id, orgId: session.user.orgId },
      orderBy: { generatedAt: 'desc' },
    }));

  const openFollowUps = await prisma.followUp.findMany({
    where: { patientId: note.patient.id, orgId: session.user.orgId, status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
    include: { originNote: { select: { signedAt: true } } },
    take: 20,
  });

  const hasPriorSignedNote = !!(await prisma.note.findFirst({
    where: {
      patientId: note.patient.id,
      orgId: session.user.orgId,
      id: { not: note.id },
      status: { in: ['SIGNED', 'TRANSFERRED'] },
    },
    select: { id: true },
  }));

  const patientDisplayName = `${note.patient.firstName} ${note.patient.lastName[0] ?? ''}.`.trim();
  // Server component runs once per request; "now" is request-scoped.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  const briefContent = (brief?.content ?? null) as PriorContextBriefContent | null;
  const initialOpenFollowUps = openFollowUps.map((fu) => ({
    id: fu.id,
    text: fu.text,
    status: fu.status,
    source: {
      noteId: fu.originNoteId,
      date: (fu.originNote?.signedAt ?? fu.createdAt).toISOString().slice(0, 10),
    },
  }));

  const patientHeader = (
    <div className="min-w-0">
      <h1 className="text-md font-semibold truncate">
        {note.patient.lastName}, {note.patient.firstName}
      </h1>
      <p className="text-xs text-muted-foreground font-mono">{note.patient.mrn}</p>
      <div className="mt-1 flex items-center gap-2">
        <StatusBadge variant="neutral" noIcon>{note.division}</StatusBadge>
        <StatusBadge variant="neutral" noIcon>{note.captureMode}</StatusBadge>
      </div>
    </div>
  );

  // The same banner element renders in both layouts' dedicated slot; only one
  // viewport renders at a time so we get exactly one banner that lives inside
  // the viewport-height container (without it the controls get pushed off-screen).
  const stubBanner = <ClientStubBanner />;

  return (
    <CaptureStateProvider noteId={note.id}>
      <DesktopCaptureLayout
        noteId={note.id}
        patientHeader={patientHeader}
        stubBanner={stubBanner}
        brief={briefContent}
        initialOpenFollowUps={initialOpenFollowUps}
        patientDisplayName={patientDisplayName}
        patientId={note.patient.id}
        nowMs={nowMs}
        hasPriorSignedNote={hasPriorSignedNote}
      />
      <MobileCaptureLayout
        noteId={note.id}
        patientHeader={patientHeader}
        stubBanner={stubBanner}
        brief={briefContent}
        initialOpenFollowUps={initialOpenFollowUps}
        patientDisplayName={patientDisplayName}
        patientId={note.patient.id}
        nowMs={nowMs}
        hasPriorSignedNote={hasPriorSignedNote}
      />
    </CaptureStateProvider>
  );
}
