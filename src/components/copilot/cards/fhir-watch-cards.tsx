import type { ExternalEhrContext } from '@/lib/fhir/project-ehr-context';
import { ActiveConditionsCard } from './active-conditions-card';
import { CurrentMedicationsCard } from './current-medications-card';
import { RecentObservationsCard } from './recent-observations-card';
import { AllergiesCard } from './allergies-card';
import type { CopilotSurface } from '../copilot-shell';

/**
 * Per-category raised-row sets — Unit 26 / Watch v2. Each set carries
 * the fhirResourceIds whose rows should render with the row-level
 * accent. Undefined when Watch v2 isn't active (e.g. on /prepare),
 * which makes the bundle behave exactly like the Unit 25 static
 * version.
 */
export type RaisedFhirIdMap = {
  activeConditions?: Set<string>;
  currentMedications?: Set<string>;
  recentObservations?: Set<string>;
  allergies?: Set<string>;
};

/**
 * FhirWatchCards — Unit 25 / Watch v1 bundle, extended in Unit 26 with
 * an optional `raised` prop so the live-transcript coordinator
 * (FhirWatchCardsLive) can flip per-row highlight without forking the
 * bundle. Server pages keep mounting THIS component (raised defaults
 * to undefined → static visual); /capture mounts FhirWatchCardsLive
 * which wraps this and passes raised maps through.
 *
 * Layout: two-column grid on lg+. Falls back to single column on
 * smaller screens. Renders nothing when context is null (Rule 20).
 */
export function FhirWatchCards({
  context,
  surface,
  noteId,
  nowMs,
  raised,
}: {
  context: ExternalEhrContext | null;
  surface: CopilotSurface;
  noteId: string;
  nowMs: number;
  raised?: RaisedFhirIdMap;
}) {
  if (!context) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ActiveConditionsCard
        context={context}
        surface={surface}
        noteId={noteId}
        nowMs={nowMs}
        raisedFhirIds={raised?.activeConditions}
      />
      <CurrentMedicationsCard
        context={context}
        surface={surface}
        noteId={noteId}
        nowMs={nowMs}
        raisedFhirIds={raised?.currentMedications}
      />
      <RecentObservationsCard
        context={context}
        surface={surface}
        noteId={noteId}
        nowMs={nowMs}
        raisedFhirIds={raised?.recentObservations}
      />
      <AllergiesCard
        context={context}
        surface={surface}
        noteId={noteId}
        nowMs={nowMs}
        raisedFhirIds={raised?.allergies}
      />
    </div>
  );
}
