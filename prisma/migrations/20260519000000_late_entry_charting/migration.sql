-- Late-entry charting.
-- Spec: context/specs/late-entry-charting.md
--
-- Append-only (rule 1). Three new columns on Note — no existing tables touched,
-- nothing renamed, NoteStatus enum untouched (rule 2). The defaults are chosen
-- so existing rows back-fill cleanly without a follow-up DML pass:
--   dateOfService    DEFAULT now() → for rows inserted after migration. Existing
--                     rows are explicitly back-filled to createdAt so dateOfService
--                     matches the historical "when the visit happened" anchor.
--   isLateEntry      DEFAULT false → matches the not-a-late-entry case.
--   lateEntryDaysGap NULL          → no value for normal visits.

-- AddColumn
ALTER TABLE "Note"
  ADD COLUMN "dateOfService"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "isLateEntry"      BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN "lateEntryDaysGap" INTEGER;

-- Back-fill: existing notes are treated as on-time (isLateEntry=false,
-- lateEntryDaysGap=NULL — both already the column defaults) with dateOfService
-- = createdAt so the historical date-of-service anchor matches when the visit
-- was charted. Without this, every pre-migration note would have
-- dateOfService = the migration timestamp.
UPDATE "Note" SET "dateOfService" = "createdAt";
