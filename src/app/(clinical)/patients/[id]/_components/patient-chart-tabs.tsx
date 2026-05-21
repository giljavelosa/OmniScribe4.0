'use client';

import React from 'react';
import type { PatientSex } from '@prisma/client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { UserAvatar } from '@/components/ui/user-avatar';
import { PatientIdentityHeader } from '@/components/patients/patient-identity-header';
import { PatientSnapshotStrip } from '@/components/patients/snapshot-strip';
import { VisitHistoryList } from '@/components/patients/visit-history-list';
import { InlineDemographics } from '@/components/patients/inline-demographics';
import type { VisitHistoryRow } from '@/components/patients/visit-history-list';
import type { PatientSnapshotStrip as PatientSnapshotStripData } from '@/lib/snapshots/types';
import { ExternalContextSection } from './external-context-section';
import type { ExternalContextSummary } from './external-context-section';
import { EpisodesPanel } from './episodes-panel';
import { StartVisitButton } from './start-visit-button';
import type { StartVisitDialogEpisode, StartVisitDialogSite } from './start-visit-dialog';

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

type EpisodeGoalData = {
  id: string;
  goalType: 'STG' | 'LTG';
  goalText: string;
  status: 'ACTIVE' | 'MET' | 'NOT_MET' | 'MODIFIED' | 'DISCONTINUED' | 'PARTIALLY_MET';
  currentMeasure: string | null;
  targetMeasure: string | null;
};

type EpisodeData = {
  id: string;
  diagnosis: string;
  bodyPart: string | null;
  division: string;
  status: 'ACTIVE' | 'RECERT_DUE' | 'DISCHARGED' | 'CANCELLED';
  recertDueAt: string | null;
  recertIntervalDays: number;
  visitsAuthorized: number | null;
  visitsCompleted: number;
  closeReason: string | null;
  reopenReason: string | null;
  department: { name: string };
  goals: EpisodeGoalData[];
};

type Props = {
  patient: PatientData;
  addresses: AddressData[];
  coverages: CoverageData[];
  episodeCreatedFlash: boolean;
  snapshotStrip: PatientSnapshotStripData | null;
  episodesForPanel: EpisodeData[];
  externalContextItems: ExternalContextSummary[];
  episodeChoicesForAdd: { id: string; label: string }[];
  visits: VisitHistoryRow[];
  activeEpisodesForPicker: StartVisitDialogEpisode[];
  startVisitSites: StartVisitDialogSite[];
  startVisitDefaultSiteId: string | null;
  /** EhrLinkPanel is a Server Component — passed as rendered ReactNode so it
   *  can live in the Profile tab without breaking the client boundary. */
  ehrPanel: React.ReactNode;
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

/**
 * PatientChartTabs — Sprint 0.8 chart modernisation.
 *
 * Converts the old long stacked chart into a tabbed layout with a sticky
 * patient-anchor mini-header so the patient name + Start visit button are
 * always reachable while the clinician drills into any tab section.
 *
 * Four tabs:
 *   Overview  — identity, visit-division summary, snapshot strip, prior context
 *   Episodes  — episodes of care + goal management
 *   Visits    — full signed visit history (by episode / clinician / division / chrono)
 *   Profile   — demographics, EHR link, addresses + coverage
 */
export function PatientChartTabs({
  patient,
  addresses,
  coverages,
  episodeCreatedFlash,
  snapshotStrip,
  episodesForPanel,
  externalContextItems,
  episodeChoicesForAdd,
  visits,
  activeEpisodesForPicker,
  startVisitSites,
  startVisitDefaultSiteId,
  ehrPanel,
}: Props) {
  const age = computeAge(patient.dobIso);
  const totalVisits = visits.length;

  const visitsByDivision = visits.reduce<Record<string, number>>((acc, v) => {
    acc[v.division] = (acc[v.division] ?? 0) + 1;
    return acc;
  }, {});
  const activeStripEntries = DIVISION_DISPLAY.filter((d) => (visitsByDivision[d.key] ?? 0) > 0);
  const otherCount = Object.entries(visitsByDivision).reduce(
    (acc, [k, n]) => (DIVISION_DISPLAY.some((d) => d.key === k) ? acc : acc + n),
    0,
  );

  const activeEpisodeCount = episodesForPanel.filter(
    (ep) => ep.status === 'ACTIVE' || ep.status === 'RECERT_DUE',
  ).length;

  // PatientIdentityHeader expects the Prisma Patient shape with dob as Date.
  const patientForHeader = {
    firstName: patient.firstName,
    lastName: patient.lastName,
    mrn: patient.mrn,
    dob: new Date(patient.dobIso),
    sex: patient.sex,
    preferredLanguage: patient.preferredLanguage,
    isDeleted: patient.isDeleted,
  };

  return (
    <div>
      {/* ── Sticky mini-header ──────────────────────────────────────────────
          Sticks to the top of the viewport as the user scrolls into any tab.
          Keeps patient identity + Start visit accessible without scrolling back. */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b shadow-sm">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-3 flex-wrap">
          {/* Patient identity anchor */}
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
              {/* Active divisions — hidden on small screens to avoid overflow */}
              {activeStripEntries.map((d) => (
                <StatusBadge key={d.key} variant="neutral" noIcon className="hidden lg:inline-flex">
                  {d.label}
                </StatusBadge>
              ))}
            </div>
          </div>

          {/* Start visit — always reachable */}
          <StartVisitButton
            patientId={patient.id}
            activeEpisodes={activeEpisodesForPicker}
            sites={startVisitSites}
            defaultSiteId={startVisitDefaultSiteId}
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
            <TabsTrigger value="episodes">
              Episodes{activeEpisodeCount > 0 ? ` (${activeEpisodeCount})` : ''}
            </TabsTrigger>
            <TabsTrigger value="visits">
              Visits{totalVisits > 0 ? ` (${totalVisits})` : ''}
            </TabsTrigger>
            <TabsTrigger value="profile">Profile</TabsTrigger>
          </TabsList>

          {/* ── Overview ─────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-6">
            <PatientIdentityHeader patient={patientForHeader} />

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

            <PatientSnapshotStrip patientId={patient.id} strip={snapshotStrip} />

            <ExternalContextSection
              patientId={patient.id}
              episodeChoices={episodeChoicesForAdd}
              initialItems={externalContextItems}
            />
          </TabsContent>

          {/* ── Episodes ─────────────────────────────────────────────────── */}
          <TabsContent value="episodes">
            <EpisodesPanel patientId={patient.id} episodes={episodesForPanel} />
          </TabsContent>

          {/* ── Visits ───────────────────────────────────────────────────── */}
          <TabsContent value="visits">
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
  );
}
