import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getClinicianSiteIds } from '@/lib/authz/site-scope';
import { EhrLinkPanel } from '@/components/fhir/ehr-link-panel';
import { buildSnapshotStrip } from '@/lib/snapshots/build-snapshot-strip';
import { deriveAssessmentSnippet } from '@/lib/notes/note-text';
import type { FinalJsonShape } from '@/lib/notes/build-artifact-prompt';
import { professionLabel } from '@/lib/professions';
import { PatientChartTabs } from './_components/patient-chart-tabs';

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
      // Unit 11 — include DISCHARGED so the panel can Reopen + show close history.
      episodes: {
        where: { status: { in: ['ACTIVE', 'RECERT_DUE', 'DISCHARGED'] } },
        include: { department: true, goals: { orderBy: { createdAt: 'asc' } } },
        orderBy: [{ status: 'asc' }, { startedAt: 'desc' }],
      },
    },
  });
  if (!patient) notFound();

  // Unit 12 — snapshot strip + visit history with snippets, server-fetched
  // so the first paint has real content. Cross-division stratification:
  // fetch up to 50 most-recent signed visits including clinician identity
  // and episode-of-care (powers the by-episode / by-clinician views).
  const [snapshotStrip, recentVisits, externalContexts] = await Promise.all([
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

  const episodeChoicesForAdd = patient.episodes
    .filter((ep) => ep.status === 'ACTIVE' || ep.status === 'RECERT_DUE')
    .map((ep) => ({
      id: ep.id,
      label: ep.bodyPart ? `${ep.diagnosis} (${ep.bodyPart})` : ep.diagnosis,
    }));

  // Pull visit counts + last-visit-at per active episode so the start-visit
  // picker can show "3 prior visits / last visit 12 days ago" without the
  // client re-fetching. A signed note is the canonical "visit happened"
  // anchor (mirrors VisitHistoryList). Simple single query → roll up
  // in-memory (max 10s of episodes per patient — no real cost).
  const activeEpsForStats = patient.episodes.filter(
    (ep) => ep.status === 'ACTIVE' || ep.status === 'RECERT_DUE',
  );
  const orgId = session.user.orgId;

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
  const activeEpisodesForPicker = await (async () => {
    if (activeEpsForStats.length === 0) return [];
    const epIds = activeEpsForStats.map((e) => e.id);
    const signedNotes = await prisma.note.findMany({
      where: {
        patientId: patient.id,
        orgId,
        status: { in: ['SIGNED', 'TRANSFERRED'] },
        encounter: { episodeOfCareId: { in: epIds } },
      },
      select: {
        signedAt: true,
        encounter: { select: { episodeOfCareId: true } },
      },
    });
    const perEpisode = new Map<string, { count: number; lastVisitAt: Date | null }>();
    for (const ep of activeEpsForStats) perEpisode.set(ep.id, { count: 0, lastVisitAt: null });
    for (const n of signedNotes) {
      const epId = n.encounter?.episodeOfCareId;
      if (!epId) continue;
      const acc = perEpisode.get(epId);
      if (!acc) continue;
      acc.count += 1;
      if (n.signedAt && (!acc.lastVisitAt || n.signedAt > acc.lastVisitAt)) {
        acc.lastVisitAt = n.signedAt;
      }
    }
    return activeEpsForStats.map((ep) => {
      const agg = perEpisode.get(ep.id) ?? { count: 0, lastVisitAt: null };
      return {
        id: ep.id,
        diagnosis: ep.diagnosis,
        bodyPart: ep.bodyPart,
        division: ep.division,
        lastVisitAt: agg.lastVisitAt?.toISOString() ?? null,
        visitCount: agg.count,
      };
    });
  })();

  const episodesForPanel = patient.episodes.map((ep) => ({
    id: ep.id,
    diagnosis: ep.diagnosis,
    bodyPart: ep.bodyPart,
    division: ep.division,
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
    })),
  }));

  return (
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
      episodesForPanel={episodesForPanel}
      externalContextItems={externalContextItems}
      episodeChoicesForAdd={episodeChoicesForAdd}
      visits={visits}
      activeEpisodesForPicker={activeEpisodesForPicker}
      startVisitSites={startVisitSites}
      startVisitDefaultSiteId={startVisitDefaultSiteId}
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
  );
}
