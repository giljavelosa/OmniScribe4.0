-- Unit 49 PR1 §A — CaseManagement.division stamp.
--
-- Adds a `division` column to `CaseManagement` and backfills it from
-- the opening clinician's division (or, if that's missing, the first
-- encounter's department division, or `MULTI` as a last resort). The
-- column is enforced NOT NULL at the end of the migration.
--
-- This is the schema half of the case-division rule: cases are now
-- defined by ICD codes AND division. Only same-division clinicians
-- (or `MULTI`) may attach a visit / sign a note against a case;
-- enforced via `assertCanContinueCase` (`src/lib/case-access.ts`) at
-- the API write boundaries (case-router/accept, edit-case,
-- continue-case). The wire-in lands in PR1 §C; this migration is the
-- structural prerequisite.
--
-- Per anti-regression rule 4, `npx prisma db seed` is run after this
-- migration applies. Per rule 2 (append-only enums), `Division` is
-- unchanged — only a new column references it.
--
-- Backfill rationale:
--   1. Opener's division is the strongest signal (the clinician who
--      created the case carries the profession that should bill it).
--   2. If opener is missing (system-created or migrated rows), fall
--      back to the first encounter's department division — departments
--      already carry a division and are scoped per discipline.
--   3. `MULTI` is the last resort for truly orphan rows; intentionally
--      permissive so the migration doesn't fail on edge data, but
--      operationally these should be rare and re-stamped at next
--      visit-attach.

-- Step 1: add the column nullable so the backfill UPDATE can run.
ALTER TABLE "CaseManagement" ADD COLUMN "division" "Division";

-- Step 2: backfill from opener → department → MULTI.
UPDATE "CaseManagement" c
SET    "division" = COALESCE(
         (SELECT u."division"
            FROM "OrgUser" u
           WHERE u."id" = c."openedByOrgUserId"),
         (SELECT d."division"
            FROM "Encounter" e
            JOIN "Department" d ON d."id" = e."departmentId"
           WHERE e."caseManagementId" = c."id"
           ORDER BY e."createdAt" ASC
           LIMIT 1),
         'MULTI'::"Division"
       );

-- Step 3: enforce NOT NULL now that every row has a value.
ALTER TABLE "CaseManagement" ALTER COLUMN "division" SET NOT NULL;

-- Step 4: composite index supporting the silent off-division filter
-- (cases panel, case picker, home dashboard) added in PR1 §E.
CREATE INDEX "CaseManagement_orgId_patientId_division_status_idx"
  ON "CaseManagement" ("orgId", "patientId", "division", "status");
