-- Data heal: align OrgUser.division with the clinician's profession.
--
-- Division is now DERIVED from profession (1:1 map, PROFESSION_TO_DIVISION) at
-- every user-creation path (self-serve signup, admin invite, invite acceptance,
-- and profile completion). This one-time pass corrects pre-existing rows whose
-- stored division contradicts their profession — e.g. a Physical Therapist who
-- self-registered under MEDICAL before the rule existed.
--
-- Rows with NO profession or professionType = 'OTHER' are LEFT UNTOUCHED: they
-- have no derivable division and legitimately fall back to the resolver's
-- clinician/org division chain (resolveDivisionForNote). VIEWER rows carry no
-- profession and are likewise untouched.
--
-- Idempotent + data-only (no schema change): each WHERE clause matches only
-- mismatched rows, so re-running is a no-op. OrgUser.division is NOT NULL, so
-- there are no NULL divisions to worry about; the `<>` filters exclude rows that
-- already match.

UPDATE "OrgUser"
SET "division" = 'MEDICAL'
WHERE "professionType" IN ('MD', 'DO', 'NP', 'PA', 'RN')
  AND "division" <> 'MEDICAL';

UPDATE "OrgUser"
SET "division" = 'REHAB'
WHERE "professionType" IN ('OT', 'PT', 'SLP')
  AND "division" <> 'REHAB';

UPDATE "OrgUser"
SET "division" = 'BEHAVIORAL_HEALTH'
WHERE "professionType" IN ('LCSW', 'LMFT', 'LPC', 'PSYCHOLOGIST')
  AND "division" <> 'BEHAVIORAL_HEALTH';
