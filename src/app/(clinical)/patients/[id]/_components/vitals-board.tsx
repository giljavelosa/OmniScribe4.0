'use client';

import { Activity, ChevronRight, Pill } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricStat } from '@/components/ui/metric-stat';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/cn';
import type { PatientSnapshotStrip as PatientSnapshotStripData } from '@/lib/snapshots/types';
import type {
  VerifiedLabFact,
  VerifiedProcedureFact,
  VerifiedVitalFact,
} from '@/lib/external-context/verified-chart-facts';

const DIVISION_LABEL: Record<PatientSnapshotStripData['division'], string> = {
  REHAB: 'Rehab',
  MEDICAL: 'Medical',
  BEHAVIORAL_HEALTH: 'Behavioral Health',
};

type Props = {
  strip: PatientSnapshotStripData | null;
  /** "N signed visits · Rehab (2) · …" — folded out of the old section header. */
  metaLine: string | null;
  medicationHeadline: string;
  /** Opens the SnapshotDetailSheet (whole measures region is the target). */
  onOpen: () => void;
  /** Opens the medications ChartDetailSheet (the footer row is its target). */
  onOpenMedications: () => void;
  verifiedLabs?: VerifiedLabFact[];
  verifiedVitals?: VerifiedVitalFact[];
  verifiedProcedures?: VerifiedProcedureFact[];
  verifiedDocumentCount?: number;
  verifiedIndexedPageCount?: number;
};

/**
 * VitalsBoard — the Overview hero. An elevated instrument cluster pairing the
 * clinical snapshot with a medications footer. Two sibling click targets
 * (never nested): the measures region opens the snapshot sheet; the footer
 * row opens medications. Viewer-driven — a PT sees pain/ROM, a medical
 * clinician sees vitals (snapshot-viewer-lens).
 */
export function VitalsBoard({
  strip,
  metaLine,
  medicationHeadline,
  verifiedLabs = [],
  verifiedVitals = [],
  verifiedProcedures = [],
  verifiedDocumentCount = 0,
  verifiedIndexedPageCount = 0,
  onOpen,
  onOpenMedications,
}: Props) {
  const measures = strip?.measures ?? [];
  const divisionLabel = strip ? DIVISION_LABEL[strip.division] : null;
  const subLine = [divisionLabel, metaLine].filter(Boolean).join(' · ');
  const hasVerifiedRecordFacts =
    verifiedLabs.length > 0 ||
    verifiedVitals.length > 0 ||
    verifiedProcedures.length > 0 ||
    verifiedDocumentCount > 0;
  const verifiedHighlights = [
    ...verifiedVitals.slice(0, 2).map((vital) =>
      `${vital.type}: ${vital.value}${vital.unit ? ` ${vital.unit}` : ''}`,
    ),
    ...verifiedLabs.slice(0, 3).map((lab) =>
      `${lab.name}: ${lab.value}${lab.unit ? ` ${lab.unit}` : ''}${lab.abnormalFlag && lab.abnormalFlag !== 'normal' && lab.abnormalFlag !== 'unknown' ? ` (${lab.abnormalFlag})` : ''}`,
    ),
    ...verifiedProcedures.slice(0, 2).map((procedure) => procedure.text),
  ].slice(0, 4);

  return (
    <Card
      variant="elevated"
      className={cn(
        'gap-0 py-0 overflow-hidden',
        measures.length > 0 && 'min-h-[var(--min-card-h-board)]',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left px-5 pt-4 pb-3 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              <Activity className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">Clinical snapshot</p>
              {subLine && (
                <p className="text-2xs text-muted-foreground leading-tight mt-0.5 truncate">
                  {subLine}
                </p>
              )}
            </div>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
        </div>

        <div className="mt-4">
          {measures.length === 0 ? (
            hasVerifiedRecordFacts ? (
              <div className="rounded-lg border bg-muted/20 px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {verifiedVitals.length > 0 && (
                    <StatusBadge variant="neutral" noIcon className="text-[10px]">
                      Vitals: {verifiedVitals.length}
                    </StatusBadge>
                  )}
                  {verifiedLabs.length > 0 && (
                    <StatusBadge variant="neutral" noIcon className="text-[10px]">
                      Labs: {verifiedLabs.length}
                    </StatusBadge>
                  )}
                  {verifiedProcedures.length > 0 && (
                    <StatusBadge variant="neutral" noIcon className="text-[10px]">
                      Procedures/imaging: {verifiedProcedures.length}
                    </StatusBadge>
                  )}
                  {verifiedDocumentCount > 0 && (
                    <StatusBadge variant="info" noIcon className="text-[10px]">
                      {verifiedDocumentCount} verified record{verifiedDocumentCount === 1 ? '' : 's'}
                      {verifiedIndexedPageCount > 0 ? ` · ${verifiedIndexedPageCount} pages indexed` : ''}
                    </StatusBadge>
                  )}
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">
                  Verified uploaded records contain clinical data.
                </p>
                {verifiedHighlights.length > 0 && (
                  <ul className="mt-2 grid gap-1 text-xs text-foreground/85 sm:grid-cols-2">
                    {verifiedHighlights.map((item, index) => (
                      <li key={`${item}-${index}`} className="truncate" title={item}>
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Recent vitals from signed visits are not available yet; open the snapshot for verified-record details.
                </p>
              </div>
            ) : (
              <EmptyState
                size="sm"
                icon={<Activity className="size-4" />}
                title="No recent vitals found"
                description="Signed visits and verified uploaded records have not added vitals or objective measures yet."
              />
            )
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {measures.map((m) => (
                <div
                  key={m.measureKey}
                  className="rounded-lg border bg-muted/20 px-3.5 py-3"
                >
                  <MetricStat
                    label={m.label}
                    value={m.value}
                    unit={m.unit}
                    trend={m.trend}
                    series={m.series}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </button>

      <button
        type="button"
        onClick={onOpenMedications}
        className="w-full text-left px-5 py-3 border-t flex items-center gap-2.5 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--status-info-bg)] text-[var(--status-info-fg)]"
        >
          <Pill className="size-3.5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground leading-none">
            Medications
          </p>
          <p className="text-sm font-medium leading-snug text-foreground/90 mt-1 truncate">
            {medicationHeadline}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
      </button>
    </Card>
  );
}
