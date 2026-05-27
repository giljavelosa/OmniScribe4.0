-- Flag-analysis lifecycle tracking on Note.
--
-- Background
-- ----------
-- The pre-existing flow:
--   1. Clinician clicks "Analyze for flags" on /review.
--   2. POST /api/notes/[id]/analyze-flags enqueues a BullMQ job.
--   3. The worker analyzes each section serially (per-section LLM call).
--   4. The UI polls /flags every 3 s for up to 36 s.
--
-- Two cracks in this:
--   a. The polling treats "count unchanged after 36 s" as "no flags found",
--      which is a false negative when analysis is still running.
--   b. The sign route had no awareness of the analyzer's state — a
--      clinician could navigate to /sign and sign while the worker was
--      still computing flags. RED flags then surfaced AFTER signing on
--      an immutable note, which violates rule 3 (signed notes' compliance
--      posture is whatever was decided at sign time).
--
-- This migration adds two timestamps so the sign route + UI can know
-- whether analysis is currently in flight, and so the worker can be
-- scheduled to mark itself complete (in finally) regardless of error or
-- mid-run note-status flip.
--
--   flagAnalysisStartedAt   = stamped by POST /analyze-flags when a job
--                             is enqueued. Cleared/overwritten on each
--                             new request so the latest run wins.
--   flagAnalysisCompletedAt = stamped by the worker in finally. NULL
--                             (or strictly < startedAt) means "pending".
--
-- Append-only column add — rule 1; existing rows back-fill to NULL =
-- "never analyzed", which the gate treats as "not pending".

ALTER TABLE "Note"
  ADD COLUMN "flagAnalysisStartedAt"   TIMESTAMP(3),
  ADD COLUMN "flagAnalysisCompletedAt" TIMESTAMP(3);
