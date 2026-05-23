-- Sprint 0.17 — FHIR Phase D₃ write-back.
--
-- Additive only:
--   - Three new enums (FhirWriteBackOperation, FhirWriteBackStatus,
--     FhirWriteBackFailureKind).
--   - Three new columns on OrgEhrConnection (writebackEnabled +
--     writebackEnabledAt + writebackEnabledByUserId). The boolean
--     defaults FALSE for every existing org — decision 10 / backward
--     compatibility: with the toggle off, the accept endpoint runs
--     Sprint 0.16's exact code path.
--   - New FhirWriteBackProposal table with 8 FKs + 5 indexes including
--     a unique idempotencyKey for OS-side dedup.
--
-- No existing column or enum is modified. Per anti-regression rule 4,
-- `npx prisma db seed` is run after this migration applies. No backfill
-- required — proposals are inserted on demand by the accept endpoint;
-- an empty FhirWriteBackProposal table is the correct steady state.

-- CreateEnum
CREATE TYPE "FhirWriteBackOperation" AS ENUM ('CREATE', 'PATCH');

-- CreateEnum
CREATE TYPE "FhirWriteBackStatus" AS ENUM ('PROPOSED', 'APPROVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FhirWriteBackFailureKind" AS ENUM ('TRANSIENT', 'PERMANENT', 'CONFLICT');

-- AlterTable
ALTER TABLE "OrgEhrConnection" ADD COLUMN     "writebackEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "writebackEnabledAt" TIMESTAMP(3),
ADD COLUMN     "writebackEnabledByUserId" TEXT;

-- CreateTable
CREATE TABLE "FhirWriteBackProposal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseManagementId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "proposedByUserId" TEXT NOT NULL,
    "triggerKind" TEXT NOT NULL,
    "caseRouterRunId" TEXT,
    "driftLogId" TEXT,
    "operation" "FhirWriteBackOperation" NOT NULL,
    "fhirConditionId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "ifMatchVersion" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "FhirWriteBackStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "executingAt" TIMESTAMP(3),
    "succeededAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "resultFhirId" TEXT,
    "resultFhirVersion" TEXT,
    "failureKind" "FhirWriteBackFailureKind",
    "failureMessage" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FhirWriteBackProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FhirWriteBackProposal_idempotencyKey_key" ON "FhirWriteBackProposal"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FhirWriteBackProposal_orgId_status_idx" ON "FhirWriteBackProposal"("orgId", "status");

-- CreateIndex
CREATE INDEX "FhirWriteBackProposal_caseManagementId_idx" ON "FhirWriteBackProposal"("caseManagementId");

-- CreateIndex
CREATE INDEX "FhirWriteBackProposal_patientId_status_idx" ON "FhirWriteBackProposal"("patientId", "status");

-- CreateIndex
CREATE INDEX "FhirWriteBackProposal_proposedAt_idx" ON "FhirWriteBackProposal"("proposedAt");

-- AddForeignKey
ALTER TABLE "FhirWriteBackProposal" ADD CONSTRAINT "FhirWriteBackProposal_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FhirWriteBackProposal" ADD CONSTRAINT "FhirWriteBackProposal_caseManagementId_fkey" FOREIGN KEY ("caseManagementId") REFERENCES "CaseManagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FhirWriteBackProposal" ADD CONSTRAINT "FhirWriteBackProposal_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FhirWriteBackProposal" ADD CONSTRAINT "FhirWriteBackProposal_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FhirWriteBackProposal" ADD CONSTRAINT "FhirWriteBackProposal_caseRouterRunId_fkey" FOREIGN KEY ("caseRouterRunId") REFERENCES "CaseRouterRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FhirWriteBackProposal" ADD CONSTRAINT "FhirWriteBackProposal_driftLogId_fkey" FOREIGN KEY ("driftLogId") REFERENCES "CaseFhirDriftLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FhirWriteBackProposal" ADD CONSTRAINT "FhirWriteBackProposal_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FhirWriteBackProposal" ADD CONSTRAINT "FhirWriteBackProposal_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
