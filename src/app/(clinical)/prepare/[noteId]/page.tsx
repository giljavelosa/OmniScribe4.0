import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requiresProfileCompletion } from '@/lib/auth/profile-completion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { PatientIdentityHeader } from '@/components/patients/patient-identity-header';
import { BriefCard } from '@/components/brief/brief-card';
import { EmptyBrief } from '@/components/brief/empty-brief';
import { CopilotShell } from '@/components/copilot/copilot-shell';
import { OpenFollowUpsCard, type CopilotFollowUp } from '@/components/copilot/cards/open-followups-card';
import { PlanForTodayCard, type PlanItem } from '@/components/copilot/cards/plan-for-today-card';
import { FhirWatchCards } from '@/components/copilot/cards/fhir-watch-cards';
import { loadExternalEhrContext } from '@/lib/fhir/project-ehr-context';
import type { PriorContextBriefContent } from '@/types/brief';
import { PasteTranscriptForm } from './_components/paste-transcript-form';
import { UploadAudioForm } from './_components/upload-audio-form';
import { VisitContextStrip } from '@/components/clinical/visit-context-strip';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Prepare visit' };

export default async function PreparePage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  const session = await auth();
  if (!session?.user?.orgId) return null;
  // Profile-completion gate: any role that ever records (CLINICIAN or
  // admin acting as clinician) must declare division + professionType
  // before reaching the recording-entry surface.
  if (requiresProfileCompletion(session.user)) redirect('/onboarding/profile');

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: session.user.orgId },
    include: {
      patient: true,
      encounter: { include: { schedule: true, episode: true } },
    },
  });
  if (!note) notFound();

  const isPreparing = note.status === 'PREPARING';

  // Prior-context brief: prefer same-episode most-recent, fall back to
  // patient-wide. The query is two indexed reads worst-case — well under the
  // 1s render budget.
  const episodeId = note.encounter?.episodeOfCareId ?? null;
  const brief =
    (episodeId
      ? await prisma.noteBrief.findFirst({
          where: { patientId: note.patientId, orgId: session.user.orgId, episodeId },
          orderBy: { generatedAt: 'desc' },
        })
      : null) ??
    (await prisma.noteBrief.findFirst({
      where: { patientId: note.patientId, orgId: session.user.orgId },
      orderBy: { generatedAt: 'desc' },
    }));

  const hasPriorSignedNote = await prisma.note.findFirst({
    where: {
      patientId: note.patientId,
      orgId: session.user.orgId,
      id: { not: noteId },
      status: { in: ['SIGNED', 'TRANSFERRED'] },
    },
    select: { id: true },
  });
  const patientDisplayName = `${note.patient.firstName} ${note.patient.lastName[0] ?? ''}.`.trim();
  // Server component runs once per request; "now" is request-scoped and safe.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  // Unit 25 / Watch v1 — load the projected FHIR cache once. Returns
  // null when no verified PatientFhirIdentity OR all rows stale; the
  // FhirWatchCards bundle renders nothing in that case.
  const fhirContext = await loadExternalEhrContext({
    patientId: note.patient.id,
    ehrSystem: 'nextgen',
  });

  const briefContent = brief?.content
    ? (brief.content as unknown as PriorContextBriefContent)
    : null;

  // Watch v0 cards consume brief data (no new queries — spec §F). Open
  // follow-ups come from the brief snapshot at last sign; live mutation
  // lands on /capture where the action chips matter most.
  const copilotFollowUps: CopilotFollowUp[] = briefContent
    ? briefContent.openFollowUps.map((fu) => ({
        id: fu.followUpId,
        text: fu.text,
        status: fu.status,
        source: fu.source,
      }))
    : [];

  const planForTodayItems: PlanItem[] = briefContent
    ? briefContent.carryForwardPlan.map((text) => ({
        text,
        source: {
          noteId: briefContent.lastVisit.noteId,
          date: briefContent.lastVisit.date,
        },
      }))
    : [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      <PatientIdentityHeader patient={note.patient} />

      <VisitContextStrip
        noteId={note.id}
        clinicianName={session.user.name ?? session.user.email}
        clinicianEmail={session.user.email}
        clinicianProfessionType={session.user.professionType}
        clinicianFreeTextProfession={session.user.profession}
        noteDivision={note.division}
        noteTemplateId={note.templateId}
        noteStyle={note.noteStyle}
        locked={!isPreparing}
      />

      {briefContent ? (
        <BriefCard content={briefContent} nowMs={nowMs} />
      ) : (
        <EmptyBrief
          variant={hasPriorSignedNote ? 'unavailable' : 'first-visit'}
          patientName={patientDisplayName}
          patientId={note.patient.id}
        />
      )}

      {briefContent && (
        <div className="grid gap-4 lg:grid-cols-2">
          <OpenFollowUpsCard
            followUps={copilotFollowUps}
            surface="prepare"
            noteId={note.id}
          />
          <PlanForTodayCard items={planForTodayItems} surface="prepare" noteId={note.id} />
        </div>
      )}

      <FhirWatchCards
        context={fhirContext}
        surface="prepare"
        noteId={note.id}
        nowMs={nowMs}
      />

      <Card>
        <CardHeader>
          <CardTitle>Prepare for visit</CardTitle>
          <CardDescription>
            Record live, upload an existing audio file, or paste a transcript. Template + note
            style come from your saved defaults; the AI draft generates after capture finishes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <StatusBadge variant="info" noIcon>note · {note.status}</StatusBadge>
            <StatusBadge variant="neutral" noIcon>{note.division}</StatusBadge>
            <StatusBadge variant="neutral" noIcon>{note.captureMode}</StatusBadge>
            {note.encounter?.status && (
              <StatusBadge variant="neutral" noIcon>encounter · {note.encounter.status}</StatusBadge>
            )}
          </div>
          {note.encounter?.schedule && (
            <p className="text-muted-foreground">
              Scheduled {note.encounter.schedule.scheduledStart.toLocaleString()} ·{' '}
              {note.encounter.schedule.visitType}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-md">Live</CardTitle>
            <CardDescription>Record audio in-room with diarized live transcript.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild disabled={!isPreparing} className="w-full">
              <Link href={`/capture/${note.id}`}>
                {isPreparing ? 'Start recording →' : `Status: ${note.status}`}
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-md">Upload audio</CardTitle>
            <CardDescription>WAV / MP3 / M4A / WebM / OGG up to 200 MB.</CardDescription>
          </CardHeader>
          <CardContent>
            <UploadAudioForm noteId={note.id} disabled={!isPreparing} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-md">Paste transcript</CardTitle>
            <CardDescription>Skip transcription; AI drafts directly from your text.</CardDescription>
          </CardHeader>
          <CardContent>
            <PasteTranscriptForm noteId={note.id} disabled={!isPreparing} />
          </CardContent>
        </Card>
      </div>

      <CopilotShell surface="prepare" noteId={note.id} patientId={note.patient.id} />
    </div>
  );
}
