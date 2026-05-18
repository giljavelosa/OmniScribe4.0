'use client';

import { EhrSourcePill } from '@/components/brief/ehr-source-pill';
import type { ExternalEhrContext } from '@/lib/fhir/project-ehr-context';
import { FhirCardShell } from './fhir-card-shell';
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
}: {
  context: ExternalEhrContext;
  surface: CopilotSurface;
  noteId: string;
  nowMs: number;
}) {
  const rows = context.activeConditions.slice(0, MAX_ROWS);

  return (
    <FhirCardShell
      title="Active conditions"
      cardType="active-conditions"
      surface={surface}
      noteId={noteId}
      itemCount={rows.length}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No active conditions on file in EHR.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((c) => (
            <li key={c.provenance.fhirResourceId} className="flex items-start justify-between gap-3">
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
          ))}
        </ul>
      )}
    </FhirCardShell>
  );
}
