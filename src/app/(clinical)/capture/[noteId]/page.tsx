import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requiresProfileCompletion } from '@/lib/auth/profile-completion';
import { StatusBadge } from '@/components/ui/status-badge';
import type { PriorContextBriefContent } from '@/types/brief';
import { CopilotShell } from '@/components/copilot/copilot-shell';
import { CaptureStateProvider } from './_hooks/capture-state';
import { DesktopCaptureLayout } from './_components/DesktopCaptureLayout';
import { MobileCaptureLayout } from './_components/MobileCaptureLayout';
import { loadExternalEhrContext } from '@/lib/fhir/project-ehr-context';
import { ClientStubBanner } from './_components/ClientStubBanner';
import { LateEntryBanner } from '@/components/notes/late-entry-banner';

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
  // Profile-completion gate: any role that ever records (CLINICIAN or
  // admin acting as clinician) must declare division + professionType
  // before reaching the recording surface.
  if (requiresProfileCompletion(session.user)) redirect('/onboarding/profile');

  const note = await prisma.note.findFirst({
    // deletedAt: null — a discarded recording 404s rather than reopening.
    where: { id: noteId, orgId: session.user.orgId, deletedAt: null },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
      encounter: { select: { episodeOfCareId: true, siteId: true } },
    },
  });
  if (!note) notFound();

  // The clinical layout enforces sign-in auth. The capture page additionally
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

  // Unit 25 / Watch v1 — projected FHIR cache for FhirWatchCards.
  // Returns null when no verified PatientFhirIdentity or stale cache;
  // the bundle renders nothing in that case (Rule 20).
  const fhirContext = await loadExternalEhrContext({
    patientId: note.patient.id,
    ehrSystem: 'nextgen',
  });

  const briefContent = (brief?.content ?? null) as PriorContextBriefContent | null;
  const initialOpenFollowUps = openFollowUps
    // PROPOSED rows are pre-sign on the in-progress note; capture surfaces
    // confirmed prior-visit FollowUps only. Defensive filter.
    .filter((fu): fu is typeof fu & { status: Exclude<typeof fu.status, 'PROPOSED'> } => fu.status !== 'PROPOSED')
    .map((fu) => ({
      id: fu.id,
      text: fu.text,
      status: fu.status,
      source: {
        noteId: fu.originNoteId,
        date: (fu.originNote?.signedAt ?? fu.createdAt).toISOString().slice(0, 10),
      },
    }));

  const siteName = note.encounter?.siteId
    ? (await prisma.site.findFirst({
        where: { id: note.encounter.siteId },
        select: { name: true },
      }))?.name ?? null
    : null;
  const patientHeader = (
    <div className="min-w-0">
      <h1 className="text-md font-semibold truncate">
        {note.patient.lastName}, {note.patient.firstName}
      </h1>
      <p className="text-xs text-muted-foreground font-mono">{note.patient.mrn}</p>
      <div className="mt-1 flex items-center gap-2 flex-wrap">
        <StatusBadge variant="neutral" noIcon>{note.division}</StatusBadge>
        <StatusBadge variant="neutral" noIcon>{note.captureMode}</StatusBadge>
        {siteName && <StatusBadge variant="neutral" noIcon>{siteName}</StatusBadge>}
      </div>
    </div>
  );

  // The same banner element renders in both layouts' dedicated slot; only one
  // viewport renders at a time so we get exactly one banner that lives inside
  // the viewport-height container (without it the controls get pushed off-screen).
  const stubBanner = <ClientStubBanner />;
  const lateEntryBanner = note.isLateEntry ? (
    <LateEntryBanner
      dateOfService={note.dateOfService.toISOString()}
      lateEntryDaysGap={note.lateEntryDaysGap ?? 0}
    />
  ) : null;

  // Autostart the mic when the clinician arrives at /capture for a brand-new
  // LIVE note (status PREPARING). This is the "Record now" optimization: home
  // schedule card → /capture → 1.5s countdown → recording. Resume / paused
  // states skip the countdown — the clinician is mid-visit and shouldn't be
  // surprised by a re-start.
  const autostart = note.captureMode === 'LIVE' && note.status === 'PREPARING';

  return (
    <CaptureStateProvider noteId={note.id}>
      <DesktopCaptureLayout
        noteId={note.id}
        patientHeader={patientHeader}
        stubBanner={stubBanner}
        lateEntryBanner={lateEntryBanner}
        brief={briefContent}
        initialOpenFollowUps={initialOpenFollowUps}
        patientDisplayName={patientDisplayName}
        patientId={note.patient.id}
        nowMs={nowMs}
        hasPriorSignedNote={hasPriorSignedNote}
        fhirContext={fhirContext}
        autostart={autostart}
      />
      <MobileCaptureLayout
        noteId={note.id}
        patientHeader={patientHeader}
        stubBanner={stubBanner}
        lateEntryBanner={lateEntryBanner}
        brief={briefContent}
        initialOpenFollowUps={initialOpenFollowUps}
        patientDisplayName={patientDisplayName}
        patientId={note.patient.id}
        nowMs={nowMs}
        hasPriorSignedNote={hasPriorSignedNote}
        fhirContext={fhirContext}
        autostart={autostart}
      />
      <CopilotShell
        surface="capture"
        noteId={note.id}
        patientId={note.patient.id}
        clinicianName={session.user.name ?? null}
        patientFirstName={note.patient.firstName}
      />
    </CaptureStateProvider>
  );
}
