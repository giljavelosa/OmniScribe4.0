/**
 * Unit 48 PR2 — display labels + division filter for EncounterIntent.
 *
 * Centralizes the human-readable label per intent so every surface that
 * shows an intent (the StartVisitDialog chip, future compliance flag
 * panels, audit views, the brief footer) uses identical strings.
 *
 * Source of label conventions: references/visit-type-taxonomy.md.
 */

import { EncounterIntent, type Division } from '@prisma/client';

/**
 * Human-readable short label per intent. Designed to fit the chip's
 * single-line button label (~24 chars max). Past-tense compliance
 * variants and CPT codes intentionally absent — those belong on the
 * full intent picker / docs, not the chip.
 */
export const INTENT_DISPLAY_LABEL: Record<EncounterIntent, string> = {
  UNSPECIFIED: 'Visit type — choose',

  REHAB_INITIAL_EVAL: 'Initial Evaluation',
  REHAB_DAILY_NOTE: 'Daily Note',
  REHAB_PROGRESS_NOTE: 'Progress Note',
  REHAB_REEVAL: 'Re-evaluation',
  REHAB_DISCHARGE: 'Discharge Summary',

  BH_INITIAL_ASSESSMENT: 'Initial Assessment',
  BH_SESSION_INDIVIDUAL: 'Individual Session',
  BH_SESSION_FAMILY: 'Family Session',
  BH_SESSION_GROUP: 'Group Session',
  BH_TREATMENT_PLAN_REVIEW: 'Treatment Plan Review',
  BH_CRISIS_REASSESSMENT: 'Crisis Re-assessment',
  BH_DISCHARGE: 'Discharge',

  MEDICAL_NEW_PATIENT: 'New Patient',
  MEDICAL_FOLLOW_UP: 'Follow-up',
  MEDICAL_ANNUAL_WELLNESS: 'Annual Wellness',
  MEDICAL_CHRONIC_CARE: 'Chronic Care',
  MEDICAL_ACUTE_VISIT: 'Acute Visit',
  MEDICAL_DISCHARGE_TCM: 'Discharge TCM',
  MEDICAL_TELEHEALTH_CHECKIN: 'Telehealth Check-in',
};

/**
 * Stable ordered list per division — drives the picker dropdown. Order
 * mirrors the taxonomy doc: archetype order (Initiation → Routine →
 * Periodic → Significant change → Termination). Override path always
 * presents intents in this order so the clinician's eye learns the
 * sequence across visits.
 */
const REHAB_INTENTS: EncounterIntent[] = [
  EncounterIntent.REHAB_INITIAL_EVAL,
  EncounterIntent.REHAB_DAILY_NOTE,
  EncounterIntent.REHAB_PROGRESS_NOTE,
  EncounterIntent.REHAB_REEVAL,
  EncounterIntent.REHAB_DISCHARGE,
];

const BH_INTENTS: EncounterIntent[] = [
  EncounterIntent.BH_INITIAL_ASSESSMENT,
  EncounterIntent.BH_SESSION_INDIVIDUAL,
  EncounterIntent.BH_SESSION_FAMILY,
  EncounterIntent.BH_SESSION_GROUP,
  EncounterIntent.BH_TREATMENT_PLAN_REVIEW,
  EncounterIntent.BH_CRISIS_REASSESSMENT,
  EncounterIntent.BH_DISCHARGE,
];

const MEDICAL_INTENTS: EncounterIntent[] = [
  EncounterIntent.MEDICAL_NEW_PATIENT,
  EncounterIntent.MEDICAL_FOLLOW_UP,
  EncounterIntent.MEDICAL_ANNUAL_WELLNESS,
  EncounterIntent.MEDICAL_CHRONIC_CARE,
  EncounterIntent.MEDICAL_ACUTE_VISIT,
  EncounterIntent.MEDICAL_DISCHARGE_TCM,
  EncounterIntent.MEDICAL_TELEHEALTH_CHECKIN,
];

/**
 * Returns the intent options the clinician can pick from in their division,
 * in stable archetype order. Used by the IntentChip's override dropdown.
 *
 * MULTI clinicians see ALL intents (their `professionType` decides what's
 * actually relevant today; the picker doesn't pre-judge).
 */
export function intentsForDivision(division: Division): EncounterIntent[] {
  switch (division) {
    case 'REHAB':
      return REHAB_INTENTS;
    case 'BEHAVIORAL_HEALTH':
      return BH_INTENTS;
    case 'MEDICAL':
      return MEDICAL_INTENTS;
    case 'MULTI':
    default:
      return [...REHAB_INTENTS, ...BH_INTENTS, ...MEDICAL_INTENTS];
  }
}
