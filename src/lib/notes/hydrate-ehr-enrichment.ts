import type {
  BriefEhrEnrichment,
  HydratedBriefEhrEnrichment,
} from '@/types/brief';
import type { ExternalEhrContext } from '@/lib/fhir/project-ehr-context';

/**
 * Hydrate the LLM's ehrEnrichment block with fetchedAt per entry — Unit 23 / F5.
 *
 * The LLM emits `{ ..., fhirResourceId }` per entry (it has no business
 * generating timestamps). The note-brief worker calls this after the LLM
 * returns to join each entry back to the projected externalEhrContext by
 * fhirResourceId, attaching the cache's fetchedAt to each row. The
 * hydrated shape is stored on PriorContextBriefContent.ehrEnrichment so
 * the BriefCard can render staleness chips without a server round-trip.
 *
 * Entries whose fhirResourceId doesn't match any projected row are dropped
 * defensively (the LLM hallucinated an id — discard rather than render
 * with an unprovenanced source). The system prompt warns against this.
 */
export function hydrateEhrEnrichment(
  llmEnrichment: BriefEhrEnrichment | undefined,
  context: ExternalEhrContext | null,
): HydratedBriefEhrEnrichment | undefined {
  if (!llmEnrichment || !context) return undefined;

  const conditionFetched = byFhirId(context.activeConditions);
  const medFetched = byFhirId([
    ...context.currentMedications,
    // No need to merge with anything else — currentMedications already
    // pools MedicationStatement + MedicationRequest in Unit 22's projection.
  ]);
  const allergyFetched = byFhirId(context.allergies);
  const obsFetched = byFhirId(context.recentObservations);

  const activeConditions = llmEnrichment.activeConditions?.flatMap((c) => {
    const at = conditionFetched.get(c.fhirResourceId);
    return at
      ? [
          {
            display: c.display,
            code: c.code,
            onsetDate: c.onsetDate,
            fhirResourceId: c.fhirResourceId,
            fetchedAt: at,
          },
        ]
      : [];
  });

  const currentMedications = llmEnrichment.currentMedications?.flatMap((m) => {
    const at = medFetched.get(m.fhirResourceId);
    return at
      ? [
          {
            display: m.display,
            status: m.status,
            fhirResourceId: m.fhirResourceId,
            fetchedAt: at,
          },
        ]
      : [];
  });

  const allergies = llmEnrichment.allergies?.flatMap((a) => {
    const at = allergyFetched.get(a.fhirResourceId);
    return at
      ? [
          {
            display: a.display,
            criticality: a.criticality,
            fhirResourceId: a.fhirResourceId,
            fetchedAt: at,
          },
        ]
      : [];
  });

  const recentObservations = llmEnrichment.recentObservations?.flatMap((o) => {
    const at = obsFetched.get(o.fhirResourceId);
    return at
      ? [
          {
            display: o.display,
            value: o.value,
            unit: o.unit,
            effectiveDate: o.effectiveDate,
            fhirResourceId: o.fhirResourceId,
            fetchedAt: at,
          },
        ]
      : [];
  });

  // If every category dropped to zero entries (LLM emitted ids we don't
  // recognize), suppress the whole block — better than rendering an
  // empty "EHR" section that confuses the clinician.
  const hasAny =
    (activeConditions?.length ?? 0) > 0 ||
    (currentMedications?.length ?? 0) > 0 ||
    (allergies?.length ?? 0) > 0 ||
    (recentObservations?.length ?? 0) > 0;
  if (!hasAny) return undefined;

  return {
    ehrSystem: context.ehrSystem,
    ...(activeConditions?.length ? { activeConditions } : {}),
    ...(currentMedications?.length ? { currentMedications } : {}),
    ...(allergies?.length ? { allergies } : {}),
    ...(recentObservations?.length ? { recentObservations } : {}),
  };
}

function byFhirId<T extends { provenance: { fhirResourceId: string; fetchedAt: string } }>(
  rows: T[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.provenance.fhirResourceId, r.provenance.fetchedAt);
  return m;
}
