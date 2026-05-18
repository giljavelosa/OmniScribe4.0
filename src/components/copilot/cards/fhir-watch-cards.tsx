import type { ExternalEhrContext } from '@/lib/fhir/project-ehr-context';
import { ActiveConditionsCard } from './active-conditions-card';
import { CurrentMedicationsCard } from './current-medications-card';
import { RecentObservationsCard } from './recent-observations-card';
import { AllergiesCard } from './allergies-card';
import type { CopilotSurface } from '../copilot-shell';

/**
 * FhirWatchCards — Unit 25 / Watch v1 bundle.
 *
 * One server-side fetch (loadExternalEhrContext) feeds all 4 cards;
 * this wrapper saves each calling page from importing 4 components
 * individually. Renders nothing when context is null (Rule 20 — no
 * verified PatientFhirIdentity, or empty / fully-stale cache).
 *
 * Layout: two-column grid on lg+ to match the existing Watch v0 card
 * arrangement on /prepare. Falls back to single column on smaller
 * screens.
 */
export function FhirWatchCards({
  context,
  surface,
  noteId,
  nowMs,
}: {
  context: ExternalEhrContext | null;
  surface: CopilotSurface;
  noteId: string;
  nowMs: number;
}) {
  if (!context) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ActiveConditionsCard context={context} surface={surface} noteId={noteId} nowMs={nowMs} />
      <CurrentMedicationsCard context={context} surface={surface} noteId={noteId} nowMs={nowMs} />
      <RecentObservationsCard context={context} surface={surface} noteId={noteId} nowMs={nowMs} />
      <AllergiesCard context={context} surface={surface} noteId={noteId} nowMs={nowMs} />
    </div>
  );
}
