import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import type { NoteSectionDef } from '@/lib/notes/build-prompt';
import { CopilotShell } from '@/components/copilot/copilot-shell';
import { professionLabel } from '@/lib/professions';
import { VisitViewerClient } from './_components/visit-viewer-client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Visit' };

/**
 * /visits/[noteId] — dedicated read-only viewer for signed visits.
 *
 * Distinct from /review which is the draft editor in read-mode for
 * SIGNED notes. This viewer has no edit affordances at all — it
 * structurally cannot mutate the note.
 *
 * Surfaces orphan post-sign artifacts (patient handout, referral
 * letter) that the post-sign worker has been generating but no UI
 * previously displayed. Also exposes the consolidated audio recording
 * and cleaned transcript on dedicated tabs.
 *
 * Status routing:
 *   - SIGNED / TRANSFERRED → stay on the viewer
 *   - PREPARING / RECORDING / PAUSED → redirect to /capture
 *   - TRANSCRIBING / DRAFTING → redirect to /processing
 *   - DRAFT / REVIEWING / PENDING_REVIEW → redirect to /review (still being edited)
 */
export default async function VisitViewerPage({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  const { noteId } = await params;
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: session.user.orgId },
    include: {
      template: { select: { name: true, sectionSchema: true } },
      patient: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          mrn: true,
          dob: true,
          sex: true,
        },
      },
      encounter: {
        select: {
          episode: {
            select: {
              diagnosis: true,
              bodyPart: true,
              department: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!note) notFound();

  // Status routing — viewer is for finished notes only.
  if (['PREPARING', 'RECORDING', 'PAUSED'].includes(note.status)) {
    redirect(`/capture/${noteId}`);
  }
  if (['TRANSCRIBING', 'DRAFTING'].includes(note.status)) {
    redirect(`/processing/${noteId}`);
  }
  if (['DRAFT', 'REVIEWING', 'PENDING_REVIEW'].includes(note.status)) {
    redirect(`/review/${noteId}`);
  }

  // Documenting clinician (Note.clinicianOrgUserId → OrgUser → User.name)
  // and signing clinician (Note.signedByUserId → User.name) may differ
  // when an admin signs on behalf — though by policy they are usually
  // the same. Resolve both names server-side so the viewer header is
  // accurate without a client round-trip.
  const [documentingClinician, signingUser, artifacts] = await Promise.all([
    prisma.orgUser.findUnique({
      where: { id: note.clinicianOrgUserId },
      select: {
        professionType: true,
        profession: true,
        user: { select: { name: true, email: true } },
      },
    }),
    note.signedByUserId
      ? prisma.user.findUnique({
          where: { id: note.signedByUserId },
          select: { name: true, email: true },
        })
      : Promise.resolve(null),
    prisma.noteArtifact.findMany({
      where: { noteId: note.id },
      orderBy: { generatedAt: 'asc' },
      select: { id: true, kind: true, content: true, generatedAt: true },
    }),
  ]);

  await writeAuditLog({
    userId: session.user.id,
    orgId: session.user.orgId,
    action: 'PATIENT_VIEWED',
    resourceType: 'Note',
    resourceId: note.id,
    metadata: { surface: 'visit-viewer', status: note.status },
  });

  const sections =
    (note.template?.sectionSchema as { sections: NoteSectionDef[] } | null)?.sections ?? [];

  // finalJson lives in two shapes historically:
  //   pre-Wave-5 wrapper: { sections: [{id,label,content,required}], signedAt, schemaVersion }
  //   legacy map shape:   { [sectionId]: { content, updatedAt } }
  // Normalize to a section-id → content map for the viewer.
  const finalContent = normalizeFinalContent(note.finalJson, sections);

  const documentingDisplayName =
    documentingClinician?.user.name ?? documentingClinician?.user.email ?? 'Unknown clinician';
  const documentingProfession = documentingClinician?.professionType
    ? professionLabel(documentingClinician.professionType)
    : documentingClinician?.profession ?? null;
  const signingDisplayName =
    signingUser?.name ?? signingUser?.email ?? documentingDisplayName;

  return (
    <>
      <VisitViewerClient
        noteId={note.id}
        patient={{
          id: note.patient.id,
          firstName: note.patient.firstName,
          lastName: note.patient.lastName,
          mrn: note.patient.mrn,
          dob: note.patient.dob.toISOString(),
          sex: note.patient.sex,
        }}
        note={{
          status: note.status,
          division: note.division,
          signedAt: note.signedAt?.toISOString() ?? null,
          dateOfService: note.dateOfService.toISOString(),
          isLateEntry: note.isLateEntry,
          lateEntryDaysGap: note.lateEntryDaysGap,
          templateName: note.template?.name ?? null,
        }}
        episode={
          note.encounter?.episode
            ? {
                diagnosis: note.encounter.episode.diagnosis,
                bodyPart: note.encounter.episode.bodyPart,
                departmentName: note.encounter.episode.department?.name ?? null,
              }
            : null
        }
        documentingClinicianName={documentingDisplayName}
        documentingProfession={documentingProfession}
        signingClinicianName={signingDisplayName}
        sections={sections}
        finalContent={finalContent}
        artifacts={artifacts.map((a) => ({
          id: a.id,
          kind: a.kind,
          content: a.content,
          generatedAt: a.generatedAt.toISOString(),
        }))}
      />
      <CopilotShell
        surface="visit"
        noteId={note.id}
        patientId={note.patientId}
        clinicianName={session.user.name ?? null}
        patientFirstName={note.patient.firstName}
      />
    </>
  );
}

type LegacyFinalMap = Record<string, { content: string; updatedAt?: string }>;
type WrapperFinal = {
  sections: Array<{ id: string; label: string; content: string; required?: boolean }>;
  signedAt?: string;
  schemaVersion?: number;
};

function normalizeFinalContent(
  finalJson: unknown,
  sections: NoteSectionDef[],
): Record<string, string> {
  if (!finalJson || typeof finalJson !== 'object') return {};

  const wrapper = finalJson as Partial<WrapperFinal>;
  if (Array.isArray(wrapper.sections)) {
    const out: Record<string, string> = {};
    for (const s of wrapper.sections) {
      if (s && typeof s.id === 'string' && typeof s.content === 'string') {
        out[s.id] = s.content;
      }
    }
    return out;
  }

  // Legacy map shape.
  const map = finalJson as LegacyFinalMap;
  const out: Record<string, string> = {};
  for (const sec of sections) {
    const entry = map[sec.id];
    if (entry && typeof entry.content === 'string') {
      out[sec.id] = entry.content;
    }
  }
  return out;
}
