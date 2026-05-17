-- AlterTable
ALTER TABLE "EpisodeOfCare" ADD COLUMN     "closeReason" TEXT,
ADD COLUMN     "recertIntervalDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "reopenReason" TEXT;

-- CreateIndex
CREATE INDEX "EpisodeOfCare_orgId_status_recertDueAt_idx" ON "EpisodeOfCare"("orgId", "status", "recertDueAt");
