-- Drop Patient.division.
--
-- Note division is now derived from the recording clinician's profession
-- (see src/lib/divisions/resolve.ts + src/lib/professions.ts). The patient-
-- level division field was a vestigial fallback that reinforced the
-- misconception that patients are bound to a single division — they aren't.
-- A patient can be seen by an MD, PT, and LCSW in the same care arc, and
-- each clinician records in their own division.
--
-- No indexes referenced this column. Safe single-column drop.

ALTER TABLE "Patient" DROP COLUMN "division";
