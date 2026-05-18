-- External Context — per-patient prior-visit reference material.
-- Spec: context/specs/external-context-upload.md
--
-- Append-only migration (rule 1): no existing tables touched. Two enums +
-- one table + two indexes + four FKs.

-- CreateEnum
CREATE TYPE "ExternalContextSource" AS ENUM (
  'PATIENT_SUPPLIED',
  'OUTSIDE_PROVIDER',
  'EARLIER_UNDOCUMENTED',
  'CLINICIAN_NOTES',
  'OTHER'
);

-- CreateEnum
CREATE TYPE "ExternalContextStatus" AS ENUM (
  'PENDING_TRANSCRIPTION',
  'READY',
  'FAILED'
);

-- CreateTable
CREATE TABLE "ExternalContext" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "episodeOfCareId" TEXT,
    "dateOfRecord" TIMESTAMP(3) NOT NULL,
    "source" "ExternalContextSource" NOT NULL,
    "sourceLabel" TEXT,
    "transcriptClean" TEXT NOT NULL,
    "transcriptRaw" JSONB,
    "audioFileKey" TEXT,
    "status" "ExternalContextStatus" NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedByOrgUserId" TEXT NOT NULL,

    CONSTRAINT "ExternalContext_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalContext_patientId_dateOfRecord_idx"
  ON "ExternalContext"("patientId", "dateOfRecord");

-- CreateIndex
CREATE INDEX "ExternalContext_orgId_idx"
  ON "ExternalContext"("orgId");

-- AddForeignKey
ALTER TABLE "ExternalContext"
  ADD CONSTRAINT "ExternalContext_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalContext"
  ADD CONSTRAINT "ExternalContext_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalContext"
  ADD CONSTRAINT "ExternalContext_episodeOfCareId_fkey"
  FOREIGN KEY ("episodeOfCareId") REFERENCES "EpisodeOfCare"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalContext"
  ADD CONSTRAINT "ExternalContext_addedByOrgUserId_fkey"
  FOREIGN KEY ("addedByOrgUserId") REFERENCES "OrgUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
