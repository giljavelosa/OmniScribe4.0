import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { StatusBadge } from '@/components/ui/status-badge';
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
    include: { patient: { select: { firstName: true, lastName: true, mrn: true } } },
  });
  if (!note) notFound();

  // The clinical layout enforces MFA + auth. The capture page additionally
  // refuses if the note is already past capture (defense-in-depth alongside
  // the realtime-key 409).
  if (!['PREPARING', 'RECORDING', 'PAUSED'].includes(note.status)) {
    redirect(`/prepare/${note.id}`);
  }

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

  return (
    <CaptureStateProvider noteId={note.id}>
      <ClientStubBanner />
      <DesktopCaptureLayout
        noteId={note.id}
        patientHeader={patientHeader}
        stubBanner={null}
      />
      <MobileCaptureLayout
        noteId={note.id}
        patientHeader={patientHeader}
        stubBanner={null}
      />
    </CaptureStateProvider>
  );
}
