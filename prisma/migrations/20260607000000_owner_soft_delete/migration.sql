-- Owner delete flow: operational soft-delete for users and organizations.
-- Clinical records and audit logs remain retained; owner/app surfaces hide
-- deleted rows and access gates reject them.

ALTER TABLE "Organization"
  ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedByUserId" TEXT;

ALTER TABLE "User"
  ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedByUserId" TEXT;

CREATE INDEX "Organization_isDeleted_idx" ON "Organization"("isDeleted");
