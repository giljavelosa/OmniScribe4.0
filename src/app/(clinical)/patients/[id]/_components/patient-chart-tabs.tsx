'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PatientSex } from '@prisma/client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { UserAvatar } from '@/components/ui/user-avatar';
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
 * Sticky header: identity anchor (row 1) + compact stat strip (row 1.5) +
 * Safety Band with allergies + active problems (row 2).
 *
 * Overview cockpit (Option D): promoted Snapshot inline row showing actual
 * measure values + trend arrows, followed by a clean 2×2 tile grid for
 * Medications / Open follow-ups / Last visit / Prior records. Every tile
 * and the snapshot row open a right-side ChartDetailSheet drill-down.
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
  const measureCount = snapshotStrip?.measures.length ?? 0;
  const snapshotHeadline =
    measureCount > 0
      ? `${measureCount} measure${measureCount === 1 ? '' : 's'}`
      : 'No measures yet';

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
            Tier 1: identity anchor + Start Visit button (row 1).
            Tier 1: Safety Band — allergies + active problems (row 2). */}
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b shadow-sm">
          <div className="mx-auto max-w-6xl px-4 pt-3 pb-1">
            {/* Row 1: patient identity + action */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <UserAvatar
                  firstName={patient.firstName}
                  lastName={patient.lastName}
                  size="sm"
                  className="shrink-0"
                />
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="font-semibold leading-tight truncate">
                    {patient.firstName} {patient.lastName}
                  </span>
                  <StatusBadge variant="neutral" noIcon>
                    {patient.sex} · {age}
                  </StatusBadge>
                  {patient.mrn && (
                    <span className="hidden sm:inline text-xs text-muted-foreground font-mono">
                      MRN {patient.mrn}
                    </span>
                  )}
                  {activeStripEntries.map((d) => (
                    <StatusBadge key={d.key} variant="neutral" noIcon className="hidden lg:inline-flex">
                      {d.label}
                    </StatusBadge>
                  ))}
                </div>
              </div>
              <StartVisitButton
                patientId={patient.id}
                activeCases={activeCasesForPicker}
                viewerDivision={viewerDivision}
                sites={startVisitSites}
                defaultSiteId={startVisitDefaultSiteId}
              />
            </div>

            {/* Row 1.5: Compact stat strip — non-zero values only, so it
                collapses cleanly for patients with no history yet. Order
                prioritizes the most clinically actionable signal first
                (open follow-ups) over reference counts (total visits). */}
            {(() => {
              const stats: Array<{ key: string; n: number; one: string; many: string }> = [];
              if (openFollowUpCount > 0) {
                stats.push({
                  key: 'fu',
                  n: openFollowUpCount,
                  one: 'open follow-up',
                  many: 'open follow-ups',
                });
              }
              if (activeCaseCount > 0) {
                stats.push({
                  key: 'cases',
                  n: activeCaseCount,
                  one: 'active case',
                  many: 'active cases',
                });
              }
              if (totalVisits > 0) {
                stats.push({
                  key: 'v',
                  n: totalVisits,
                  one: 'visit',
                  many: 'visits',
                });
              }
              if (externalContextItems.length > 0) {
                stats.push({
                  key: 'pr',
                  n: externalContextItems.length,
                  one: 'prior record',
                  many: 'prior records',
                });
              }
              if (stats.length === 0) return null;
              return (
                <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground py-0.5">
                  {stats.map((s, i) => (
                    <span key={s.key} className="flex items-center gap-3">
                      {i > 0 && <span aria-hidden="true" className="text-border">·</span>}
                      <span>
                        <span className="font-medium text-foreground">{s.n}</span>{' '}
                        {s.n === 1 ? s.one : s.many}
                      </span>
                    </span>
                  ))}
                </div>
              );
            })()}

            {/* Row 2: Safety Band */}
            <SafetyBand
              activeProblems={activeProblems}
              onOpenProblems={() => setOpenSheet('problems')}
            />
          </div>
        </div>

        {/* ── Tab content ─────────────────────────────────────────────────── */}
        <div className="mx-auto max-w-6xl px-4 py-6">
          {episodeCreatedFlash && (
            <StatusBanner variant="success" className="mb-6">
              Episode created — start visit again to link to it.
            </StatusBanner>
          )}

          <Tabs defaultValue="overview" className="space-y-6">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              {casesForPanel.length > 0 && (
                <TabsTrigger value="cases">
                  Cases{activeCaseCount > 0 ? ` (${activeCaseCount})` : ''}
                </TabsTrigger>
              )}
              <TabsTrigger value="visits">
                Visits{totalVisits > 0 ? ` (${totalVisits})` : ''}
              </TabsTrigger>
              <TabsTrigger value="profile">Profile</TabsTrigger>
            </TabsList>

            {/* ── Overview cockpit ─────────────────────────────────────────── */}
            <TabsContent value="overview" className="space-y-5">
              {/* Sprint 0.14 — Miss Cleo's read. Mounts at the TOP per spec
                  decision 6 (same anchor priority as the safety band). The
                  card is purely informational; tapping the CTA dispatches a
                  global event that CopilotShell listens for and opens the
                  Sheet (see copilot-shell.tsx: 'cleo:open-sheet'). */}
              <CleoReadCard
                patientFirstName={patient.firstName}
                data={cleoRead}
                onAskOpen={() => {
                  if (typeof window === 'undefined') return;
                  window.dispatchEvent(new CustomEvent('cleo:open-sheet'));
                }}
              />
              {/* Division summary line — kept per spec */}
              {totalVisits > 0 && (
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <span className="text-muted-foreground">
                    {totalVisits} signed visit{totalVisits === 1 ? '' : 's'} · Active in:
                  </span>
                  {activeStripEntries.map((d) => (
                    <StatusBadge key={d.key} variant="neutral" noIcon>
                      {d.label} ({visitsByDivision[d.key]})
                    </StatusBadge>
                  ))}
                  {otherCount > 0 && (
                    <StatusBadge variant="neutral" noIcon>
                      Other ({otherCount})
                    </StatusBadge>
                  )}
                </div>
              )}

              {/* Promoted snapshot — spans full width; shows actual measure
                  values + trend arrows instead of just a count tile. The
                  whole card is the click target → SnapshotDetailSheet. */}
              <SnapshotInlineStrip
                strip={snapshotStrip}
                onClick={() => setOpenSheet('snapshot')}
              />

              {/* Remaining 4 tiles — clean 2×2 grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
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
            </TabsContent>

            {casesForPanel.length > 0 && (
              <TabsContent value="cases" className="space-y-3">
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
            <TabsContent value="visits" className="space-y-3">
              <AwaitingRoutingBanner visits={visits} />
              <VisitHistoryList visits={visits} />
            </TabsContent>

            {/* ── Profile ──────────────────────────────────────────────────── */}
            <TabsContent value="profile" className="space-y-4">
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

              {/* EHR link panel — Server Component, rendered in the parent page and
                  passed here as ReactNode so auth/prisma calls stay on the server. */}
              {ehrPanel}

              <Card>
                <CardHeader>
                  <CardTitle className="text-md">Addresses + coverage</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {addresses.length === 0 ? (
                    <p className="text-muted-foreground">No addresses on file.</p>
                  ) : (
                    <ul className="space-y-1">
                      {addresses.map((a) => (
                        <li key={a.id} className="text-muted-foreground">
                          <StatusBadge variant="neutral" noIcon className="mr-2">
                            {a.kind}
                          </StatusBadge>
                          {a.line1}
                          {a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state} {a.postalCode}
                        </li>
                      ))}
                    </ul>
                  )}
                  {coverages.length === 0 ? (
                    <p className="text-muted-foreground">No coverage on file.</p>
                  ) : (
                    <ul className="space-y-1">
                      {coverages.map((c) => (
                        <li key={c.id} className="text-muted-foreground">
                          <StatusBadge
                            variant={
                              c.status === 'ACTIVE'
                                ? 'success'
                                : c.status === 'TERMINATED'
                                  ? 'danger'
                                  : 'warning'
                            }
                            noIcon
                            className="mr-2"
                          >
                            {c.status}
                          </StatusBadge>
                          {c.carrier} · member {c.memberId}
                          {c.planName ? ` (${c.planName})` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
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
