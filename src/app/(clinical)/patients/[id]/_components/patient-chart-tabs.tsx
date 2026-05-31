'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, MapPin } from 'lucide-react';
import type { PatientSex } from '@prisma/client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { SectionLabel } from '@/components/ui/section-label';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { cn } from '@/lib/cn';
import { VisitHistoryList } from '@/components/patients/visit-history-list';
import { AwaitingRoutingBanner } from './awaiting-routing-banner';
import { InlineDemographics } from '@/components/patients/inline-demographics';
import type { VisitHistoryRow } from '@/components/patients/visit-history-list';
import type { PatientSnapshotStrip as PatientSnapshotStripData } from '@/lib/snapshots/types';
import type { ExternalContextSummary } from './external-context-section';
import { CasesPanel, type CasePanelData } from './cases-panel';
import { CleoReadCard, type CleoReadCardData } from './cleo-read-card';
import { ChartNudgeStack } from '@/components/cleo/chart-nudge-stack';
import type { NudgeCardData } from '@/components/cleo/nudge-card';
import { StartVisitButton } from './start-visit-button';
import {
  StartVisitDialog,
  type StartVisitDialogCase,
  type StartVisitDialogSite,
} from './start-visit-dialog';
import type { Profession } from '@prisma/client';
import { divisionForProfession } from '@/lib/professions';
import { SafetyBand } from './safety-band';
import type { ProblemRow } from './safety-band';
import { ChartDetailSheet } from './chart-detail-sheet';
import { FollowUpsSheet } from './follow-ups-sheet';
import type { FollowUpSummary } from './follow-ups-sheet';
import { LastVisitSheet } from './last-visit-sheet';
import { SnapshotDetailSheet } from './snapshot-detail-sheet';
import { PriorRecordsSheet } from './prior-records-sheet';
import { ProblemsSheet } from './problems-sheet';
import { VitalsBoard } from './vitals-board';
import { VisitsSummaryBand } from './visits-summary-band';
import { WorklistCard } from './worklist-card';
import { CaseSpotlightCard } from './case-spotlight-card';
import { LastVisitCard } from './last-visit-card';
import { PatientDeleteCard } from './patient-delete-card';
import { sortCasesByViewerRecency } from '@/lib/case-management/sort';
import type {
  VerifiedAllergyFact,
  VerifiedLabFact,
  VerifiedMedicationFact,
  VerifiedProblemFact,
  VerifiedProcedureFact,
  VerifiedVitalFact,
} from '@/lib/external-context/verified-chart-facts';
import { sourceMatchLabel } from '@/lib/external-context/verified-chart-facts';

// ---------------------------------------------------------------------------
// Local prop types — mirror the Prisma shapes but with ISO strings so the
// server page can safely serialize everything through the component boundary.
// ---------------------------------------------------------------------------

type PatientData = {
  id: string;
  firstName: string;
  lastName: string;
  mrn: string | null;
  dobIso: string;
  sex: PatientSex;
  preferredLanguage: string | null;
  isDeleted: boolean;
  phone: string | null;
  email: string | null;
  siteId: string | null;
  siteName: string | null;
};

type AddressData = {
  id: string;
  kind: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
};

type CoverageData = {
  id: string;
  carrier: string;
  planName: string | null;
  memberId: string;
  status: string;
};

type Props = {
  patient: PatientData;
  addresses: AddressData[];
  coverages: CoverageData[];
  episodeCreatedFlash: boolean;
  snapshotStrip: PatientSnapshotStripData | null;
  casesForPanel: CasePanelData[];
  externalContextItems: ExternalContextSummary[];
  verifiedMedications: VerifiedMedicationFact[];
  verifiedAllergies: VerifiedAllergyFact[];
  verifiedProblems: VerifiedProblemFact[];
  verifiedLabs: VerifiedLabFact[];
  verifiedVitals: VerifiedVitalFact[];
  verifiedProcedures: VerifiedProcedureFact[];
  visits: VisitHistoryRow[];
  followUps: FollowUpSummary[];
  activeCasesForPicker: StartVisitDialogCase[];
  viewingProfession: Profession | null;
  startVisitSites: StartVisitDialogSite[];
  startVisitDefaultSiteId: string | null;
  /** False when the caller's role is VIEWER — hides edit controls in
   *  GoalsSection / GoalRow to prevent the 403-on-save UX trap. */
  canEditEpisodes: boolean;
  /** Patient deletion is organization-admin only. Other patient-management
   *  users can add/edit demographics but cannot erase records from active use. */
  canDeletePatient: boolean;
  /** EhrLinkPanel is a Server Component — passed as rendered ReactNode so it
   *  can live in the Profile tab without breaking the client boundary. */
  ehrPanel: React.ReactNode;
  /** Sprint 0.14 — Miss Cleo's per-(patient × clinician) memory projected
   *  into the card-friendly shape. Null when no state row exists yet —
   *  the card renders an empty-state stub + ASK CTA. */
  cleoRead: CleoReadCardData | null;
  /** Sprint 0.18 — proactive nudges for the (patient × clinician × CHART)
   *  tuple. Empty when no candidates fire — the ChartNudgeStack
   *  renders nothing (decision 10, backward compat for clinicians
   *  whose state-rebuild hasn't yet seeded a candidate). */
  chartNudges: NudgeCardData[];
  initialExternalContextId?: string | null;
};

const DIVISION_DISPLAY = [
  { key: 'MEDICAL', label: 'Medical' },
  { key: 'REHAB', label: 'Rehab' },
  { key: 'BEHAVIORAL_HEALTH', label: 'Behavioral Health' },
];

/** Floating segmented tabs — muted rail with bordered button silhouettes. */
const CHART_TAB_TRIGGER = cn(
  'flex-none h-9 rounded-md border border-foreground/15 px-4',
  'text-sm font-medium text-muted-foreground shadow-none',
  'hover:border-foreground/25 hover:bg-background/70 hover:text-foreground',
  'data-[state=active]:border-foreground/30 data-[state=active]:bg-background',
  'data-[state=active]:font-semibold data-[state=active]:text-foreground',
  'data-[state=active]:shadow-sm after:hidden',
);

function computeAge(dobIso: string): string {
  const dob = new Date(dobIso);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return `${age}y`;
}

function formatRelativeDate(iso: string | null): string {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function formatDateLabel(iso: string): string {
  return iso.slice(0, 10);
}

function formatMedicationDisplay(med: VerifiedMedicationFact): string {
  return [med.name, med.dose, med.route, med.frequency].filter(Boolean).join(' ');
}

function formatDocumentType(documentType: string): string {
  return documentType.replaceAll('_', ' ');
}

function medicationStatusVariant(status: VerifiedMedicationFact['status']) {
  switch (status) {
    case 'current':
      return 'success';
    case 'planned':
    case 'unknown':
      return 'warning';
    case 'historical':
    case 'discontinued':
      return 'neutral';
  }
}

type OpenSheet =
  | 'snapshot'
  | 'medications'
  | 'followUps'
  | 'lastVisit'
  | 'priorRecords'
  | 'problems'
  | null;

/**
 * PatientChartTabs — Sprint 0.9 + 0.10 chart.
 *
 * Sticky header: identity anchor + safety band. Stats and division
 * badges live in tab labels — not duplicated in the chrome.
 *
 * Overview cockpit: clinical snapshot + tile grid first; Cleo's read
 * as a compact assistant strip below the actionable chart data.
 */
export function PatientChartTabs({
  patient,
  addresses,
  coverages,
  episodeCreatedFlash,
  snapshotStrip,
  casesForPanel,
  externalContextItems,
  verifiedMedications,
  verifiedAllergies,
  verifiedProblems,
  verifiedLabs,
  verifiedVitals,
  verifiedProcedures,
  visits,
  followUps,
  activeCasesForPicker,
  viewingProfession,
  startVisitSites,
  startVisitDefaultSiteId,
  canEditEpisodes,
  canDeletePatient,
  ehrPanel,
  cleoRead,
  chartNudges,
  initialExternalContextId = null,
}: Props) {
  const router = useRouter();
  const age = computeAge(patient.dobIso);
  const totalVisits = visits.length;
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null);
  const [initialDetailId, setInitialDetailId] = useState<string | null>(initialExternalContextId);
  /** Set to a case id when the Cases-tab hero's "Continue this case" button
   *  is tapped. Mounts a scoped StartVisitDialog (activeCases = [thatCase])
   *  so the dialog treats it as the 1-case path and skips the picker. */
  const [continueCaseId, setContinueCaseId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialExternalContextId) return;
    // Opening a source-chip deep link is intentional URL-to-UI synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitialDetailId(initialExternalContextId);
    setOpenSheet('priorRecords');
  }, [initialExternalContextId]);

  const visitsByDivision = visits.reduce<Record<string, number>>((acc, v) => {
    acc[v.division] = (acc[v.division] ?? 0) + 1;
    return acc;
  }, {});
  const activeStripEntries = DIVISION_DISPLAY.filter((d) => (visitsByDivision[d.key] ?? 0) > 0);
  const otherCount = Object.entries(visitsByDivision).reduce(
    (acc, [k, n]) => (DIVISION_DISPLAY.some((d) => d.key === k) ? acc : acc + n),
    0,
  );
  const lateEntryCount = visits.filter((v) => v.isLateEntry).length;
  const visitDivisionStats = [
    ...activeStripEntries.map((d) => ({ label: d.label, value: visitsByDivision[d.key] ?? 0 })),
    ...(otherCount > 0 ? [{ label: 'Other', value: otherCount }] : []),
  ];

  const activeCases = casesForPanel.filter((c) => c.status === 'ACTIVE');
  const activeCaseCount = activeCases.length;
  const showCasesTab = casesForPanel.length > 0;
  const viewerDivision = divisionForProfession(viewingProfession);

  const activeProblems: ProblemRow[] = Array.from(
    new Map(
      [
        ...casesForPanel.filter((c) => c.status === 'ACTIVE').map((c) => {
          const label = c.primaryIcd
            ? `${c.primaryIcd} · ${c.primaryIcdLabel}`
            : c.primaryIcdLabel;
          return [
            label,
            {
              id: c.id,
              label,
              sourceKind: 'active_case',
              sourceLabel: 'Active case',
              sourceDate: c.lastActivityAt,
            },
          ] as [string, ProblemRow];
        }),
        ...verifiedProblems.filter((p) => p.status === 'active').map((p) => {
          const label = p.icdHint ? `${p.icdHint} · ${p.text}` : p.text;
          return [
            label,
            {
              id: `verified:${p.id}`,
              label,
              sourceKind: 'verified_uploaded_record',
              sourceLabel: p.sourceLabel ?? formatDocumentType(p.documentType),
              sourceDate: p.dateOfRecordIso,
              pageNumber: p.sourcePage,
            },
          ] as [string, ProblemRow];
        }),
      ],
    ).values(),
  );

  // Overview dashboard — derived values.
  const openFollowUpCount = followUps.filter((f) => f.status === 'OPEN').length;
  const documentRecords = externalContextItems.filter((item) => item.mediaKind === 'DOCUMENT');
  const verifiedDocumentRecords = documentRecords.filter((item) =>
    item.status === 'READY' && item.verifiedAt,
  );
  const verifiedIndexedPageCount = verifiedDocumentRecords.reduce(
    (sum, item) => sum + (item.indexedPageCount ?? 0),
    0,
  );

  const currentVerifiedMedicationCount = verifiedMedications.filter((m) => m.status === 'current').length;
  const medicationHeadline = verifiedMedications.length > 0
    ? currentVerifiedMedicationCount > 0
      ? `${currentVerifiedMedicationCount} current med${currentVerifiedMedicationCount === 1 ? '' : 's'} from verified records`
      : `${verifiedMedications.length} med${verifiedMedications.length === 1 ? '' : 's'} from verified records`
    : verifiedDocumentRecords.length > 0
      ? `Verified uploaded records searchable${verifiedIndexedPageCount > 0 ? ` · ${verifiedIndexedPageCount} pages indexed` : ''}`
    : 'No current meds from signed visits or verified records';

  const lastVisit = visits[0] ?? null;
  const lastVisitTitle = lastVisit?.templateName ?? 'Visit';
  const lastVisitMeta = lastVisit
    ? [formatRelativeDate(lastVisit.signedAt), lastVisit.clinicianName].filter(Boolean).join(' · ')
    : undefined;
  const lastVisitSnippet = lastVisit?.assessmentSnippet ?? undefined;

  // "N signed visits · Rehab (2) · …" — folded out of the old section header.
  const overviewMetaLine = totalVisits > 0
    ? [
        `${totalVisits} signed visit${totalVisits === 1 ? '' : 's'}`,
        ...activeStripEntries.map((d) => `${d.label} (${visitsByDivision[d.key]})`),
        otherCount > 0 ? `Other (${otherCount})` : null,
      ].filter((part): part is string => Boolean(part)).join(' · ')
    : null;

  // The active-case spotlight echoes one active case. Prefer the case whose
  // active rehab episode carries recert/visit caps — so the meters render and
  // it aligns with the episode-scoped snapshot above — falling back to viewer
  // recency when none qualifies. Read-only display selection; nothing mutated.
  const spotlightCase = (() => {
    if (activeCases.length === 0) return null;
    const ranked = sortCasesByViewerRecency(activeCases);
    const withCappedEpisode = ranked.find((c) =>
      c.rehabEpisodes.some(
        (e) =>
          (e.status === 'ACTIVE' || e.status === 'RECERT_DUE') &&
          (e.recertDueAt !== null || (e.visitsAuthorized !== null && e.visitsAuthorized > 0)),
      ),
    );
    return withCappedEpisode ?? ranked[0] ?? null;
  })();

  const documentBatchesNeedingReview = documentRecords.filter((item) =>
    item.status === 'PARTIAL_EXTRACTION_REVIEW',
  ).length;
  const documentsNeedingFinalReview = documentRecords.filter((item) => item.status === 'EXTRACTED').length;
  const documentReviewCount = documentBatchesNeedingReview + documentsNeedingFinalReview;
  const documentReviewPreview = [
    documentBatchesNeedingReview > 0 ? `${documentBatchesNeedingReview} batch review` : null,
    documentsNeedingFinalReview > 0 ? `${documentsNeedingFinalReview} final review` : null,
  ].filter(Boolean).join(' · ') || undefined;
  const recordsActionLabel = documentRecords.length === 0
    ? 'Add outside record'
    : documentReviewCount > 0
      ? 'Review documents'
      : verifiedDocumentRecords.length > 0
        ? `${verifiedDocumentRecords.length} verified record${verifiedDocumentRecords.length === 1 ? '' : 's'}`
        : 'Open records';

  function closeSheet() {
    setOpenSheet(null);
  }

  return (
    <>
      <div>
        {/* ── Sticky mini-header ──────────────────────────────────────────────
            Identity + Start Visit on row 1; Safety Band on row 2. */}
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b">
          <div className="mx-auto max-w-6xl px-4 py-3">
            <div className="flex items-start gap-3">
              <UserAvatar
                firstName={patient.firstName}
                lastName={patient.lastName}
                size="lg"
                className="shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="text-lg font-semibold leading-tight truncate">
                      {patient.firstName} {patient.lastName}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                      {patient.sex} · {age}
                      {patient.mrn && (
                        <>
                          {' · '}
                          <span className="font-mono">MRN {patient.mrn}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <StartVisitButton
                    patientId={patient.id}
                    activeCases={activeCasesForPicker}
                    viewerDivision={viewerDivision}
                    sites={startVisitSites}
                    defaultSiteId={startVisitDefaultSiteId}
                  />
                </div>
              </div>
            </div>

            <SafetyBand
              activeProblems={activeProblems}
              verifiedAllergies={verifiedAllergies}
              onOpenProblems={() => setOpenSheet('problems')}
            />
          </div>
        </div>

        {/* ── Tab content ─────────────────────────────────────────────────── */}
        <div className="mx-auto max-w-6xl px-4 py-5">
          {episodeCreatedFlash && (
            <StatusBanner variant="success" className="mb-6">
              Episode created — start visit again to link to it.
            </StatusBanner>
          )}

          <Tabs defaultValue="overview" className="space-y-5">
            <TabsList
              className={cn(
                'inline-flex w-fit max-w-full flex-wrap items-center justify-start gap-1.5 p-1.5',
                'group-data-[orientation=horizontal]/tabs:h-auto',
                'rounded-xl border border-foreground/15 bg-muted shadow-sm',
              )}
            >
              <TabsTrigger value="overview" className={CHART_TAB_TRIGGER}>
                Overview
              </TabsTrigger>
              {showCasesTab && (
                <TabsTrigger value="cases" className={CHART_TAB_TRIGGER}>
                  Cases{activeCaseCount > 0 ? ` (${activeCaseCount})` : ''}
                </TabsTrigger>
              )}
              <TabsTrigger value="visits" className={CHART_TAB_TRIGGER}>
                Visits{totalVisits > 0 ? ` (${totalVisits})` : ''}
              </TabsTrigger>
              <TabsTrigger value="profile" className={CHART_TAB_TRIGGER}>
                Profile
              </TabsTrigger>
            </TabsList>

            {/* ── Overview dashboard ───────────────────────────────────────
                Vital column (primary: board + case spotlight) + intelligence
                rail (sticky on lg). Two independent columns so neither one's
                height inflates the other — stacks cleanly on mobile. */}
            <TabsContent value="overview" className="mt-0">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
                {/* Primary column — vital board, then the active-case echo. */}
                <div className="min-w-0 space-y-4 lg:col-span-8">
                  <VitalsBoard
                    strip={snapshotStrip}
                    metaLine={overviewMetaLine}
                    medicationHeadline={medicationHeadline}
                    verifiedLabs={verifiedLabs}
                    verifiedVitals={verifiedVitals}
                    verifiedProcedures={verifiedProcedures}
                    verifiedDocumentCount={verifiedDocumentRecords.length}
                    verifiedIndexedPageCount={verifiedIndexedPageCount}
                    onOpen={() => setOpenSheet('snapshot')}
                    onOpenMedications={() => setOpenSheet('medications')}
                  />
                  {spotlightCase && (
                    <CaseSpotlightCard
                      caseRow={spotlightCase}
                      canEdit={canEditEpisodes}
                      onContinueCase={(caseId) => setContinueCaseId(caseId)}
                    />
                  )}
                </div>

                {/* Intelligence rail — sticky on lg. */}
                <div className="min-w-0 space-y-4 lg:col-span-4 lg:sticky lg:top-[var(--chart-rail-top)]">
                  <CleoReadCard
                    patientFirstName={patient.firstName}
                    data={cleoRead}
                    onAskOpen={() => {
                      if (typeof window === 'undefined') return;
                      window.dispatchEvent(new CustomEvent('cleo:open-sheet'));
                    }}
                  />
                  <WorklistCard
                    followUpCount={openFollowUpCount}
                    documentReviewCount={documentReviewCount}
                    documentPreview={documentReviewPreview}
                    recordsActionLabel={recordsActionLabel}
                    onOpenFollowUps={() => setOpenSheet('followUps')}
                    onOpenDocuments={() => setOpenSheet('priorRecords')}
                    onOpenRecords={() => setOpenSheet('priorRecords')}
                  />
                  <LastVisitCard
                    hasVisit={!!lastVisit}
                    headline={lastVisitTitle}
                    meta={lastVisitMeta}
                    snippet={lastVisitSnippet}
                    onOpen={() => setOpenSheet('lastVisit')}
                  />
                </div>
              </div>
            </TabsContent>

            {showCasesTab && (
              <TabsContent value="cases" className="space-y-3 mt-0">
                {/* Sprint 0.18 — proactive nudge stack. Lives ADJACENT
                    to the active-case hero (not inside it) per spec:
                    the hero is "your active case" — singular, primary;
                    the stack is "what else should you notice" —
                    secondary, default-collapsed pill. Decision 10:
                    empty stack renders nothing → byte-identical
                    Sprint-0.16/0.17 chart behavior. */}
                <ChartNudgeStack nudges={chartNudges} />
                <CasesPanel
                  patientId={patient.id}
                  cases={casesForPanel}
                  viewingProfession={viewingProfession}
                  canEdit={canEditEpisodes}
                  onContinueCase={(caseId) => setContinueCaseId(caseId)}
                />
              </TabsContent>
            )}

            {/* ── Visits ───────────────────────────────────────────────────── */}
            <TabsContent value="visits" className="space-y-3 mt-0">
              <AwaitingRoutingBanner visits={visits} />
              <VisitsSummaryBand
                total={totalVisits}
                divisions={visitDivisionStats}
                lateEntryCount={lateEntryCount}
              />
              <VisitHistoryList visits={visits} />
            </TabsContent>

            {/* ── Profile ──────────────────────────────────────────────────── */}
            <TabsContent value="profile" className="space-y-4 mt-0">
              <PatientDeleteCard
                patientId={patient.id}
                patientName={`${patient.firstName} ${patient.lastName}`}
                canDeletePatient={canDeletePatient}
              />

              <InlineDemographics
                patient={{
                  id: patient.id,
                  firstName: patient.firstName,
                  lastName: patient.lastName,
                  mrn: patient.mrn,
                  dob: patient.dobIso,
                  sex: patient.sex,
                  phone: patient.phone,
                  email: patient.email,
                  preferredLanguage: patient.preferredLanguage,
                  siteId: patient.siteId,
                  siteName: patient.siteName,
                }}
                availableSites={startVisitSites}
              />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                {/* EHR link panel — Server Component, rendered in the parent page and
                    passed here as ReactNode so auth/prisma calls stay on the server. */}
                {ehrPanel}

                <Card>
                  <CardHeader>
                    <CardTitle className="text-md">Contact &amp; insurance</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <section className="space-y-2">
                      <SectionLabel>Address</SectionLabel>
                      {addresses.length === 0 ? (
                        <EmptyState
                          size="sm"
                          icon={<MapPin className="size-4" />}
                          title="No address on file"
                        />
                      ) : (
                        <ul className="space-y-2">
                          {addresses.map((a) => (
                            <li key={a.id} className="flex items-start gap-2 text-sm">
                              <StatusBadge variant="neutral" noIcon className="text-2xs shrink-0">
                                {a.kind}
                              </StatusBadge>
                              <span className="text-foreground">
                                {a.line1}
                                {a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state} {a.postalCode}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section className="space-y-2">
                      <SectionLabel>Insurance</SectionLabel>
                      {coverages.length === 0 ? (
                        <EmptyState
                          size="sm"
                          icon={<CreditCard className="size-4" />}
                          title="No coverage on file"
                        />
                      ) : (
                        <ul className="space-y-2">
                          {coverages.map((c) => (
                            <li key={c.id} className="flex items-start gap-2 text-sm">
                              <StatusBadge
                                variant={
                                  c.status === 'ACTIVE'
                                    ? 'success'
                                    : c.status === 'TERMINATED'
                                      ? 'danger'
                                      : 'warning'
                                }
                                noIcon
                                className="text-2xs shrink-0"
                              >
                                {c.status}
                              </StatusBadge>
                              <span className="text-foreground">
                                {c.carrier} · member{' '}
                                <span className="font-mono">{c.memberId}</span>
                                {c.planName ? ` · ${c.planName}` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* ── Cockpit drill-down sheets ──────────────────────────────────────── */}

      <SnapshotDetailSheet
        open={openSheet === 'snapshot'}
        onOpenChange={(o) => { if (!o) closeSheet(); }}
        patientId={patient.id}
        snapshotStrip={snapshotStrip}
      />

      <ChartDetailSheet
        open={openSheet === 'medications'}
        onOpenChange={(o) => { if (!o) closeSheet(); }}
        title="Medications"
      >
        {verifiedMedications.length > 0 ? (
          <div className="space-y-4">
            <StatusBanner variant="info" title="From verified uploaded records">
              These medications were clinician-reviewed from uploaded documents. They are available to the chart
              context, but they are not a connected-EHR medication reconciliation.
            </StatusBanner>
            <ul className="space-y-2">
              {verifiedMedications.map((med) => (
                <li
                  key={med.id}
                  className="rounded-md border border-border bg-background px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 text-sm font-medium text-foreground">
                      {formatMedicationDisplay(med)}
                    </p>
                    <StatusBadge variant={medicationStatusVariant(med.status)} noIcon>
                      {med.status}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Source: {med.sourceLabel ?? formatDocumentType(med.documentType)}
                    <span className="mx-1.5">·</span>
                    {formatDateLabel(med.dateOfRecordIso)}
                    <span className="mx-1.5">·</span>
                    page {med.sourcePage}
                    <span className="mx-1.5">·</span>
                    {sourceMatchLabel(med.confidence)}
                    <span className="mx-1.5">·</span>
                    verified {formatDateLabel(med.verifiedAtIso)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No current medications have been found in signed visits or clinician-verified uploaded records yet.
          </p>
        )}
      </ChartDetailSheet>

      <FollowUpsSheet
        open={openSheet === 'followUps'}
        onOpenChange={(o) => { if (!o) closeSheet(); }}
        followUps={followUps}
      />

      <LastVisitSheet
        open={openSheet === 'lastVisit'}
        onOpenChange={(o) => { if (!o) closeSheet(); }}
        visit={lastVisit}
      />

      <PriorRecordsSheet
        open={openSheet === 'priorRecords'}
        onOpenChange={(o) => { if (!o) closeSheet(); }}
        patientId={patient.id}
        items={externalContextItems}
        canUploadRecords={canEditEpisodes}
        initialDetailId={initialDetailId}
        onInitialDetailConsumed={() => setInitialDetailId(null)}
      />

      <ProblemsSheet
        open={openSheet === 'problems'}
        onOpenChange={(o) => { if (!o) closeSheet(); }}
        problems={activeProblems}
      />

      {/* Sprint 0.13 — "Continue this case" override. Opened from the Cases-
          tab hero card. Sets forceCaseId so the dialog binds explicitly to
          the chosen case (skipping Miss Cleo's case-router); site + rehab-
          episode pickers still render when needed. */}
      {continueCaseId !== null &&
        (() => {
          const c = activeCasesForPicker.find((x) => x.id === continueCaseId);
          if (!c) return null;
          return (
            <StartVisitDialog
              patientId={patient.id}
              activeCases={[c]}
              viewerDivision={viewerDivision}
              sites={startVisitSites}
              defaultSiteId={startVisitDefaultSiteId}
              open
              forceCaseId={c.id}
              onOpenChange={(next) => {
                if (!next) setContinueCaseId(null);
              }}
              onStarted={({ noteId }) => {
                router.push(`/prepare/${noteId}`);
              }}
            />
          );
        })()}
    </>
  );
}
