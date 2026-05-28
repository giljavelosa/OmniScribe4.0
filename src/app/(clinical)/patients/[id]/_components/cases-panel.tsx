'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  Division,
  Profession,
  FhirWriteBackStatus,
  FhirWriteBackFailureKind,
} from '@prisma/client';
import { ChevronDown, ChevronRight, Mic, Plus } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { WritebackStatusChip } from '@/components/fhir/writeback-status-chip';
import { divisionForProfession } from '@/lib/professions';
import {
  isViewerActiveCase,
  sortCasesByViewerRecency,
} from '@/lib/case-management/sort';
import { EpisodesPanel } from './episodes-panel';
import { NewCaseDialog } from './new-case-dialog';

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
  goals: {
    id: string;
    goalType: 'STG' | 'LTG';
    goalText: string;
    status: 'ACTIVE' | 'MET' | 'NOT_MET' | 'MODIFIED' | 'DISCONTINUED' | 'PARTIALLY_MET';
    currentMeasure: string | null;
    targetMeasure: string | null;
    progressEntries: {
      id: string;
      measureValue: string | null;
      statusAtEntry: string | null;
      deltaNote: string | null;
      recordedAt: string;
    }[];
  }[];
};

export type CasePanelData = {
  id: string;
  primaryIcd: string | null;
  primaryIcdLabel: string;
  secondaryIcd: string | null;
  secondaryIcdLabel: string | null;
  description: string | null;
  /** PENDING_ROUTER cases never reach the panel (the chart filter excludes
   *  them) — listed here so the union matches Prisma's enum type without
   *  a cast at the call site. */
  status: 'ACTIVE' | 'CLOSED' | 'CANCELLED' | 'PENDING_ROUTER';
  /** ISO — most recent encounter on this case by the viewing clinician (if any). */
  viewerLastActivityAt: string | null;
  /** ISO — most recent encounter in viewer's division on this case. */
  viewerDivisionLastActivityAt: string | null;
  /** ISO — most recent encounter on this case overall. */
  lastActivityAt: string | null;
  medicalVisitCount: number;
  bhVisitCount: number;
  rehabEpisodes: EpisodeData[];
  /** Sprint 0.17 — most recent non-terminal write-back proposal
   *  status, used to render the inline chip. Null when no proposal
   *  exists OR the proposal is terminal (SUCCEEDED / CANCELLED). */
  writebackStatus?: FhirWriteBackStatus | null;
  /** Sprint 0.17 — paired with `writebackStatus`. Drives the FAILED
   *  variant split (TRANSIENT → warning + retry; PERMANENT/CONFLICT
   *  → danger + review). */
  writebackFailureKind?: FhirWriteBackFailureKind | null;
};

type Props = {
  patientId: string;
  cases: CasePanelData[];
  viewingProfession: Profession | null;
  canEdit: boolean;
  /**
   * Fired when the hero card's "Continue this case in a new visit" button is
   * tapped. The parent (PatientChartTabs) opens a StartVisitDialog scoped to
   * the chosen case so the picker step is skipped. Omitted on surfaces that
   * shouldn't offer a visit-start affordance (e.g. read-only viewers).
   */
  onContinueCase?: (caseId: string) => void;
};

const DIVISION_LABEL: Record<Division, string> = {
  MEDICAL: 'Medical',
  REHAB: 'Rehab',
  BEHAVIORAL_HEALTH: 'Behavioral health',
  MULTI: 'Multi',
};

export function CasesPanel({
  patientId,
  cases,
  viewingProfession,
  canEdit,
  onContinueCase,
}: Props) {
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const viewerDivision = divisionForProfession(viewingProfession);
  const ordered = useMemo(() => sortCasesByViewerRecency(cases), [cases]);

  // Hero treatment only makes sense when there's something to rank against —
  // a single case stays as a normal CaseCard with no "this one is yours" pill.
  const hero = ordered.length >= 2 ? ordered[0]! : null;
  const rest = hero ? ordered.slice(1) : ordered;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-md">Cases</CardTitle>
            <CardDescription>
              Care grouped by diagnosis. Your division opens first.
            </CardDescription>
          </div>
          {canEdit && (
            <Button type="button" size="sm" variant="outline" onClick={() => setNewCaseOpen(true)}>
              <Plus className="size-3.5 mr-1" aria-hidden />
              New case
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {ordered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cases on file.</p>
          ) : (
            <>
              {hero && (
                <HeroCaseCard
                  patientId={patientId}
                  caseRow={hero}
                  viewerDivision={viewerDivision}
                  canEdit={canEdit}
                  onContinueCase={onContinueCase}
                />
              )}
              {rest.map((c, idx) => (
                <CaseCard
                  key={c.id}
                  patientId={patientId}
                  caseRow={c}
                  viewerDivision={viewerDivision}
                  // When there's no hero (single-case patient), the lone card
                  // stays expanded by default — same as before. Otherwise the
                  // secondary list is collapsed.
                  defaultExpanded={!hero && idx === 0}
                  canEdit={canEdit}
                  onContinueCase={onContinueCase}
                />
              ))}
            </>
          )}
        </CardContent>
      </Card>
      <NewCaseDialog
        patientId={patientId}
        open={newCaseOpen}
        onOpenChange={setNewCaseOpen}
        onResolved={() => {
          window.location.reload();
        }}
      />
    </>
  );
}

/**
 * The "Your active case" hero — the same CaseCard content rendered with a
 * primary-tinted border + an explicit role pill + an inline "Continue this
 * case in a new visit" affordance. The clinician's-division section auto-
 * expands inside it. Only rendered when there are 2+ active cases (with one
 * case there's nothing to rank against).
 */
function HeroCaseCard({
  patientId,
  caseRow,
  viewerDivision,
  canEdit,
  onContinueCase,
}: {
  patientId: string;
  caseRow: CasePanelData;
  viewerDivision: Division | null;
  canEdit: boolean;
  onContinueCase?: (caseId: string) => void;
}) {
  const isYours = isViewerActiveCase(caseRow);
  return (
    <div className="rounded-md border-2 border-primary/60 bg-primary/[0.03] p-3 space-y-2 shadow-sm">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <StatusBadge variant={isYours ? 'success' : 'neutral'} noIcon>
          {isYours ? 'Your active case' : 'Most recent case'}
        </StatusBadge>
        {canEdit && onContinueCase && caseRow.status === 'ACTIVE' && (
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={() => onContinueCase(caseRow.id)}
          >
            <Mic className="size-3.5" aria-hidden />
            Continue this case in a new visit
          </Button>
        )}
      </div>
      {/* Reuse the existing CaseCard body, locked open so the hero is always
          showing the clinician's division section. */}
      <CaseCard
        patientId={patientId}
        caseRow={caseRow}
        viewerDivision={viewerDivision}
        defaultExpanded
        canEdit={canEdit}
        chrome="bare"
      />
    </div>
  );
}

function CaseCard({
  patientId,
  caseRow,
  viewerDivision,
  defaultExpanded,
  canEdit,
  chrome = 'card',
  onContinueCase,
}: {
  patientId: string;
  caseRow: CasePanelData;
  viewerDivision: Division | null;
  defaultExpanded: boolean;
  canEdit: boolean;
  /**
   * `'card'` (default) renders the standard bordered card chrome.
   * `'bare'` drops the outer border/padding so this body can be embedded
   * inside a host card (e.g. the hero) without double-borders.
   */
  chrome?: 'card' | 'bare';
  /**
   * Optional handler that, when supplied alongside an ACTIVE non-bare card,
   * surfaces a "Start visit on this case" affordance so the clinician can
   * pre-bind a new visit to this case (skipping the post-visit router
   * proposal). Suppressed on `chrome === 'bare'` because the host hero
   * card already owns its own continue button.
   */
  onContinueCase?: (caseId: string) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const icdHeadline = caseRow.primaryIcd
    ? `${caseRow.primaryIcd} · ${caseRow.primaryIcdLabel}`
    : caseRow.primaryIcdLabel;

  const showStartVisit =
    chrome === 'card' && canEdit && !!onContinueCase && caseRow.status === 'ACTIVE';

  return (
    <div className={chrome === 'card' ? 'rounded-md border border-border p-3 space-y-2' : 'space-y-2'}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="flex flex-1 min-w-0 items-start gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="size-4 mt-0.5 shrink-0" aria-hidden />
          ) : (
            <ChevronRight className="size-4 mt-0.5 shrink-0" aria-hidden />
          )}
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-sm">{icdHeadline}</span>
              <StatusBadge variant={caseRow.status === 'ACTIVE' ? 'success' : 'neutral'} noIcon>
                {caseRow.status}
              </StatusBadge>
              {!caseRow.primaryIcd && (
                <StatusBadge variant="warning" noIcon>
                  Needs coding
                </StatusBadge>
              )}
              {caseRow.writebackStatus && (
                <WritebackStatusChip
                  status={caseRow.writebackStatus}
                  failureKind={caseRow.writebackFailureKind ?? null}
                />
              )}
            </div>
            {caseRow.secondaryIcd && (
              <p className="text-xs text-muted-foreground">
                Secondary: {caseRow.secondaryIcd}
                {caseRow.secondaryIcdLabel ? ` · ${caseRow.secondaryIcdLabel}` : ''}
              </p>
            )}
          </div>
        </button>
        {showStartVisit && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 shrink-0"
            onClick={() => onContinueCase!(caseRow.id)}
          >
            <Mic className="size-3.5" aria-hidden />
            Start visit on this case
          </Button>
        )}
      </div>

      {expanded && (
        <div className="space-y-3 pl-6 border-l border-border ml-1">
          <DivisionSection
            division="REHAB"
            expanded={viewerDivision === 'REHAB'}
            summary={
              caseRow.rehabEpisodes.length > 0
                ? `${caseRow.rehabEpisodes.length} rehab episode${caseRow.rehabEpisodes.length === 1 ? '' : 's'}`
                : 'No rehab episode'
            }
          >
            {caseRow.rehabEpisodes.length > 0 ? (
              <EpisodesPanel
                patientId={patientId}
                episodes={caseRow.rehabEpisodes}
                canEdit={canEdit}
                embedded
              />
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">No rehab plan of care under this case.</p>
                {canEdit && (
                  <Button type="button" size="sm" variant="outline" asChild>
                    <Link
                      href={`/patients/${patientId}/episodes/new?caseManagementId=${caseRow.id}`}
                    >
                      Open rehab episode
                    </Link>
                  </Button>
                )}
              </div>
            )}
          </DivisionSection>

          <DivisionSection
            division="MEDICAL"
            expanded={viewerDivision === 'MEDICAL'}
            summary={
              caseRow.medicalVisitCount > 0
                ? `${caseRow.medicalVisitCount} medical visit${caseRow.medicalVisitCount === 1 ? '' : 's'}`
                : 'No medical activity'
            }
          />

          <DivisionSection
            division="BEHAVIORAL_HEALTH"
            expanded={viewerDivision === 'BEHAVIORAL_HEALTH'}
            summary={
              caseRow.bhVisitCount > 0
                ? `${caseRow.bhVisitCount} BH visit${caseRow.bhVisitCount === 1 ? '' : 's'}`
                : 'No BH activity'
            }
          />
        </div>
      )}
    </div>
  );
}

function DivisionSection({
  division,
  expanded,
  summary,
  children,
}: {
  division: Division;
  expanded: boolean;
  summary: string;
  children?: React.ReactNode;
}) {
  if (expanded) {
    return (
      <div className="space-y-2">
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          {DIVISION_LABEL[division]}
        </p>
        {children}
      </div>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-semibold text-foreground/80">{DIVISION_LABEL[division]}</span>
      {' · '}
      {summary}
    </p>
  );
}
