-- Sprint pre-sign-followup-suggest — Cleo proposes follow-ups from the DRAFT
-- Plan section on /review pre-sign; clinician triages each row before sign;
-- unreviewed proposals auto-DROP at sign-time.
--
-- Additive only:
--   - FollowUpStatus enum gains a new PROPOSED value (prepended; pre-existing
--     OPEN/MET/CARRIED/DROPPED/CLOSED_BY_DISCHARGE values untouched).
--   - FollowUp gains three nullable provenance columns
--     (proposedSourceText, proposedExtractorVersion, proposedFromHash).
--     All three are NULL for existing rows + for manually-added or post-
--     sign-extracted rows; populated only when Cleo's draft-tool created
--     the row.
--   - New compound index (originNoteId, status) for fast lookup of PROPOSED
--     rows attached to a specific draft note (the /review card's main query).
--
-- No existing column, enum value, or index is modified or dropped. Per
-- anti-regression rule 4, `npx prisma db seed` is run after this migration
-- applies (no seed data changes required — empty PROPOSED state is the
-- correct steady state for existing patients).

-- AlterEnum
ALTER TYPE "FollowUpStatus" ADD VALUE 'PROPOSED' BEFORE 'OPEN';

-- AlterTable
ALTER TABLE "FollowUp" ADD COLUMN     "proposedExtractorVersion" TEXT,
ADD COLUMN     "proposedFromHash" TEXT,
ADD COLUMN     "proposedSourceText" TEXT;

-- CreateIndex
CREATE INDEX "FollowUp_originNoteId_status_idx" ON "FollowUp"("originNoteId", "status");
