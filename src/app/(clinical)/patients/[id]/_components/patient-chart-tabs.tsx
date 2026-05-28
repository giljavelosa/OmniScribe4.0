'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PatientSex } from '@prisma/client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { SectionLabel } from '@/components/ui/section-label';
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
import { CockpitTile } from './cockpit-tile';
import { ChartDetailSheet } from './chart-detail-sheet';
import { FollowUpsSheet } from './follow-ups-sheet';
import type { FollowUpSummary } from './follow-ups-sheet';
import { LastVisitSheet } from './last-visit-sheet';
import { SnapshotDetailSheet } from './snapshot-detail-sheet';
import { PriorRecordsSheet } from './prior-records-sheet';
import { ProblemsSheet } from './problems-sheet';
import { SnapshotInlineStrip } from './snapshot-inline-strip';

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

type GoalProgressEntryData = {
  id: string;
  measureValue: string | null;
  statusAtEntry: string | null;
  deltaNote: string | null;
  recordedAt: string; // ISO
};

type Props = {
  patient: PatientData;
  addresses: AddressData[];
  coverages: CoverageData[];
  episodeCreatedFlash: boolean;
  snapshotStrip: PatientSnapshotStripData | null;
  casesForPanel: CasePanelData[];
  externalContextItems: ExternalContextSummary[];
  visits: VisitHistoryRow[];
  followUps: FollowUpSummary[];
  activeCasesForPicker: StartVisitDialogCase[];
  viewingProfession: Profession | null;
  startVisitSites: StartVisitDialogSite[];
  startVisitDefaultSiteId: string | null;
  /** False when the caller's role is VIEWER — hides edit controls in
   *  GoalsSection / GoalRow to prevent the 403-on-save UX trap. */
  canEditEpisodes: boolean;
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
  visits,
  followUps,
  activeCasesForPicker,
  viewingProfession,
  startVisitSites,
  startVisitDefaultSiteId,
  canEditEpisodes,
  ehrPanel,
  cleoRead,
  chartNudges,
}: Props) {
  const router = useRouter();
  const age = computeAge(patient.dobIso);
  const totalVisits = visits.length;
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null);
  /** Set to a case id when the Cases-tab hero's "Continue this case" button
   *  is tapped. Mounts a scoped StartVisitDialog (activeCases = [thatCase])
   *  so the dialog treats it as the 1-case path and skips the picker. */
  const [continueCaseId, setContinueCaseId] = useState<string | null>(null);

  const visitsByDivision = visits.reduce<Record<string, number>>((acc, v) => {
    acc[v.division] = (acc[v.division] ?? 0) + 1;
    return acc;
  }, {});
  const activeStripEntries = DIVISION_DISPLAY.filter((d) => (visitsByDivision[d.key] ?? 0) > 0);
  const otherCount = Object.entries(visitsByDivision).reduce(
    (acc, [k, n]) => (DIVISION_DISPLAY.some((d) => d.key === k) ? acc : acc + n),
    0,
  );

  const activeCaseCount = casesForPanel.filter((c) => c.status === 'ACTIVE').length;
  const showCasesTab = casesForPanel.length > 0;
  const viewerDivision = divisionForProfession(viewingProfession);

  const activeProblems: ProblemRow[] = Array.from(
    new Map(
      casesForPanel
        .filter((c) => c.status === 'ACTIVE')
        .map((c) => {
          const label = c.primaryIcd
            ? `${c.primaryIcd} · ${c.primaryIcdLabel}`
            : c.primaryIcdLabel;
          return [label, { id: c.id, label }] as [string, ProblemRow];
        }),
    ).values(),
  );

  // Cockpit tile headlines
  const openFollowUpCount = followUps.filter((f) => f.status === 'OPEN').length;
  const followUpsHeadline =
    openFollowUpCount > 0 ? `Open follow-ups (${openFollowUpCount})` : 'None open';

  const lastVisit = visits[0] ?? null;
  const lastVisitHeadline = lastVisit
    ? `${formatRelativeDate(lastVisit.signedAt)}${lastVisit.templateName ? ` — ${lastVisit.templateName}` : ''}`
    : 'No visits yet';

  const priorRecordsHeadline =
    externalContextItems.length > 0
      ? `Prior records (${externalContextItems.length})`
      : 'None on file';

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
                size="md"
                className="shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="text-md font-semibold leading-tight truncate">
                      {patient.firstName} {patient.lastName}
                    </h1>
                    <p className="text-xs text-muted-foreground mt-0.5">
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
                'inline-flex h-auto w-fit max-w-full flex-wrap items-center justify-start gap-1.5 p-1.5',
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

            {/* ── Overview cockpit ─────────────────────────────────────────── */}
            <TabsContent value="overview" className="space-y-6 mt-0">
              <section className="space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <SectionLabel>At a glance</SectionLabel>
                  {totalVisits > 0 && (
                    <p className="text-2xs text-muted-foreground">
                      {totalVisits} signed visit{totalVisits === 1 ? '' : 's'}
                      {activeStripEntries.length > 0 && (
                        <>
                          {' · '}
                          {activeStripEntries
                            .map((d) => `${d.label} (${visitsByDivision[d.key]})`)
                            .join(' · ')}
                          {otherCount > 0 ? ` · Other (${otherCount})` : ''}
                        </>
                      )}
                    </p>
                  )}
                </div>

                <SnapshotInlineStrip
                  strip={snapshotStrip}
                  onClick={() => setOpenSheet('snapshot')}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <CockpitTile
                    label="Medications"
                    headline="Not recorded — connect an EHR"
                    onClick={() => setOpenSheet('medications')}
                  />
                  <CockpitTile
                    label="Open follow-ups"
                    headline={followUpsHeadline}
                    onClick={() => setOpenSheet('followUps')}
                  />
                  <CockpitTile
                    label="Last visit"
                    headline={lastVisitHeadline}
                    onClick={() => setOpenSheet('lastVisit')}
                  />
                  <CockpitTile
                    label="Prior records"
                    headline={priorRecordsHeadline}
                    onClick={() => setOpenSheet('priorRecords')}
                  />
                </div>
              </section>

              <section className="space-y-2">
                <SectionLabel>Assistant</SectionLabel>
                <CleoReadCard
                  patientFirstName={patient.firstName}
                  data={cleoRead}
                  onAskOpen={() => {
                    if (typeof window === 'undefined') return;
                    window.dispatchEvent(new CustomEvent('cleo:open-sheet'));
                  }}
                />
              </section>
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
              <VisitHistoryList visits={visits} />
            </TabsContent>

            {/* ── Profile ──────────────────────────────────────────────────── */}
            <TabsContent value="profile" className="space-y-4 mt-0">
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
                        <p className="text-sm text-muted-foreground">No address on file.</p>
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
                        <p className="text-sm text-muted-foreground">No coverage on file.</p>
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

      {/* Medications — Phase 1: "not connected" placeholder */}
      <ChartDetailSheet
        open={openSheet === 'medications'}
        onOpenChange={(o) => { if (!o) closeSheet(); }}
        title="Medications"
      >
        <p className="text-sm text-muted-foreground">
          Medication data will be available once an EHR is connected. Use the Profile tab
          to link your EHR system.
        </p>
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
