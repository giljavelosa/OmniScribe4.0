-- Sprint 0.18 — Cleo's proactive nudges.
--
-- Additive only:
--   - Four new enums (CleoNudgeKind, CleoNudgePriority, CleoNudgeStatus,
--     CleoNudgeSurface). First introduction; append-only thereafter.
--   - New CleoNudge table with 7 FKs (Organization + Patient + OrgUser
--     for owners; User × 3 for lifecycle authors) + 4 indexes including
--     the compound unique that anchors the upsert path:
--     (clinicianOrgUserId, patientId, kind, sourcePatternSnapshotHash).
--
-- No existing column or enum is modified. Per anti-regression rule 4,
-- `npx prisma db seed` is run after this migration applies. No backfill
-- required — nudges are created on demand by the cleo-state worker the
-- next time it rebuilds per-(patient × clinician) state; an empty
-- CleoNudge table is the correct steady state.

-- CreateEnum
CREATE TYPE "CleoNudgeKind" AS ENUM ('RECERT_DUE_SOON', 'CASE_FHIR_STATUS_DRIFT', 'FHIR_WRITEBACK_FAILED_PERMANENT', 'MEASURE_TREND', 'GOAL_STALLED', 'TOPIC_MENTIONED_UNADDRESSED');

-- CreateEnum
CREATE TYPE "CleoNudgePriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "CleoNudgeStatus" AS ENUM ('PROPOSED', 'SHOWN', 'DISMISSED', 'SNOOZED', 'ACTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CleoNudgeSurface" AS ENUM ('CHART', 'VISIT_PREPARE', 'BOTH');

-- CreateTable
CREATE TABLE "CleoNudge" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicianOrgUserId" TEXT NOT NULL,
    "kind" "CleoNudgeKind" NOT NULL,
    "priority" "CleoNudgePriority" NOT NULL,
    "eligibleSurfaces" "CleoNudgeSurface" NOT NULL DEFAULT 'BOTH',
    "sourcePatternSnapshotHash" TEXT NOT NULL,
    "sourcePatternSnapshotJson" JSONB NOT NULL,
    "affordanceSlug" TEXT NOT NULL,
    "status" "CleoNudgeStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shownAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "dismissedByUserId" TEXT,
    "snoozedAt" TIMESTAMP(3),
    "snoozedByUserId" TEXT,
    "snoozeUntil" TIMESTAMP(3),
    "actedAt" TIMESTAMP(3),
    "actedByUserId" TEXT,
    "actedAction" TEXT,
    "expiredAt" TIMESTAMP(3),
    "personaVersion" TEXT NOT NULL DEFAULT 'miss-cleo-v1',

    CONSTRAINT "CleoNudge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CleoNudge_orgId_patientId_clinicianOrgUserId_status_idx" ON "CleoNudge"("orgId", "patientId", "clinicianOrgUserId", "status");

-- CreateIndex
CREATE INDEX "CleoNudge_clinicianOrgUserId_status_idx" ON "CleoNudge"("clinicianOrgUserId", "status");

-- CreateIndex
CREATE INDEX "CleoNudge_proposedAt_idx" ON "CleoNudge"("proposedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CleoNudge_clinicianOrgUserId_patientId_kind_sourcePatternSn_key" ON "CleoNudge"("clinicianOrgUserId", "patientId", "kind", "sourcePatternSnapshotHash");

-- AddForeignKey
ALTER TABLE "CleoNudge" ADD CONSTRAINT "CleoNudge_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleoNudge" ADD CONSTRAINT "CleoNudge_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleoNudge" ADD CONSTRAINT "CleoNudge_clinicianOrgUserId_fkey" FOREIGN KEY ("clinicianOrgUserId") REFERENCES "OrgUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleoNudge" ADD CONSTRAINT "CleoNudge_dismissedByUserId_fkey" FOREIGN KEY ("dismissedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleoNudge" ADD CONSTRAINT "CleoNudge_snoozedByUserId_fkey" FOREIGN KEY ("snoozedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleoNudge" ADD CONSTRAINT "CleoNudge_actedByUserId_fkey" FOREIGN KEY ("actedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
