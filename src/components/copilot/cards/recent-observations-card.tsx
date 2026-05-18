'use client';

import { Activity } from 'lucide-react';

import { EhrSourcePill } from '@/components/brief/ehr-source-pill';
import type { ExternalEhrContext } from '@/lib/fhir/project-ehr-context';
import { FhirCardShell } from './fhir-card-shell';
import type { CopilotSurface } from '../copilot-shell';

/**
 * RecentObservationsCard — Unit 25 / Watch v1. Lists the patient's
 * recent observations (labs + vitals pooled — vitals/labs split is a
 * follow-up unit, requires LOINC classification).
 *
 * Projection already capped at 10 + sorted desc by effectiveDate in
 * Unit 22; this card renders the list as-is.
 */
export function RecentObservationsCard({
  context,
  surface,
  noteId,
  nowMs,
}: {
  context: ExternalEhrContext;
  surface: CopilotSurface;
  noteId: string;
  nowMs: number;
}) {
  const rows = context.recentObservations;

  return (
    <FhirCardShell
      title="Recent observations"
      cardType="recent-observations"
      surface={surface}
      noteId={noteId}
      itemCount={rows.length}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No recent observations on file in EHR.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((o) => (
            <li key={o.provenance.fhirResourceId} className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-start gap-2">
                <Activity className="h-3.5 w-3.5 mt-1 text-muted-foreground shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate">
                    <span className="font-medium">{o.display}</span>
                    <span className="text-muted-foreground"> — {o.value}{o.unit ? ` ${o.unit}` : ''}</span>
                  </p>
                  {o.effectiveDate && (
                    <p className="text-xs text-muted-foreground">on {o.effectiveDate}</p>
                  )}
                </div>
              </div>
              <div className="shrink-0">
                <EhrSourcePill
                  ehrSystem={o.provenance.ehrSystem}
                  resourceType="Observation"
                  fhirResourceId={o.provenance.fhirResourceId}
                  fetchedAt={o.provenance.fetchedAt}
                  nowMs={nowMs}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </FhirCardShell>
  );
}
