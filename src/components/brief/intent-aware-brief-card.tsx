import { EncounterIntent } from '@prisma/client';

import type { PriorContextBriefContent } from '@/types/brief';
import type {
  CareGap,
  GoalLedgerEntry,
  ImmunizationDue,
  MedicalNecessity,
  ObjectiveMeasureHistoryEntry,
  PlanRevision,
  PriorAwvItem,
  RevisionOpportunity,
  RiskTrendEntry,
} from '@/types/brief-intent-shapes';

import { BriefCard } from './brief-card';
import { GoalLedger } from './spines/goal-ledger';
import { MedicalNecessityScaffold } from './spines/medical-necessity-scaffold';
import { ObjectiveMeasureHistorySection } from './spines/objective-measure-history';
import { RiskTrendSparkline } from './spines/risk-trend-sparkline';
import { CareGapsList } from './spines/care-gaps-list';

/**
 * Unit 48 PR3 — intent-aware brief card wrapper (sibling pattern,
 * Decision 11).
 *
 * `<BriefCard>` itself is NOT forked — this wrapper composes it via
 * the `spineSlot` prop. When `intent === REHAB_PROGRESS_NOTE`, the
 * spineSlot renders `<GoalLedger>` + `<MedicalNecessityScaffold>`
 * (the two PR3 spine components) above the goals snapshot.
 *
 * The wrapper trusts the worker has stamped the spine-specific extra
 * fields (`goalLedger`, `medicalNecessity`) on `NoteBrief.content`.
 * Those fields aren't part of `PriorContextBriefContentSchema` (they
 * live in the spine schemas in `brief-intent-shapes.ts`); we read
 * them via a runtime narrow + null-graceful render.
 *
 * Page-level dispatch (in `/prepare/[noteId]/page.tsx`):
 *
 *   {encounter.intent && encounter.intent !== 'UNSPECIFIED' && supported.has(...)
 *     ? <IntentAwareBriefCard ... />
 *     : <BriefCard ... />}
 *
 * Pre-Unit-48 briefs (intent=null) take the existing `<BriefCard>`
 * path with no behavior change (snapshot regression test asserts).
 */
export function IntentAwareBriefCard({
  content,
  patientName,
  intent,
  followUpsSlot,
  nowMs,
  className,
}: {
  content: PriorContextBriefContent;
  patientName: string;
  intent: EncounterIntent;
  followUpsSlot?: React.ReactNode;
  nowMs: number;
  className?: string;
}) {
  // Runtime narrow — spine schemas extend the base, so the extra
  // fields ride through on NoteBrief.content as additional properties.
  // The renderer reads them defensively (no crash if absent).
  const extras = content as PriorContextBriefContent &
    Partial<{
      goalLedger: GoalLedgerEntry[];
      medicalNecessity: MedicalNecessity;
      objectiveMeasureHistory: ObjectiveMeasureHistoryEntry[];
      revisionOpportunities: RevisionOpportunity[];
      riskTrend: RiskTrendEntry[];
      planRevisions: PlanRevision[];
      careGaps: CareGap[];
      screeningsDue: CareGap[];
      immunizationsDue: ImmunizationDue[];
      priorAwvItems: PriorAwvItem[];
    }>;

  let spineSlot: React.ReactNode = null;

  if (intent === EncounterIntent.REHAB_PROGRESS_NOTE) {
    spineSlot = (
      <div className="space-y-5" data-testid="intent-aware-spine" data-intent={intent}>
        <GoalLedger entries={extras.goalLedger ?? []} />
        <MedicalNecessityScaffold data={extras.medicalNecessity ?? null} />
      </div>
    );
  } else if (intent === EncounterIntent.REHAB_REEVAL) {
    spineSlot = (
      <div className="space-y-5" data-testid="intent-aware-spine" data-intent={intent}>
        <GoalLedger entries={extras.goalLedger ?? []} />
        <ObjectiveMeasureHistorySection
          entries={extras.objectiveMeasureHistory ?? []}
          revisions={extras.revisionOpportunities ?? []}
        />
      </div>
    );
  } else if (intent === EncounterIntent.BH_TREATMENT_PLAN_REVIEW) {
    spineSlot = (
      <div className="space-y-5" data-testid="intent-aware-spine" data-intent={intent}>
        <GoalLedger entries={extras.goalLedger ?? []} />
        <RiskTrendSparkline
          entries={extras.riskTrend ?? []}
          revisions={extras.planRevisions ?? []}
        />
      </div>
    );
  } else if (intent === EncounterIntent.MEDICAL_ANNUAL_WELLNESS) {
    spineSlot = (
      <div className="space-y-5" data-testid="intent-aware-spine" data-intent={intent}>
        <CareGapsList
          careGaps={extras.careGaps ?? []}
          screeningsDue={extras.screeningsDue ?? []}
          immunizationsDue={extras.immunizationsDue ?? []}
          priorAwvItems={extras.priorAwvItems ?? []}
        />
      </div>
    );
  }
  // Other intents: spineSlot stays null → IntentAwareBriefCard renders
  // identically to a plain BriefCard. Future spines add more branches.

  return (
    <BriefCard
      content={content}
      patientName={patientName}
      followUpsSlot={followUpsSlot}
      spineSlot={spineSlot}
      nowMs={nowMs}
      className={className}
    />
  );
}
