'use client';

import { EhrSourcePill } from '@/components/brief/ehr-source-pill';
import { cn } from '@/lib/cn';
import type { ExternalEhrContext } from '@/lib/fhir/project-ehr-context';
import { FhirCardShell, RAISED_ROW_CLASSES, countRaisedRows } from './fhir-card-shell';
import type { CopilotSurface } from '../copilot-shell';

const MAX_ROWS = 8;

/**
 * ActiveConditionsCard — Unit 25 / Watch v1. Lists the patient's
 * currently-active conditions from the FHIR cache.
 *
 * Active-status filtering happens upstream in loadExternalEhrContext
 * (Unit 22 projection); the card just renders. Cap at 8 rows so the
 * card doesn't crowd the page — the brief generator caps its own
 * activeConditions block at 8 too, so the visual weight stays
 * consistent with the brief.
 */
export function ActiveConditionsCard({
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
  /** Unit 26 / Watch v2 — fhirResourceIds whose rows should render with
   *  the row-level raise accent. Undefined / empty when Watch v2 isn't
   *  active (e.g. on /prepare). */
  raisedFhirIds?: Set<string>;
}) {
  const rows = context.activeConditions.slice(0, MAX_ROWS);
  const raisedCount = countRaisedRows(rows.map((r) => r.provenance.fhirResourceId), raisedFhirIds);

  return (
    <FhirCardShell
      title="Active conditions"
      cardType="active-conditions"
      surface={surface}
      noteId={noteId}
      itemCount={rows.length}
      raisedCount={raisedCount}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No active conditions on file in EHR.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((c) => {
            const isRaised = raisedFhirIds?.has(c.provenance.fhirResourceId) ?? false;
            return (
              <li
                key={c.provenance.fhirResourceId}
                className={cn('flex items-start justify-between gap-3', isRaised && RAISED_ROW_CLASSES)}
              >
                <div className="min-w-0">
                  <p className="truncate">{c.display}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.code ?? ''}
                    {c.code && c.onsetDate ? ' · ' : ''}
                    {c.onsetDate ? `since ${c.onsetDate}` : ''}
                  </p>
                </div>
                <div className="shrink-0">
                  <EhrSourcePill
                    ehrSystem={c.provenance.ehrSystem}
                    resourceType="Condition"
                    fhirResourceId={c.provenance.fhirResourceId}
                    fetchedAt={c.provenance.fetchedAt}
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

