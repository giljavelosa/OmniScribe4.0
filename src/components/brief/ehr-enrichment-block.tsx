import { Plug } from 'lucide-react';

import { BriefSection } from './brief-section';
import { EhrSourcePill } from './ehr-source-pill';
import type { HydratedBriefEhrEnrichment } from '@/types/brief';

/**
 * EhrEnrichmentBlock — Unit 23 / F5 surface inside BriefCard. Renders
 * the four EHR-sourced categories (active conditions, current
 * medications, allergies, recent observations) with an EhrSourcePill
 * per row.
 *
 * Each pill carries its row's fhirResourceId + fetchedAt — clicking
 * opens the ProvenanceDrawer with the raw FHIR JSON. Note-sourced
 * fields elsewhere in the brief keep their existing SourcePill (links
 * to /review), unchanged.
 *
 * Collapses to nothing when ehrEnrichment is undefined OR every
 * category array is empty — keeps the brief clean for patients
 * without a verified EHR link.
 */
export function EhrEnrichmentBlock({
  ehrEnrichment,
  nowMs,
}: {
  ehrEnrichment: HydratedBriefEhrEnrichment | undefined;
  nowMs: number;
}) {
  if (!ehrEnrichment) return null;
  const counts =
    (ehrEnrichment.activeConditions?.length ?? 0) +
    (ehrEnrichment.currentMedications?.length ?? 0) +
    (ehrEnrichment.allergies?.length ?? 0) +
    (ehrEnrichment.recentObservations?.length ?? 0);
  if (counts === 0) return null;

  const ehrSystem = ehrEnrichment.ehrSystem;

  return (
    <BriefSection
      label="From EHR"
      count={counts}
      collapsible
      defaultExpanded={false}
      trailing={
        <span
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground"
          aria-hidden
        >
          <Plug className="h-3 w-3" /> {ehrSystem}
        </span>
      }
    >
      <div className="space-y-3 text-sm">
        {!!ehrEnrichment.activeConditions?.length && (
          <Subsection title="Active conditions">
            {ehrEnrichment.activeConditions.map((c) => (
              <Row
                key={`c-${c.fhirResourceId}`}
                primary={c.display}
                secondary={c.onsetDate ? `since ${c.onsetDate}${c.code ? ` · ${c.code}` : ''}` : c.code}
                pill={
                  <EhrSourcePill
                    ehrSystem={ehrSystem}
                    resourceType="Condition"
                    fhirResourceId={c.fhirResourceId}
                    fetchedAt={c.fetchedAt}
                    nowMs={nowMs}
                  />
                }
              />
            ))}
          </Subsection>
        )}

        {!!ehrEnrichment.currentMedications?.length && (
          <Subsection title="Current medications">
            {ehrEnrichment.currentMedications.map((m) => (
              <Row
                key={`m-${m.fhirResourceId}`}
                primary={m.display}
                secondary={m.status}
                pill={
                  <EhrSourcePill
                    ehrSystem={ehrSystem}
                    // Use the per-entry sourceType so MedicationRequest-sourced
                    // meds resolve via the right composite-unique key (was
                    // hardcoded MedicationStatement → 404 on MR entries).
                    resourceType={m.sourceType ?? 'MedicationStatement'}
                    fhirResourceId={m.fhirResourceId}
                    fetchedAt={m.fetchedAt}
                    nowMs={nowMs}
                  />
                }
              />
            ))}
          </Subsection>
        )}

        {!!ehrEnrichment.allergies?.length && (
          <Subsection title="Allergies">
            {ehrEnrichment.allergies.map((a) => (
              <Row
                key={`a-${a.fhirResourceId}`}
                primary={a.display}
                secondary={a.criticality ? `criticality: ${a.criticality}` : null}
                pill={
                  <EhrSourcePill
                    ehrSystem={ehrSystem}
                    resourceType="AllergyIntolerance"
                    fhirResourceId={a.fhirResourceId}
                    fetchedAt={a.fetchedAt}
                    nowMs={nowMs}
                  />
                }
              />
            ))}
          </Subsection>
        )}

        {!!ehrEnrichment.recentObservations?.length && (
          <Subsection title="Recent observations">
            {ehrEnrichment.recentObservations.map((o) => (
              <Row
                key={`o-${o.fhirResourceId}`}
                primary={`${o.display} — ${o.value}${o.unit ? ` ${o.unit}` : ''}`}
                secondary={o.effectiveDate ? `on ${o.effectiveDate}` : null}
                pill={
                  <EhrSourcePill
                    ehrSystem={ehrSystem}
                    resourceType="Observation"
                    fhirResourceId={o.fhirResourceId}
                    fetchedAt={o.fetchedAt}
                    nowMs={nowMs}
                  />
                }
              />
            ))}
          </Subsection>
        )}
      </div>
    </BriefSection>
  );
}

function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{title}</p>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function Row({
  primary,
  secondary,
  pill,
}: {
  primary: string;
  secondary: string | null;
  pill: React.ReactNode;
}) {
  return (
    <li className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate">{primary}</p>
        {secondary && <p className="text-xs text-muted-foreground truncate">{secondary}</p>}
      </div>
      <div className="shrink-0">{pill}</div>
    </li>
  );
}
