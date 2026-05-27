import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { divisionForProfession } from '@/lib/professions';
import { readSectionStatus, readInferenceLog } from '@/lib/notes/section-status';
import type { NoteSectionDef } from '@/lib/notes/build-prompt';
import { CopilotShell } from '@/components/copilot/copilot-shell';
import type { CopilotFollowUp } from '@/components/copilot/cards/open-followups-card';
import type { NextVisitFollowUp } from './_components/follow-ups-for-next-visit';
import { hasPlanFollowUps } from '@/lib/notes/has-plan-followups';
import { ReviewClient } from './_components/review-client';
import type {
  CaseRouterRunDTO,
  CaseRouterPanelCase,
  ProposalDTO,
} from './_components/case-routing-panel';

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
      encounter: {
        select: {
          caseManagementId: true,
          // Drives the pre-sign reminder banner: when the encounter is still
          // bound to a PENDING_ROUTER case, the clinician hasn't accepted
          // Miss Cleo's proposal yet, and Sprint 0.13 Decision 3 says
          // routing must lock before sign.
          caseManagement: { select: { status: true } },
        },
      },
      caseRouterRun: true,
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

  // Live open follow-ups from PRIOR notes — feeds the "Open follow-ups from
  // last visit" sidebar card. Excludes rows originated by THIS note (those
  // belong in the new "Follow-ups for next visit" card below).
  const openFollowUps = await prisma.followUp.findMany({
    where: {
      patientId: note.patientId,
      orgId: session.user.orgId,
      status: 'OPEN',
      originNoteId: { not: note.id },
    },
    orderBy: { createdAt: 'desc' },
    include: { originNote: { select: { signedAt: true } } },
    take: 20,
  });
  const copilotFollowUps: CopilotFollowUp[] = openFollowUps
    // Defensive narrowing: the WHERE clause filters status='OPEN' so PROPOSED
    // rows can't appear here in practice, but Prisma's emitted FollowUpStatus
    // union still includes PROPOSED. Filtering at the map keeps the type
    // boundary explicit + survives future query edits.
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

  // Follow-ups the clinician has already pre-staged for the NEXT visit from
  // this current note (or that the copilot draft-confirm flow created with
  // originNoteId === this note). Feeds the new FollowUpsForNextVisit card.
  const nextVisitRows = await prisma.followUp.findMany({
    where: { originNoteId: note.id, orgId: session.user.orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, text: true, status: true, createdAt: true },
  });
  const nextVisitFollowUps: NextVisitFollowUp[] = nextVisitRows.map((r) => ({
    id: r.id,
    text: r.text,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));

  // Sprint 0.13 — Miss Cleo's case-routing panel state. Server-render the
  // CaseRouterRun if the worker fired before the page loaded; the panel
  // polls a GET endpoint for late-arrivers. Active cases are scoped to
  // the patient + exclude the encounter's currently-bound PENDING_ROUTER
  // case so the manual picker only surfaces bindable destinations.
  const initialRouterRun: CaseRouterRunDTO | null = note.caseRouterRun
    ? {
        id: note.caseRouterRun.id,
        confidence: note.caseRouterRun.confidence,
        reasoning: note.caseRouterRun.reasoning,
        modelVersion: note.caseRouterRun.modelVersion,
        createdAt: note.caseRouterRun.createdAt.toISOString(),
        acceptedAction: note.caseRouterRun.acceptedAction,
        acceptedAt: note.caseRouterRun.acceptedAt?.toISOString() ?? null,
        proposalJson: note.caseRouterRun.proposalJson as unknown as ProposalDTO,
      }
    : null;
  const currentCaseManagementId = note.encounter?.caseManagementId ?? null;
  const currentCaseManagementStatus = note.encounter?.caseManagement?.status ?? null;
  // Unit 49 §E — viewer-division filter for the case picker. Off-division
  // cases are silently hidden so the clinician can't accidentally route a
  // visit into a case they're not allowed to write to (the API gate would
  // also reject it, but the silent filter keeps the picker short).
  const viewerDivisionForCasePicker = divisionForProfession(
    session.user.professionType ?? null,
  );
  const initialActiveCasesRaw = await prisma.caseManagement.findMany({
    where: {
      orgId: session.user.orgId,
      patientId: note.patientId,
      status: 'ACTIVE',
      ...(currentCaseManagementId ? { id: { not: currentCaseManagementId } } : {}),
      ...(viewerDivisionForCasePicker
        ? { division: { in: [viewerDivisionForCasePicker, 'MULTI'] } }
        : {}),
    },
    orderBy: { openedAt: 'desc' },
    select: {
      id: true,
      primaryIcd: true,
      primaryIcdLabel: true,
      secondaryIcd: true,
      secondaryIcdLabel: true,
    },
  });
  const initialActiveCases: CaseRouterPanelCase[] = initialActiveCasesRaw.map((c) => ({
    id: c.id,
    primaryIcd: c.primaryIcd,
    primaryIcdLabel: c.primaryIcdLabel,
    secondaryIcd: c.secondaryIcd,
    secondaryIcdLabel: c.secondaryIcdLabel,
  }));

  // Soft-nudge gate: does the Plan section text mention a follow-up?
  // Reads draftJson (pre-sign) or finalJson (signed). The Plan section is
  // identified by label regex (matches the FollowupExtractor's behavior).
  const planSectionDef = sections.find((s) => /plan/i.test(s.label));
  const draftMap =
    (note.draftJson as Record<string, { content: string }> | null) ?? null;
  const finalMap =
    (note.finalJson as Record<string, { content: string }> | null) ?? null;
  const planContent = planSectionDef
    ? draftMap?.[planSectionDef.id]?.content ?? finalMap?.[planSectionDef.id]?.content ?? ''
    : '';
  const planHasFollowUps = hasPlanFollowUps(planContent);

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
            id: note.patient.id,
            firstName: note.patient.firstName,
            lastName: note.patient.lastName,
            mrn: note.patient.mrn,
            dob: note.patient.dob.toISOString(),
            sex: note.patient.sex,
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
          isLateEntry: note.isLateEntry,
          lateEntryDaysGap: note.lateEntryDaysGap,
          dateOfService: note.dateOfService.toISOString(),
          signedAt: note.signedAt?.toISOString() ?? null,
        }}
        copilotFollowUps={copilotFollowUps}
        nextVisitFollowUps={nextVisitFollowUps}
        planHasFollowUps={planHasFollowUps}
        initialRouterRun={initialRouterRun}
        initialRouterActiveCases={initialActiveCases}
        initialCurrentCaseManagementId={currentCaseManagementId}
        initialCurrentCaseManagementStatus={currentCaseManagementStatus}
      />
      <CopilotShell
        surface="review"
        noteId={note.id}
        patientId={note.patientId}
        clinicianName={session.user.name ?? null}
        patientFirstName={note.patient.firstName}
      />
    </>
  );
}
