'use client';

import { AlertTriangle, ShieldAlert } from 'lucide-react';

import { EhrSourcePill } from '@/components/brief/ehr-source-pill';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/cn';
import type { ExternalEhrContext } from '@/lib/fhir/project-ehr-context';
import { FhirCardShell, RAISED_ROW_CLASSES, countRaisedRows } from './fhir-card-shell';
import type { CopilotSurface } from '../copilot-shell';

/**
 * AllergiesCard — Unit 25 / Watch v1.
 *
 * No status filter in the projection (Unit 22) — recorded value carries
 * criticality. High-criticality rows render with a red alert icon so
 * the clinician's eye catches them; routine rows render plain.
 */
export function AllergiesCard({
  context,
  surface,
  noteId,
  nowMs,
  raisedFhirIds,
}: {
  context: ExternalEhrContext;
  surface: CopilotSurface;
  noteId: string;
  nowMs: number;
  raisedFhirIds?: Set<string>;
}) {
  const rows = context.allergies;
  const raisedCount = countRaisedRows(rows.map((r) => r.provenance.fhirResourceId), raisedFhirIds);

  return (
    <FhirCardShell
      title="Allergies"
      cardType="allergies"
      surface={surface}
      noteId={noteId}
      itemCount={rows.length}
      raisedCount={raisedCount}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No allergies on file in EHR.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((a) => {
            const isHigh = a.criticality === 'high';
            const isRaised = raisedFhirIds?.has(a.provenance.fhirResourceId) ?? false;
            return (
              <li
                key={a.provenance.fhirResourceId}
                className={cn('flex items-start justify-between gap-3', isRaised && RAISED_ROW_CLASSES)}
              >
                <div className="min-w-0 flex items-start gap-2">
                  {isHigh ? (
                    <ShieldAlert
                      className="h-3.5 w-3.5 mt-1 text-[var(--status-danger-fg)] shrink-0"
                      aria-label="High criticality"
                    />
                  ) : (
                    <AlertTriangle
                      className="h-3.5 w-3.5 mt-1 text-muted-foreground shrink-0"
                      aria-hidden
                    />
                  )}
                  <div className="min-w-0">
                    <p className="truncate">{a.display}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {a.criticality && (
                        <StatusBadge variant={isHigh ? 'danger' : 'neutral'} noIcon>
                          {a.criticality}
                        </StatusBadge>
                      )}
                      {a.category && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {a.category}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="shrink-0">
                  <EhrSourcePill
                    ehrSystem={a.provenance.ehrSystem}
                    resourceType="AllergyIntolerance"
                    fhirResourceId={a.provenance.fhirResourceId}
                    fetchedAt={a.provenance.fetchedAt}
                    nowMs={nowMs}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </FhirCardShell>
  );
}
