-- Sprint 0.11: CaseManagement umbrella + REHAB-only EpisodeOfCare

-- CreateEnum
CREATE TYPE "CaseManagementStatus" AS ENUM ('ACTIVE', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "CaseManagement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "primaryIcd" TEXT,
    "primaryIcdLabel" TEXT NOT NULL,
    "secondaryIcd" TEXT,
    "secondaryIcdLabel" TEXT,
    "description" TEXT,
    "status" "CaseManagementStatus" NOT NULL DEFAULT 'ACTIVE',
    "openedByOrgUserId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedByOrgUserId" TEXT,
    "closeReason" TEXT,

    CONSTRAINT "CaseManagement_pkey" PRIMARY KEY ("id")
);

-- AlterTable (nullable first for backfill)
ALTER TABLE "EpisodeOfCare" ADD COLUMN "caseManagementId" TEXT,
ADD COLUMN "primaryIcd" TEXT,
ADD COLUMN "primaryIcdLabel" TEXT,
ADD COLUMN "secondaryIcd" TEXT,
ADD COLUMN "secondaryIcdLabel" TEXT;

ALTER TABLE "Encounter" ADD COLUMN "caseManagementId" TEXT;

-- Backfill: one CaseManagement per existing EpisodeOfCare
INSERT INTO "CaseManagement" (
    "id",
    "orgId",
    "patientId",
    "primaryIcd",
    "primaryIcdLabel",
    "description",
    "status",
    "openedByOrgUserId",
    "openedAt"
)
SELECT
    'cm-from-ep-' || e."id",
    e."orgId",
    e."patientId",
    NULL,
    e."diagnosis",
    e."bodyPart",
    CASE e."status"
        WHEN 'DISCHARGED' THEN 'CLOSED'::"CaseManagementStatus"
        WHEN 'CANCELLED' THEN 'CANCELLED'::"CaseManagementStatus"
        ELSE 'ACTIVE'::"CaseManagementStatus"
    END,
    e."clinicianOrgUserId",
    e."startedAt"
FROM "EpisodeOfCare" e;

UPDATE "EpisodeOfCare" e
SET
    "caseManagementId" = 'cm-from-ep-' || e."id",
    "primaryIcdLabel" = CASE WHEN e."division" = 'REHAB' THEN e."diagnosis" ELSE NULL END
WHERE "caseManagementId" IS NULL;

-- Encounters linked to an episode inherit its case
UPDATE "Encounter" enc
SET "caseManagementId" = e."caseManagementId"
FROM "EpisodeOfCare" e
WHERE enc."episodeOfCareId" = e."id"
  AND enc."caseManagementId" IS NULL;

-- Ad-hoc encounters (no episode): one synthetic case per patient
INSERT INTO "CaseManagement" (
    "id",
    "orgId",
    "patientId",
    "primaryIcd",
    "primaryIcdLabel",
    "status",
    "openedAt"
)
SELECT DISTINCT
    'cm-uncat-' || enc."patientId",
    enc."orgId",
    enc."patientId",
    NULL,
    'Uncategorized care',
    'ACTIVE'::"CaseManagementStatus",
    MIN(COALESCE(enc."startedAt", CURRENT_TIMESTAMP))
FROM "Encounter" enc
WHERE enc."caseManagementId" IS NULL
GROUP BY enc."patientId", enc."orgId";

UPDATE "Encounter" enc
SET "caseManagementId" = 'cm-uncat-' || enc."patientId"
WHERE enc."caseManagementId" IS NULL;

-- Non-REHAB episodes: unlink encounters, then delete episode rows
UPDATE "Encounter" enc
SET "episodeOfCareId" = NULL
FROM "EpisodeOfCare" e
WHERE enc."episodeOfCareId" = e."id"
  AND e."division" <> 'REHAB';

DELETE FROM "EpisodeOfCare" WHERE "division" <> 'REHAB';

-- NOT NULL constraints
ALTER TABLE "CaseManagement" ADD CONSTRAINT "CaseManagement_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseManagement" ADD CONSTRAINT "CaseManagement_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "CaseManagement_orgId_patientId_status_idx" ON "CaseManagement"("orgId", "patientId", "status");
CREATE INDEX "CaseManagement_orgId_primaryIcd_idx" ON "CaseManagement"("orgId", "primaryIcd");

ALTER TABLE "EpisodeOfCare" ALTER COLUMN "caseManagementId" SET NOT NULL;
ALTER TABLE "Encounter" ALTER COLUMN "caseManagementId" SET NOT NULL;

ALTER TABLE "EpisodeOfCare" ADD CONSTRAINT "EpisodeOfCare_caseManagementId_fkey" FOREIGN KEY ("caseManagementId") REFERENCES "CaseManagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_caseManagementId_fkey" FOREIGN KEY ("caseManagementId") REFERENCES "CaseManagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Encounter_caseManagementId_idx" ON "Encounter"("caseManagementId");

-- REHAB-only episodes (PostgreSQL CHECK)
ALTER TABLE "EpisodeOfCare" ADD CONSTRAINT "EpisodeOfCare_division_rehab_only" CHECK ("division" = 'REHAB');
