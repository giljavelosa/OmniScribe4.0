-- Unit 48 PR1 — Visit-type intent on Encounter.
--
-- Additive only:
--   - Two new enums (EncounterIntent, IntentSource). First introduction;
--     append-only thereafter per anti-regression rule 2 (same discipline
--     as NoteStatus).
--   - Two new columns on Encounter (intent, intentSource) with constant
--     defaults — metadata-only on PG11+; safe on a hot table.
--
-- No existing column or enum is modified. No data backfill required:
-- all existing Encounter rows receive `intent = UNSPECIFIED` +
-- `intentSource = CLINICIAN` from the column defaults, which is the
-- correct semantics for any encounter created before Unit 48 (intent
-- wasn't tracked, so the only honest stance is "unspecified, recorded by
-- the clinician implicitly").
--
-- Per anti-regression rule 4, `npx prisma db seed` is run after this
-- migration applies (seed doesn't need to populate intent — the defaults
-- are correct for seeded fixtures too).
--
-- Spec: context/specs/48-pre-visit-brief-intent.md §A
-- Taxonomy: references/visit-type-taxonomy.md §6

-- CreateEnum
CREATE TYPE "EncounterIntent" AS ENUM (
    'UNSPECIFIED',
    'REHAB_INITIAL_EVAL',
    'REHAB_DAILY_NOTE',
    'REHAB_PROGRESS_NOTE',
    'REHAB_REEVAL',
    'REHAB_DISCHARGE',
    'BH_INITIAL_ASSESSMENT',
    'BH_SESSION_INDIVIDUAL',
    'BH_SESSION_FAMILY',
    'BH_SESSION_GROUP',
    'BH_TREATMENT_PLAN_REVIEW',
    'BH_CRISIS_REASSESSMENT',
    'BH_DISCHARGE',
    'MEDICAL_NEW_PATIENT',
    'MEDICAL_FOLLOW_UP',
    'MEDICAL_ANNUAL_WELLNESS',
    'MEDICAL_CHRONIC_CARE',
    'MEDICAL_ACUTE_VISIT',
    'MEDICAL_DISCHARGE_TCM',
    'MEDICAL_TELEHEALTH_CHECKIN'
);

-- CreateEnum
CREATE TYPE "IntentSource" AS ENUM (
    'CLINICIAN',
    'COPILOT_PROPOSAL_CONFIRMED',
    'SCHEDULE'
);

-- AlterTable
ALTER TABLE "Encounter"
    ADD COLUMN "intent" "EncounterIntent" NOT NULL DEFAULT 'UNSPECIFIED',
    ADD COLUMN "intentSource" "IntentSource" NOT NULL DEFAULT 'CLINICIAN';
