-- Sprint 0.16 — FHIR Phase D₂ reconciliation.
--
-- Additive only:
--   - New enum CaseFhirDriftKind (STATUS, ICD).
--   - New table CaseFhirDriftLog with 5 FKs + 3 indexes.
--
-- No existing column or enum is modified. Per anti-regression rule 4,
-- `npx prisma db seed` is run after this migration applies; no backfill
-- required because:
--   - The default state of every existing case is "no drift detected yet"
--     (i.e. zero rows in the new table) and the case-router worker will
--     populate rows on the next routing run for any mirrored case whose
--     Condition has drifted.
--   - `mirrorsFhirConditionId` (added in Sprint 0.13, populated in 0.15)
--     is the precondition for drift detection; rows without it never
--     join into this table.

-- CreateEnum
CREATE TYPE "CaseFhirDriftKind" AS ENUM ('STATUS', 'ICD');

-- CreateTable
CREATE TABLE "CaseFhirDriftLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "caseManagementId" TEXT NOT NULL,
    "fhirConditionId" TEXT NOT NULL,
    "driftKind" "CaseFhirDriftKind" NOT NULL,
    "caseStatusAtDetection" "CaseManagementStatus" NOT NULL,
    "caseIcdAtDetection" TEXT,
    "caseIcdLabelAtDetection" TEXT,
    "conditionStatusAtDetection" TEXT NOT NULL,
    "conditionIcdAtDetection" TEXT NOT NULL,
    "conditionIcdLabelAtDetection" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detectedByRunId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedAction" TEXT,
    "resolvedByUserId" TEXT,

    CONSTRAINT "CaseFhirDriftLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaseFhirDriftLog_orgId_patientId_resolvedAt_idx" ON "CaseFhirDriftLog"("orgId", "patientId", "resolvedAt");

-- CreateIndex
CREATE INDEX "CaseFhirDriftLog_caseManagementId_resolvedAt_idx" ON "CaseFhirDriftLog"("caseManagementId", "resolvedAt");

-- CreateIndex
CREATE INDEX "CaseFhirDriftLog_detectedAt_idx" ON "CaseFhirDriftLog"("detectedAt");

-- AddForeignKey
ALTER TABLE "CaseFhirDriftLog" ADD CONSTRAINT "CaseFhirDriftLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFhirDriftLog" ADD CONSTRAINT "CaseFhirDriftLog_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFhirDriftLog" ADD CONSTRAINT "CaseFhirDriftLog_caseManagementId_fkey" FOREIGN KEY ("caseManagementId") REFERENCES "CaseManagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFhirDriftLog" ADD CONSTRAINT "CaseFhirDriftLog_detectedByRunId_fkey" FOREIGN KEY ("detectedByRunId") REFERENCES "CaseRouterRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFhirDriftLog" ADD CONSTRAINT "CaseFhirDriftLog_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
