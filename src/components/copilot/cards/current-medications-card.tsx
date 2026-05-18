'use client';

import { Pill } from 'lucide-react';

import { EhrSourcePill } from '@/components/brief/ehr-source-pill';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/cn';
import type { ExternalEhrContext } from '@/lib/fhir/project-ehr-context';
import { FhirCardShell, RAISED_ROW_CLASSES, countRaisedRows } from './fhir-card-shell';
import type { CopilotSurface } from '../copilot-shell';

/**
 * CurrentMedicationsCard — Unit 25 / Watch v1. Lists the patient's
 * currently-active medications from the FHIR cache.
 *
 * Pools MedicationStatement + MedicationRequest into one list (Unit 22
 * projection already did the merge); a small badge surfaces which
 * source type each row came from since clinicians treat the two
 * differently ('Statement = what the patient reports taking;
 * 'Request = what was prescribed).
 *
 * No row cap — the active-med list IS the meds list and clinicians
 * need to see all of it.
 */
export function CurrentMedicationsCard({
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
  const rows = context.currentMedications;
  const raisedCount = countRaisedRows(rows.map((r) => r.provenance.fhirResourceId), raisedFhirIds);

  return (
    <FhirCardShell
      title="Current medications"
      cardType="current-medications"
      surface={surface}
      noteId={noteId}
      itemCount={rows.length}
      raisedCount={raisedCount}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No active medications on file in EHR.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((m) => {
            const isRaised = raisedFhirIds?.has(m.provenance.fhirResourceId) ?? false;
            return (
              <li
                // sourceType in the key because MedicationStatement +
                // MedicationRequest share fhirResourceId namespaces — pooling
                // both means key collisions silently drop entries otherwise.
                key={`${m.sourceType}:${m.provenance.fhirResourceId}`}
                className={cn('flex items-start justify-between gap-3', isRaised && RAISED_ROW_CLASSES)}
              >
                <div className="min-w-0 flex items-start gap-2">
                  <Pill className="h-3.5 w-3.5 mt-1 text-muted-foreground shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate">{m.display}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StatusBadge variant="neutral" noIcon>
                        {m.status}
                      </StatusBadge>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {m.sourceType === 'MedicationStatement' ? 'reported' : 'prescribed'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="shrink-0">
                  <EhrSourcePill
                    ehrSystem={m.provenance.ehrSystem}
                    resourceType={m.sourceType}
                    fhirResourceId={m.provenance.fhirResourceId}
                    fetchedAt={m.provenance.fetchedAt}
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
