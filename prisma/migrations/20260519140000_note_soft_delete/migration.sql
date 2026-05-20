-- Note soft-delete.
--
-- A clinician can discard an UNSIGNED note (a draft). The row is retained
-- for audit and the S3 audio is left intact (anti-regression rule 7) —
-- this is a soft delete, mirroring Patient.isDeleted. Signed notes
-- (status SIGNED / TRANSFERRED) are immutable records and are never
-- deletable; that's enforced in the DELETE route, not the schema.

ALTER TABLE "Note" ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Note" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Note_orgId_isDeleted_idx" ON "Note" ("orgId", "isDeleted");
