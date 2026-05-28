-- Unit 51: Commercial capacity — visit bank, wallets, catalog, contracts.

-- CreateEnum
CREATE TYPE "CommercialModel" AS ENUM ('TRIAL', 'SOLO_VISIT_BANK', 'ORG_VISIT_BANK', 'ENTERPRISE_PER_SEAT', 'LEGACY_SKU');
CREATE TYPE "VisitCreditBasis" AS ENUM ('COMMITTED', 'ACTIVE');
CREATE TYPE "VisitDebitOrder" AS ENUM ('USER_WALLET_THEN_BANK', 'BANK_ONLY');
CREATE TYPE "MonthlyAllowancePolicy" AS ENUM ('EXPIRE', 'ROLLOVER_USER', 'SWEEP_TO_BANK');
CREATE TYPE "VisitLedgerSourceType" AS ENUM ('TRIAL_GRANT', 'CONTRACT_BUNDLE', 'MONTHLY_ALLOWANCE', 'BUNDLE_PURCHASE', 'OWNER_GRANT', 'ADMIN_ALLOCATE', 'ADMIN_RECLAIM', 'NOTE_DEBIT', 'ADJUSTMENT', 'REQUEST_APPROVED');
CREATE TYPE "VisitCapacityRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');

-- AlterTable Organization
ALTER TABLE "Organization" ADD COLUMN "visitBankBalance" INTEGER NOT NULL DEFAULT 0;

-- AlterTable OrgUser
ALTER TABLE "OrgUser" ADD COLUMN "visitWalletBalance" INTEGER NOT NULL DEFAULT 0;

-- CreateTable PlatformBillingCatalog
CREATE TABLE "PlatformBillingCatalog" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "soloTiersJson" JSONB NOT NULL,
    "visitBundlesJson" JSONB NOT NULL,
    "collaboratorSeatPriceCents" INTEGER NOT NULL,
    "defaultOveragePriceCents" INTEGER NOT NULL,
    "trialSoloVisits" INTEGER NOT NULL,
    "trialSoloDays" INTEGER NOT NULL,
    "trialOrgSeats" INTEGER NOT NULL,
    "trialOrgVisits" INTEGER NOT NULL,
    "trialOrgDays" INTEGER NOT NULL,
    "enterpriseTemplateJson" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformBillingCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable OrganizationCommercialContract
CREATE TABLE "OrganizationCommercialContract" (
    "orgId" TEXT NOT NULL,
    "commercialModel" "CommercialModel" NOT NULL DEFAULT 'TRIAL',
    "catalogVersionId" TEXT,
    "committedSeats" INTEGER NOT NULL DEFAULT 1,
    "contractStart" TIMESTAMP(3),
    "contractEnd" TIMESTAMP(3),
    "seatPriceCents" INTEGER,
    "visitsPerSeatPerMonth" INTEGER,
    "visitCreditBasis" "VisitCreditBasis" NOT NULL DEFAULT 'COMMITTED',
    "seatBillBasis" "VisitCreditBasis" NOT NULL DEFAULT 'COMMITTED',
    "monthlyAllowancePolicy" "MonthlyAllowancePolicy" NOT NULL DEFAULT 'SWEEP_TO_BANK',
    "monthlyAllowanceRolloverCap" INTEGER,
    "signingBundleVisits" INTEGER NOT NULL DEFAULT 0,
    "overagePriceCents" INTEGER,
    "allowOverage" BOOLEAN NOT NULL DEFAULT false,
    "allowUserVisitRequests" BOOLEAN NOT NULL DEFAULT true,
    "visitDebitOrder" "VisitDebitOrder" NOT NULL DEFAULT 'USER_WALLET_THEN_BANK',
    "monthlyTierId" TEXT,
    "monthlyPriceOverrideCents" INTEGER,
    "monthlyVisitCreditOverride" INTEGER,
    "trialEndsAt" TIMESTAMP(3),
    "capacityEnforcementEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationCommercialContract_pkey" PRIMARY KEY ("orgId")
);

-- CreateTable VisitLedgerEntry
CREATE TABLE "VisitLedgerEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orgUserId" TEXT,
    "amount" INTEGER NOT NULL,
    "orgBankBalanceAfter" INTEGER NOT NULL,
    "userWalletBalanceAfter" INTEGER,
    "sourceType" "VisitLedgerSourceType" NOT NULL,
    "sourceId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable VisitCapacityRequest
CREATE TABLE "VisitCapacityRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requesterOrgUserId" TEXT NOT NULL,
    "requestedVisits" INTEGER NOT NULL,
    "message" VARCHAR(500),
    "status" "VisitCapacityRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerOrgUserId" TEXT,
    "responseNote" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitCapacityRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformBillingCatalog_version_key" ON "PlatformBillingCatalog"("version");
CREATE INDEX "PlatformBillingCatalog_isActive_idx" ON "PlatformBillingCatalog"("isActive");
CREATE INDEX "VisitLedgerEntry_orgId_createdAt_idx" ON "VisitLedgerEntry"("orgId", "createdAt");
CREATE INDEX "VisitLedgerEntry_orgUserId_createdAt_idx" ON "VisitLedgerEntry"("orgUserId", "createdAt");
CREATE UNIQUE INDEX "VisitLedgerEntry_idempotencyKey_key" ON "VisitLedgerEntry"("idempotencyKey");
CREATE INDEX "VisitCapacityRequest_orgId_status_idx" ON "VisitCapacityRequest"("orgId", "status");
CREATE INDEX "VisitCapacityRequest_requesterOrgUserId_createdAt_idx" ON "VisitCapacityRequest"("requesterOrgUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrganizationCommercialContract" ADD CONSTRAINT "OrganizationCommercialContract_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationCommercialContract" ADD CONSTRAINT "OrganizationCommercialContract_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "PlatformBillingCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisitLedgerEntry" ADD CONSTRAINT "VisitLedgerEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitLedgerEntry" ADD CONSTRAINT "VisitLedgerEntry_orgUserId_fkey" FOREIGN KEY ("orgUserId") REFERENCES "OrgUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisitCapacityRequest" ADD CONSTRAINT "VisitCapacityRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitCapacityRequest" ADD CONSTRAINT "VisitCapacityRequest_requesterOrgUserId_fkey" FOREIGN KEY ("requesterOrgUserId") REFERENCES "OrgUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitCapacityRequest" ADD CONSTRAINT "VisitCapacityRequest_reviewerOrgUserId_fkey" FOREIGN KEY ("reviewerOrgUserId") REFERENCES "OrgUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
