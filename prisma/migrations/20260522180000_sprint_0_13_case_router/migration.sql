-- Sprint 0.13: Miss Cleo's case-router agent (Phase A schema)
-- Append-only per anti-regression rules 1, 2, 4. Migration is fully additive:
--   * `PENDING_ROUTER` appended to CaseManagementStatus (rule 2)
--   * `RouterConfidence` enum is brand new
--   * `CaseRouterRun` table is brand new
--   * `mirrorsFhirConditionId` is a nullable column on CaseManagement

-- Append PENDING_ROUTER to CaseManagementStatus.
ALTER TYPE "CaseManagementStatus" ADD VALUE IF NOT EXISTS 'PENDING_ROUTER';

-- Forward-compatible nullable column for Sprint 0.15 FHIR mirroring.
ALTER TABLE "CaseManagement"
  ADD COLUMN IF NOT EXISTS "mirrorsFhirConditionId" TEXT;

-- New enum for Miss Cleo's confidence rubric.
CREATE TYPE "RouterConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- New table for the case-router run history (1:1 with Note).
CREATE TABLE "CaseRouterRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "proposalJson" JSONB NOT NULL,
    "confidence" "RouterConfidence" NOT NULL,
    "reasoning" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAction" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,

    CONSTRAINT "CaseRouterRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CaseRouterRun_noteId_key" ON "CaseRouterRun"("noteId");
CREATE INDEX "CaseRouterRun_orgId_createdAt_idx" ON "CaseRouterRun"("orgId", "createdAt");

ALTER TABLE "CaseRouterRun"
  ADD CONSTRAINT "CaseRouterRun_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CaseRouterRun"
  ADD CONSTRAINT "CaseRouterRun_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "Note"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CaseRouterRun"
  ADD CONSTRAINT "CaseRouterRun_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
