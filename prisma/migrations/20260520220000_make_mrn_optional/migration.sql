-- Sprint 0.5: MRN is now optional on Patient.
-- The unique index on (orgId, mrn) remains — PostgreSQL excludes NULLs
-- from unique indexes automatically, so multiple patients with mrn = NULL
-- are allowed without violating the constraint.

ALTER TABLE "Patient" ALTER COLUMN "mrn" DROP NOT NULL;
