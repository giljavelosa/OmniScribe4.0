-- Owner delete/restore flow: owner-only recovery ledger.
-- One row per soft-delete event (organization or user). Stores the original
-- identifying fields anonymized out of the live User row plus the OrgUser/Seat
-- ids the delete deactivated, so a platform-owner restore reverses exactly
-- those rows. Read only by /owner/deleted-data; every view is audited.

-- CreateEnum
CREATE TYPE "DeletedRecordType" AS ENUM ('ORGANIZATION', 'USER');

-- CreateTable
CREATE TABLE "DeletedRecordLedger" (
    "id" TEXT NOT NULL,
    "recordType" "DeletedRecordType" NOT NULL,
    "recordId" TEXT NOT NULL,
    "originalEmail" TEXT,
    "originalName" TEXT,
    "originalImage" TEXT,
    "originalPasswordHash" TEXT,
    "originalSigningPinHash" TEXT,
    "originalPlatformRole" "PlatformRole",
    "deactivatedOrgUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "deactivatedSeatIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "deletedAt" TIMESTAMP(3) NOT NULL,
    "deletedByUserId" TEXT,
    "restoredAt" TIMESTAMP(3),
    "restoredByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletedRecordLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeletedRecordLedger_recordType_restoredAt_idx" ON "DeletedRecordLedger"("recordType", "restoredAt");

-- CreateIndex
CREATE INDEX "DeletedRecordLedger_recordId_idx" ON "DeletedRecordLedger"("recordId");
