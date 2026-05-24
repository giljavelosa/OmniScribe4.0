import { z } from 'zod';
import { EncounterIntent } from '@prisma/client';

/**
 * Prior-Context Brief — canonical JSON shape stored in NoteBrief.content.
 *
 * Source: references/prior-context-brief-spec.md §5.1 + prior-context-brief-prompt.md §4.
 *
 * Every text field in the brief MUST be grounded in source notes (the three
 * absolute prompt rules). The schema enforces shape; the prompt enforces
 * source-groundedness. Both run on every brief.
 *
 * `measureKey` is the Phase-13b registry tag (rehab: pain-nrs / rom-primary /
 * strength-primary / gait-speed / outcome-tool-score; medical: bp / hr /
 * weight / bmi / spo2 / temp; BH: phq9-total / gad7-total / mood-rating).
 * Optional + nullable: pre-13b briefs and unmappable measures stay null,
 * never invented.
 */

export const TrendSchema = z.enum(['improving', 'stable', 'worsening', 'unknown']);
export type Trend = z.infer<typeof TrendSchema>;

export const TrajectoryDirectionSchema = z.enum([
  'improving',
  'plateau',
  'regressing',
  'mixed',
]);
export type TrajectoryDirection = z.infer<typeof TrajectoryDirectionSchema>;

export const SourcePillSchema = z.object({
  noteId: z.string().min(1),
  date: z.string().min(1),
});
export type SourcePill = z.infer<typeof SourcePillSchema>;

export const ObjectiveMeasureSchema = z.object({
  measure: z.string().min(1),
  unit: z.string().nullable(),
  lastValue: z.string().min(1),
  priorValues: z.array(z.string()),
  trend: TrendSchema,
  sourceNoteId: z.string().min(1),
  // Phase 13b — null when unmapped. Never invent a near-miss key.
  measureKey: z.string().min(1).nullable().optional(),
});
export type ObjectiveMeasure = z.infer<typeof ObjectiveMeasureSchema>;

export const GoalSnippetSchema = z.object({
  text: z.string().min(1),
  status: z.enum(['active', 'met', 'carried']),
  delta: z.string().max(50).nullable(),
  originNoteId: z.string().min(1),
});
export type GoalSnippet = z.infer<typeof GoalSnippetSchema>;

export const FollowUpPreviewSchema = z.object({
  followUpId: z.string().min(1),
  text: z.string().min(1),
  status: z.enum(['OPEN', 'MET', 'CARRIED', 'DROPPED', 'CLOSED_BY_DISCHARGE']),
  source: SourcePillSchema,
});
export type FollowUpPreview = z.infer<typeof FollowUpPreviewSchema>;

/**
 * What the LLM returns (strict). The worker post-stamps generatedAt +
 * generatorVersion + openFollowUps (we derive open follow-ups from the DB,
 * not the LLM) before writing to NoteBrief.
 */
/**
 * EHR-enrichment block (Unit 22 / F4). Optional — present only when the
 * brief generator received an `<external_ehr_context>` block in its input.
 * Each entry carries the fhirResourceId so F5's provenance UI can render
 * "from <ehrSystem>, fetched at <ts>" pills without re-querying.
 */
export const BriefEhrEnrichmentSchema = z.object({
  activeConditions: z
    .array(
      z.object({
        display: z.string().min(1),
        code: z.string().nullable(),
        onsetDate: z.string().nullable(),
        fhirResourceId: z.string().min(1),
      }),
    )
    .optional(),
  currentMedications: z
    .array(
      z.object({
        display: z.string().min(1),
        status: z.string().min(1),
        fhirResourceId: z.string().min(1),
      }),
    )
    .optional(),
  allergies: z
    .array(
      z.object({
        display: z.string().min(1),
        criticality: z.string().nullable(),
        fhirResourceId: z.string().min(1),
      }),
    )
    .optional(),
  recentObservations: z
    .array(
      z.object({
        display: z.string().min(1),
        value: z.string().min(1),
        unit: z.string().nullable(),
        effectiveDate: z.string().nullable(),
        fhirResourceId: z.string().min(1),
      }),
    )
    .optional(),
});
export type BriefEhrEnrichment = z.infer<typeof BriefEhrEnrichmentSchema>;

export const BriefLLMOutputSchema = z.object({
  patientOneLine: z.string().nullable(),
  episodeContext: z
    .object({
      episodeId: z.string().min(1),
      label: z.string().min(1),
      visitNumber: z.number().int().nullable(),
      plannedVisits: z.number().int().nullable(),
    })
    .nullable(),
  lastVisit: z.object({
    noteId: z.string().min(1),
    date: z.string().min(1),
    daysAgo: z.number().int().min(0),
    clinicianName: z.string().min(1),
    noteType: z.string().nullable(),
    templateName: z.string().nullable(),
  }),
  chiefConcern: z.string().nullable(),
  priorAssessment: z.string().nullable(),
  trajectory: z
    .object({
      summary: z.string().nullable(),
      direction: TrajectoryDirectionSchema.nullable(),
    })
    .nullable(),
  objectiveMeasures: z.array(ObjectiveMeasureSchema),
  interventionsPerformed: z.array(z.string()),
  homeProgram: z.string().nullable(),
  educationGiven: z.array(z.string()),
  carryForwardPlan: z.array(z.string()),
  topActiveGoals: z.array(GoalSnippetSchema).max(3),
  watch: z.object({
    recentMedChanges: z.array(z.string()),
    recentResults: z.array(z.string()),
    precautions: z.array(z.string()),
    redFlagsFromPriorNote: z.array(z.string()),
  }),
  sourceNoteIds: z.array(z.string().min(1)).min(1),
  ehrEnrichment: BriefEhrEnrichmentSchema.optional(),
});
export type BriefLLMOutput = z.infer<typeof BriefLLMOutputSchema>;

/**
 * Hydrated EHR enrichment block — Unit 23 (F5). Each entry from the LLM
 * output is augmented with the cache's fetchedAt at brief generation
 * time (the LLM doesn't emit timestamps). The hydrated shape lets the
 * BriefCard render staleness chips per row without a server round-trip.
 */
const HydratedConditionSchema = z.object({
  display: z.string().min(1),
  code: z.string().nullable(),
  onsetDate: z.string().nullable(),
  fhirResourceId: z.string().min(1),
  fetchedAt: z.string().min(1),
});
const HydratedMedicationSchema = z.object({
  display: z.string().min(1),
  status: z.string().min(1),
  fhirResourceId: z.string().min(1),
  fetchedAt: z.string().min(1),
  // The FHIR resource type — needed so the drawer lookup uses the right
  // (ehrSystem, resourceType, fhirResourceId) tuple. currentMedications can
  // contain entries from both MedicationStatement and MedicationRequest.
  sourceType: z.enum(['MedicationStatement', 'MedicationRequest']).optional(),
});
const HydratedAllergySchema = z.object({
  display: z.string().min(1),
  criticality: z.string().nullable(),
  fhirResourceId: z.string().min(1),
  fetchedAt: z.string().min(1),
});
const HydratedObservationSchema = z.object({
  display: z.string().min(1),
  value: z.string().min(1),
  unit: z.string().nullable(),
  effectiveDate: z.string().nullable(),
  fhirResourceId: z.string().min(1),
  fetchedAt: z.string().min(1),
});

export const HydratedBriefEhrEnrichmentSchema = z.object({
  ehrSystem: z.string().min(1),
  activeConditions: z.array(HydratedConditionSchema).optional(),
  currentMedications: z.array(HydratedMedicationSchema).optional(),
  allergies: z.array(HydratedAllergySchema).optional(),
  recentObservations: z.array(HydratedObservationSchema).optional(),
});
export type HydratedBriefEhrEnrichment = z.infer<typeof HydratedBriefEhrEnrichmentSchema>;

/**
 * The full brief stored in NoteBrief.content. Adds metadata the worker stamps
 * AFTER the LLM call returns + openFollowUps derived from the DB (so we don't
 * let the model hallucinate follow-ups). The optional `ehrEnrichment` here
 * is the HYDRATED shape (with fetchedAt per entry) — the LLM-output shape on
 * BriefLLMOutputSchema is `.omit`-ed and replaced.
 */
export const PriorContextBriefContentSchema = BriefLLMOutputSchema.omit({
  ehrEnrichment: true,
}).extend({
  generatedAt: z.string().min(1),
  generatorVersion: z.string().min(1),
  openFollowUps: z.array(FollowUpPreviewSchema),
  ehrEnrichment: HydratedBriefEhrEnrichmentSchema.optional(),
  // Unit 48 PR3 — clinical intent of the source encounter (when the brief
  // was generated via IntentAwareBriefGenerator). Optional nullable for
  // back-compat: pre-Unit-48 briefs and generic-path briefs leave this
  // unset and validate identically to the pre-PR3 schema. Renderers
  // branch on this field to choose intent-aware section components
  // (see src/components/brief/intent-aware-brief-card.tsx).
  // See: src/types/brief-intent-shapes.ts for the spine-specific shapes
  // that extend BriefLLMOutputSchema with intent-specific fields.
  intent: z.nativeEnum(EncounterIntent).nullable().optional(),
});
export type PriorContextBriefContent = z.infer<typeof PriorContextBriefContentSchema>;

/**
 * The FollowupExtractor returns this shape. We use it as input when creating
 * the DB row (worker fills in orgId / patientId / episodeId / originNoteId).
 */
export const FollowupExtractionSchema = z.object({
  items: z
    .array(
      z.object({
        text: z.string().min(3).max(280),
      }),
    )
    .max(20),
});
export type FollowupExtraction = z.infer<typeof FollowupExtractionSchema>;
