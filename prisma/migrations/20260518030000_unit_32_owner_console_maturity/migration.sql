-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('STARTER', 'PROFESSIONAL', 'ENTERPRISE', 'CUSTOM');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "subscriptionOverrideNotes" TEXT,
ADD COLUMN     "subscriptionPlan" "SubscriptionPlan" NOT NULL DEFAULT 'STARTER';

-- CreateTable
CREATE TABLE "OrgUsageDaily" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "notesSigned" INTEGER NOT NULL DEFAULT 0,
    "transcriptionMinutes" INTEGER NOT NULL DEFAULT 0,
    "copilotAsks" INTEGER NOT NULL DEFAULT 0,
    "draftsAccepted" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "computedAtSourceCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrgUsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgUsageDaily_orgId_day_idx" ON "OrgUsageDaily"("orgId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "OrgUsageDaily_orgId_day_key" ON "OrgUsageDaily"("orgId", "day");

-- CreateIndex
CREATE INDEX "Organization_subscriptionPlan_idx" ON "Organization"("subscriptionPlan");

-- AddForeignKey
ALTER TABLE "OrgUsageDaily" ADD CONSTRAINT "OrgUsageDaily_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
