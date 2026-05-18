import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { PatientIdentityHeader } from '@/components/patients/patient-identity-header';
import { StartVisitButton } from './_components/start-visit-button';
import { EpisodesPanel } from './_components/episodes-panel';
import {
  ExternalContextSection,
  type ExternalContextSummary,
} from './_components/external-context-section';
import { PatientSnapshotStrip } from '@/components/patients/snapshot-strip';
import { VisitHistoryList } from '@/components/patients/visit-history-list';
import { InlineDemographics } from '@/components/patients/inline-demographics';
import { EhrLinkPanel } from '@/components/fhir/ehr-link-panel';
import { buildSnapshotStrip } from '@/lib/snapshots/build-snapshot-strip';
import { deriveAssessmentSnippet } from '@/lib/notes/note-text';
import type { FinalJsonShape } from '@/lib/notes/build-artifact-prompt';

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
  // so the first paint has real content.
  const [snapshotStrip, recentVisits, externalContexts] = await Promise.all([
    buildSnapshotStrip({ orgId: session.user.orgId, patientId: patient.id }),
    prisma.note.findMany({
      where: {
        patientId: patient.id,
        orgId: session.user.orgId,
        status: { in: ['SIGNED', 'TRANSFERRED'] },
      },
      orderBy: { signedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        signedAt: true,
        division: true,
        finalJson: true,
        template: { select: { name: true } },
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

  const visits = recentVisits.map((n) => ({
    id: n.id,
    signedAt: n.signedAt?.toISOString() ?? null,
    division: n.division,
    templateName: n.template?.name ?? null,
    assessmentSnippet: deriveAssessmentSnippet(
      (n.finalJson as unknown as FinalJsonShape) ?? null,
    ),
  }));

  const externalContextItems: ExternalContextSummary[] = externalContexts.map((r) => ({
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
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <PatientIdentityHeader patient={patient} />

      {episodeCreatedFlash && (
        <StatusBanner variant="success">
          Episode created — start visit again to link to it.
        </StatusBanner>
      )}

      <div className="flex justify-end">
        <StartVisitButton patientId={patient.id} activeEpisodes={activeEpisodesForPicker} />
      </div>

      {/* Snapshot strip — first visual after identity, full-width. */}
      <PatientSnapshotStrip patientId={patient.id} strip={snapshotStrip} />

      {/* Two-column desktop / single-column mobile:
            primary content (episodes + visits + demographics) left
            reference cards right slot reserved for future watch/goals roll-up */}
      <div className="grid lg:grid-cols-[1fr_20rem] gap-4">
        <div className="space-y-4 min-w-0">
          <EpisodesPanel
            patientId={patient.id}
            patientDivision={patient.division}
            episodes={episodesForPanel}
          />

          <ExternalContextSection
            patientId={patient.id}
            episodeChoices={episodeChoicesForAdd}
            initialItems={externalContextItems}
          />

          <VisitHistoryList visits={visits} />

          <InlineDemographics
            patient={{
              id: patient.id,
              firstName: patient.firstName,
              lastName: patient.lastName,
              mrn: patient.mrn,
              dob: patient.dob.toISOString(),
              sex: patient.sex,
              phone: patient.phone,
              email: patient.email,
              preferredLanguage: patient.preferredLanguage,
            }}
          />

          <EhrLinkPanel
            patientId={patient.id}
            patient={{
              firstName: patient.firstName,
              lastName: patient.lastName,
              mrn: patient.mrn,
              dobIso: patient.dob.toISOString(),
            }}
          />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-md">Addresses + coverage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {patient.addresses.length === 0 ? (
                <p className="text-muted-foreground">No addresses on file.</p>
              ) : (
                <ul className="space-y-1">
                  {patient.addresses.map((a) => (
                    <li key={a.id} className="text-muted-foreground">
                      <StatusBadge variant="neutral" noIcon className="mr-2">{a.kind}</StatusBadge>
                      {a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state} {a.postalCode}
                    </li>
                  ))}
                </ul>
              )}
              {patient.coverages.length === 0 ? (
                <p className="text-muted-foreground">No coverage on file.</p>
              ) : (
                <ul className="space-y-1">
                  {patient.coverages.map((c) => (
                    <li key={c.id} className="text-muted-foreground">
                      <StatusBadge
                        variant={c.status === 'ACTIVE' ? 'success' : c.status === 'TERMINATED' ? 'danger' : 'warning'}
                        noIcon
                        className="mr-2"
                      >
                        {c.status}
                      </StatusBadge>
                      {c.carrier} · member {c.memberId}{c.planName ? ` (${c.planName})` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
