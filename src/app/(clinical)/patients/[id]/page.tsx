import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getClinicianSiteIds } from '@/lib/authz/site-scope';
import { EhrLinkPanel } from '@/components/fhir/ehr-link-panel';
import { buildSnapshotStrip } from '@/lib/snapshots/build-snapshot-strip';
import { deriveAssessmentSnippet } from '@/lib/notes/note-text';
import type { FinalJsonShape } from '@/lib/notes/build-artifact-prompt';
import { divisionForProfession, professionLabel } from '@/lib/professions';
import { CopilotShell } from '@/components/copilot/copilot-shell';
import { PatientChartTabs } from './_components/patient-chart-tabs';
import type { FollowUpSummary } from './_components/follow-ups-sheet';
import type { CasePanelData } from './_components/cases-panel';
import type { Division } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Patient' };

export default async function PatientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const episodeCreatedFlash = sp.episode_created === '1';
  const session = await auth();
  if (!session?.user?.orgId) return null;

  const patient = await prisma.patient.findFirst({
    where: { id, orgId: session.user.orgId, isDeleted: false },
    include: {
      addresses: true,
      coverages: true,
      // Patient.siteId is just the "default site" — informational. The site
      // of record for each visit is set on the Encounter (StartVisit dialog).
      site: { select: { id: true, name: true } },
      caseManagements: {
        where: { status: { in: ['ACTIVE', 'CLOSED'] } },
        include: {
          episodes: {
            where: { status: { in: ['ACTIVE', 'RECERT_DUE', 'DISCHARGED'] } },
            include: {
              department: true,
              goals: {
                orderBy: { createdAt: 'asc' },
                include: {
                  progressEntries: { orderBy: { recordedAt: 'desc' } },
                },
              },
            },
            orderBy: [{ status: 'asc' }, { startedAt: 'desc' }],
          },
        },
        orderBy: { openedAt: 'desc' },
      },
    },
  });
  if (!patient) notFound();

  // Unit 12 — snapshot strip + visit history with snippets, server-fetched
  // so the first paint has real content. Cross-division stratification:
  // fetch up to 50 most-recent signed visits including clinician identity
  // and episode-of-care (powers the by-episode / by-clinician views).
  const [snapshotStrip, recentVisits, externalContexts, openFollowUps] = await Promise.all([
    buildSnapshotStrip({ orgId: session.user.orgId, patientId: patient.id }),
    prisma.note.findMany({
      where: {
        patientId: patient.id,
        orgId: session.user.orgId,
        status: { in: ['SIGNED', 'TRANSFERRED'] },
      },
      orderBy: { signedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        signedAt: true,
        division: true,
        finalJson: true,
        template: { select: { name: true } },
        // Late-entry charting (spec: context/specs/late-entry-charting.md).
        // Powers the "LATE ENTRY · Nd" chip on the visit-history list — the
        // gap is stamped at note creation so we don't recompute on render.
        isLateEntry: true,
        lateEntryDaysGap: true,
        dateOfService: true,
        // Note.clinicianOrgUserId is a bare FK column (no Prisma relation
        // defined on the Note model). We fetch the id here and resolve
        // identities in a separate query below — adding a relation later
        // would mean a schema migration we don't need for this view.
        clinicianOrgUserId: true,
        encounter: {
          select: {
            caseManagementId: true,
            caseManagement: {
              select: { id: true, primaryIcd: true, primaryIcdLabel: true },
            },
            episode: {
              select: { id: true, diagnosis: true, division: true, status: true },
            },
          },
        },
      },
    }),
    prisma.externalContext.findMany({
      where: { patientId: patient.id, orgId: session.user.orgId },
      orderBy: { dateOfRecord: 'desc' },
      select: {
        id: true,
        dateOfRecord: true,
        source: true,
        sourceLabel: true,
        status: true,
        addedAt: true,
        audioFileKey: true,
        episodeOfCareId: true,
        addedBy: {
          select: {
            id: true,
            user: { select: { email: true, name: true } },
          },
        },
      },
    }),
    // Sprint 0.9 — open follow-ups for the cockpit tile + FollowUpsSheet.
    prisma.followUp.findMany({
      where: { patientId: patient.id, orgId: session.user.orgId, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        text: true,
        status: true,
        createdAt: true,
        originNoteId: true,
        episodeId: true,
        originNote: { select: { signedAt: true } },
      },
    }),
  ]);

  // Resolve clinician identities in one extra query (small N — bounded by
  // the 50-note take above; usually a handful of distinct clinicians).
  const clinicianIds = Array.from(
    new Set(
      recentVisits
        .map((n) => n.clinicianOrgUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const clinicianRows = clinicianIds.length
    ? await prisma.orgUser.findMany({
        where: { id: { in: clinicianIds }, orgId: session.user.orgId },
        select: {
          id: true,
          professionType: true,
          profession: true,
          user: { select: { name: true, email: true } },
        },
      })
    : [];
  const clinicianById = new Map(clinicianRows.map((c) => [c.id, c]));

  const visits = recentVisits.map((n) => {
    const ou = n.clinicianOrgUserId ? clinicianById.get(n.clinicianOrgUserId) ?? null : null;
    const ep = n.encounter?.episode ?? null;
    return {
      id: n.id,
      signedAt: n.signedAt?.toISOString() ?? null,
      division: n.division,
      templateName: n.template?.name ?? null,
      assessmentSnippet: deriveAssessmentSnippet(
        (n.finalJson as unknown as FinalJsonShape) ?? null,
      ),
      isLateEntry: n.isLateEntry,
      lateEntryDaysGap: n.lateEntryDaysGap,
      dateOfService: n.dateOfService.toISOString(),
      clinicianId: ou?.id ?? null,
      clinicianName: ou?.user?.name ?? ou?.user?.email ?? 'Unknown clinician',
      clinicianProfessionLabel: ou?.professionType
        ? professionLabel(ou.professionType)
        : ou?.profession ?? null,
      episodeId: ep?.id ?? null,
      episodeDiagnosis: ep?.diagnosis ?? null,
      episodeDivision: ep?.division ?? null,
      episodeStatus: ep?.status ?? null,
    };
  });

  const externalContextItems = externalContexts.map((r) => ({
    id: r.id,
    dateOfRecord: r.dateOfRecord.toISOString(),
    source: r.source,
    sourceLabel: r.sourceLabel,
    status: r.status,
    addedAt: r.addedAt.toISOString(),
    hasAudio: !!r.audioFileKey,
    episodeOfCareId: r.episodeOfCareId,
    addedBy: {
      orgUserId: r.addedBy.id,
      email: r.addedBy.user.email,
      name: r.addedBy.user.name,
    },
  }));

  const followUpItems: FollowUpSummary[] = openFollowUps.map((fu) => ({
    id: fu.id,
    text: fu.text,
    status: fu.status,
    createdAt: fu.createdAt.toISOString(),
    originNoteId: fu.originNoteId,
    originNoteSignedAt: fu.originNote?.signedAt?.toISOString() ?? null,
    episodeId: fu.episodeId,
  }));

  // Pull visit counts + last-visit-at per active episode so the start-visit
  // picker can show "3 prior visits / last visit 12 days ago" without the
  // client re-fetching. A signed note is the canonical "visit happened"
  // anchor (mirrors VisitHistoryList). Simple single query → roll up
  // in-memory (max 10s of episodes per patient — no real cost).
  const orgId = session.user.orgId;
  const viewerOrgUserId = session.user.orgUserId ?? null;
  const viewerDivision = divisionForProfession(session.user.professionType ?? null);

  const activeCasesRaw = patient.caseManagements.filter((c) => c.status === 'ACTIVE');
  const caseIds = patient.caseManagements.map((c) => c.id);
  const rehabEpIds = patient.caseManagements.flatMap((c) =>
    c.episodes
      .filter((ep) => ep.status === 'ACTIVE' || ep.status === 'RECERT_DUE')
      .map((ep) => ep.id),
  );

  // StartVisit-dialog needs the caller's pickable sites + a sensible default.
  // ORG_ADMIN+ get all non-archived sites; site-scoped roles get just their
  // enrollments. Default site precedence for the picker:
  //   patient.siteId (if set + still in scope) → caller's primary enrolled
  //   site → first pickable.
  const siteScope = session.user.orgUserId
    ? await getClinicianSiteIds(session.user.orgUserId, orgId)
    : { scope: 'all' as const, siteIds: [] as string[] };
  const startVisitSites = await prisma.site.findMany({
    where: {
      orgId,
      isArchived: false,
      ...(siteScope.scope === 'enrolled' && siteScope.siteIds.length > 0
        ? { id: { in: siteScope.siteIds } }
        : {}),
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  const startVisitDefaultSiteId =
    (patient.siteId && startVisitSites.some((s) => s.id === patient.siteId)
      ? patient.siteId
      : null) ??
    (siteScope.scope === 'enrolled' && siteScope.siteIds.length > 0
      ? siteScope.siteIds[0]!
      : startVisitSites[0]?.id ?? null);
  const signedNotesForCases = caseIds.length
    ? await prisma.note.findMany({
        where: {
          patientId: patient.id,
          orgId,
          status: { in: ['SIGNED', 'TRANSFERRED'] },
          encounter: { caseManagementId: { in: caseIds } },
        },
        select: {
          signedAt: true,
          division: true,
          clinicianOrgUserId: true,
          encounter: {
            select: { caseManagementId: true, episodeOfCareId: true },
          },
        },
      })
    : [];

  const perEpisode = new Map<string, { count: number; lastVisitAt: Date | null }>();
  for (const epId of rehabEpIds) perEpisode.set(epId, { count: 0, lastVisitAt: null });
  for (const n of signedNotesForCases) {
    const epId = n.encounter?.episodeOfCareId;
    if (!epId) continue;
    const acc = perEpisode.get(epId);
    if (!acc) continue;
    acc.count += 1;
    if (n.signedAt && (!acc.lastVisitAt || n.signedAt > acc.lastVisitAt)) {
      acc.lastVisitAt = n.signedAt;
    }
  }

  const mapEpisode = (ep: (typeof patient.caseManagements)[0]['episodes'][0]) => ({
    id: ep.id,
    diagnosis: ep.diagnosis,
    bodyPart: ep.bodyPart,
    division: ep.division as Division,
    status: ep.status,
    recertDueAt: ep.recertDueAt?.toISOString() ?? null,
    recertIntervalDays: ep.recertIntervalDays,
    visitsAuthorized: ep.visitsAuthorized,
    visitsCompleted: ep.visitsCompleted,
    closeReason: ep.closeReason,
    reopenReason: ep.reopenReason,
    department: { name: ep.department.name },
    goals: ep.goals.map((g) => ({
      id: g.id,
      goalType: g.goalType,
      goalText: g.goalText,
      status: g.status,
      currentMeasure: g.currentMeasure,
      targetMeasure: g.targetMeasure,
      progressEntries: g.progressEntries.map((pe) => ({
        id: pe.id,
        measureValue: pe.measureValue,
        statusAtEntry: pe.statusAtEntry,
        deltaNote: pe.deltaNote,
        recordedAt: pe.recordedAt.toISOString(),
      })),
    })),
  });

  const activeCasesForPicker = activeCasesRaw.map((c) => {
    const activeEps = c.episodes.filter(
      (ep) => ep.status === 'ACTIVE' || ep.status === 'RECERT_DUE',
    );
    const caseNotes = signedNotesForCases.filter(
      (n) => n.encounter?.caseManagementId === c.id,
    );
    // Same three-tier recency signals the chart's CasesPanel uses, so the
    // StartVisitDialog can pre-select the "Your active case" — pick matches
    // the hero pick on the chart. Cf. src/lib/case-management/sort.ts.
    const viewerNotes = viewerOrgUserId
      ? caseNotes.filter((n) => n.clinicianOrgUserId === viewerOrgUserId)
      : [];
    const viewerDivNotes = viewerDivision
      ? caseNotes.filter((n) => n.division === viewerDivision)
      : [];
    const reduceLast = (notes: typeof caseNotes): Date | null =>
      notes.reduce<Date | null>((best, n) => {
        if (!n.signedAt) return best;
        return !best || n.signedAt > best ? n.signedAt : best;
      }, null);
    const lastActivity = reduceLast(caseNotes);
    const viewerLast = reduceLast(viewerNotes);
    const viewerDivLast = reduceLast(viewerDivNotes);
    return {
      id: c.id,
      primaryIcd: c.primaryIcd,
      primaryIcdLabel: c.primaryIcdLabel,
      secondaryIcd: c.secondaryIcd,
      lastActivityAt: lastActivity?.toISOString() ?? null,
      viewerLastActivityAt: viewerLast?.toISOString() ?? null,
      viewerDivisionLastActivityAt: viewerDivLast?.toISOString() ?? null,
      episodes: activeEps.map((ep) => {
        const agg = perEpisode.get(ep.id) ?? { count: 0, lastVisitAt: null };
        return {
          id: ep.id,
          diagnosis: ep.diagnosis,
          bodyPart: ep.bodyPart,
          division: ep.division as Division,
          lastVisitAt: agg.lastVisitAt?.toISOString() ?? null,
          visitCount: agg.count,
        };
      }),
    };
  });

  const casesForPanel: CasePanelData[] = patient.caseManagements.map((c) => {
    const caseNotes = signedNotesForCases.filter(
      (n) => n.encounter?.caseManagementId === c.id,
    );
    const viewerNotes = viewerOrgUserId
      ? caseNotes.filter((n) => n.clinicianOrgUserId === viewerOrgUserId)
      : [];
    const viewerDivNotes = viewerDivision
      ? caseNotes.filter((n) => n.division === viewerDivision)
      : [];
    const lastActivity = caseNotes.reduce<Date | null>((best, n) => {
      if (!n.signedAt) return best;
      return !best || n.signedAt > best ? n.signedAt : best;
    }, null);
    const viewerLast = viewerNotes.reduce<Date | null>((best, n) => {
      if (!n.signedAt) return best;
      return !best || n.signedAt > best ? n.signedAt : best;
    }, null);
    const viewerDivLast = viewerDivNotes.reduce<Date | null>((best, n) => {
      if (!n.signedAt) return best;
      return !best || n.signedAt > best ? n.signedAt : best;
    }, null);
    return {
      id: c.id,
      primaryIcd: c.primaryIcd,
      primaryIcdLabel: c.primaryIcdLabel,
      secondaryIcd: c.secondaryIcd,
      secondaryIcdLabel: c.secondaryIcdLabel,
      description: c.description,
      status: c.status,
      viewerLastActivityAt: viewerLast?.toISOString() ?? null,
      viewerDivisionLastActivityAt: viewerDivLast?.toISOString() ?? null,
      lastActivityAt: lastActivity?.toISOString() ?? null,
      medicalVisitCount: caseNotes.filter((n) => n.division === 'MEDICAL').length,
      bhVisitCount: caseNotes.filter((n) => n.division === 'BEHAVIORAL_HEALTH').length,
      rehabEpisodes: c.episodes.map(mapEpisode),
    };
  });

  // Phase 3 — anchor Miss Cleo to the patient's most-recent signed
  // visit. The /api/copilot/ask contract requires a noteId because
  // every audit row anchors there; reusing visits[0].id keeps the
  // backend unchanged. Patients with zero signed notes intentionally
  // render no beacon at all — there's nothing source-grounded for
  // Cleo to cite from yet, so showing a broken beacon would be
  // worse UX than no beacon. Document this here so the next agent
  // doesn't reflexively add a "Cleo unavailable" tile.
  const lastSignedNoteId = visits[0]?.id ?? null;

  return (
    <>
      <PatientChartTabs
        patient={{
          id: patient.id,
          firstName: patient.firstName,
          lastName: patient.lastName,
          mrn: patient.mrn,
          dobIso: patient.dob.toISOString(),
          sex: patient.sex,
          preferredLanguage: patient.preferredLanguage,
          isDeleted: patient.isDeleted,
          phone: patient.phone,
          email: patient.email,
          siteId: patient.siteId,
          siteName: patient.site?.name ?? null,
        }}
        addresses={patient.addresses.map((a) => ({
          id: a.id,
          kind: a.kind,
          line1: a.line1,
          line2: a.line2,
          city: a.city,
          state: a.state,
          postalCode: a.postalCode,
        }))}
        coverages={patient.coverages.map((c) => ({
          id: c.id,
          carrier: c.carrier,
          planName: c.planName,
          memberId: c.memberId,
          status: c.status,
        }))}
        episodeCreatedFlash={episodeCreatedFlash}
        snapshotStrip={snapshotStrip}
        casesForPanel={casesForPanel}
        externalContextItems={externalContextItems}
        visits={visits}
        followUps={followUpItems}
        activeCasesForPicker={activeCasesForPicker}
        viewingProfession={session.user.professionType ?? null}
        startVisitSites={startVisitSites}
        startVisitDefaultSiteId={startVisitDefaultSiteId}
        canEditEpisodes={session.user.role !== 'VIEWER'}
        ehrPanel={
          <EhrLinkPanel
            patientId={patient.id}
            patient={{
              firstName: patient.firstName,
              lastName: patient.lastName,
              mrn: patient.mrn,
              dobIso: patient.dob.toISOString(),
            }}
          />
        }
      />
      {lastSignedNoteId && (
        <CopilotShell
          surface="patient-cockpit"
          noteId={lastSignedNoteId}
          patientId={patient.id}
          clinicianName={session.user.name ?? null}
          patientFirstName={patient.firstName}
        />
      )}
    </>
  );
}
