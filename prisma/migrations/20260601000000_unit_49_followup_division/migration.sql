-- Unit 49 PR2 — FollowUp.division stamp + backfill + index.
--
-- Closes the rule-consistency hole opened by PR1 (Case-Division Rule). PR1
-- pinned every CaseManagement to a division and gated writes via
-- assertCanContinueCase. But follow-ups inherit nothing today, so a
-- different-division clinician could still:
--
--   (a) See another division's open follow-ups in their brief and triage
--       them (MET / DROPPED / CARRIED) — a PT could close a primary-care
--       MD's commitment from their /home view.
--   (b) The brief query at src/workers/note-brief/handler.ts:231 fans
--       across ALL open follow-ups for the patient regardless of viewer
--       division — fundamentally incompatible with the case-division rule.
--
-- This migration adds `FollowUp.division Division NOT NULL` so every row
-- carries its origin note's division. The triage route + brief query both
-- enforce `division IN (viewer, MULTI)` at write/read boundaries. PR3
-- builds on this column to give Miss Cleo's biller advisor a same-
-- division view of the patient's follow-up commitments without bleed.
--
-- Per rule 1 (Prisma append-only) + rule 4 (re-seed required after schema
-- change), this is a SCHEMA ADD ONLY — no FollowUp rows are deleted. The
-- backfill covers every existing row from its origin note's division; any
-- orphan (origin note row missing — defensively handled though no current
-- code path soft-deletes notes) falls to MULTI as the escape hatch.

-- Step 1: add nullable column so backfill can populate before the NOT NULL flip.
ALTER TABLE "FollowUp" ADD COLUMN "division" "Division";

-- Step 2: backfill from each follow-up's origin note.
UPDATE "FollowUp" f
SET    "division" = n."division"
FROM   "Note" n
WHERE  n."id" = f."originNoteId"
  AND  f."division" IS NULL;

-- Step 3: backfill orphans (origin note missing — defensive; no current
-- soft-delete path on Note but the safety net keeps the NOT NULL flip
-- from failing on a degenerate dataset).
UPDATE "FollowUp" SET "division" = 'MULTI' WHERE "division" IS NULL;

-- Step 4: enforce NOT NULL — the rule is structural.
ALTER TABLE "FollowUp" ALTER COLUMN "division" SET NOT NULL;

-- Step 5: compound index for the division-scoped brief + triage queries.
-- Matches the pattern PR1 added to CaseManagement.
CREATE INDEX IF NOT EXISTS "FollowUp_orgId_patientId_division_status_idx"
  ON "FollowUp" ("orgId", "patientId", "division", "status");
