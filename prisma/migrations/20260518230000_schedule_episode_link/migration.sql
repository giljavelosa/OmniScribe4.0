-- Schedule → EpisodeOfCare optional link.
--
-- Adds an optional `episodeOfCareId` to Schedule so a scheduler can pre-link
-- a visit to a specific episode at the time the appointment is booked. The
-- start-visit pipeline (src/lib/encounters/start.ts) prefers an explicit
-- caller-supplied episodeId; this column lets the schedule-start route
-- inherit one without a runtime picker.
--
-- Append-only (rule 1): nullable column + index + FK, nothing renamed.

ALTER TABLE "Schedule"
  ADD COLUMN "episodeOfCareId" TEXT;

CREATE INDEX "Schedule_episodeOfCareId_idx"
  ON "Schedule"("episodeOfCareId");

ALTER TABLE "Schedule"
  ADD CONSTRAINT "Schedule_episodeOfCareId_fkey"
  FOREIGN KEY ("episodeOfCareId")
  REFERENCES "EpisodeOfCare"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
