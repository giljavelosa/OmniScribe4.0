-- Sprint 0.19 — Tier 12 (Care Pathway library), Tier 13 (Multimedia
-- intake), Tier 14 (Internal team coordination).
--
-- Additive only. No existing table or enum is mutated. Three new enums
-- (PatientUploadKind, PatientUploadStatus, InternalMessageUrgency,
-- InternalMessageStatus — first introduction, append-only after).
-- Five new tables (CarePathway, CarePathwayStep, PatientUpload,
-- InternalPatientMessage). All org-scoped via Organization FK; rule 7
-- soft-deletes on user-uploaded content (PatientUpload.isDeleted) so
-- file lineage stays intact in S3. Per rule 4, `npx prisma db seed`
-- runs after this migration applies (seed populates a small starter
-- pathway library per org; uploads + messages tables start empty).

-- ===================================================================
-- Tier 12 — Care Pathway library
-- ===================================================================

-- CreateTable
CREATE TABLE "CarePathway" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primaryIcd" TEXT NOT NULL,
    "primaryIcdLabel" TEXT NOT NULL,
    "division" "Division" NOT NULL,
    "evidenceSource" TEXT,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarePathway_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CarePathway_orgId_primaryIcd_idx" ON "CarePathway"("orgId", "primaryIcd");

-- CreateIndex
CREATE INDEX "CarePathway_orgId_division_isDeleted_idx" ON "CarePathway"("orgId", "division", "isDeleted");

-- AddForeignKey
ALTER TABLE "CarePathway" ADD CONSTRAINT "CarePathway_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CarePathwayStep" (
    "id" TEXT NOT NULL,
    "pathwayId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requiredElementsJson" JSONB,

    CONSTRAINT "CarePathwayStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CarePathwayStep_pathwayId_ordinal_key" ON "CarePathwayStep"("pathwayId", "ordinal");

-- CreateIndex
CREATE INDEX "CarePathwayStep_pathwayId_idx" ON "CarePathwayStep"("pathwayId");

-- AddForeignKey
ALTER TABLE "CarePathwayStep" ADD CONSTRAINT "CarePathwayStep_pathwayId_fkey" FOREIGN KEY ("pathwayId") REFERENCES "CarePathway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===================================================================
-- Tier 13 — Multimedia intake
-- ===================================================================

-- CreateEnum
CREATE TYPE "PatientUploadKind" AS ENUM ('MED_LIST', 'LAB_REPORT', 'IMAGING_REPORT', 'INSURANCE_CARD', 'ID_CARD', 'OUTSIDE_RECORDS', 'OTHER');

-- CreateEnum
CREATE TYPE "PatientUploadStatus" AS ENUM ('PENDING_EXTRACTION', 'EXTRACTING', 'EXTRACTED', 'EXTRACTION_FAILED', 'MANUAL_ONLY');

-- CreateTable
CREATE TABLE "PatientUpload" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "uploadedByOrgUserId" TEXT NOT NULL,
    "kind" "PatientUploadKind" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "filename" TEXT,
    "s3Bucket" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "status" "PatientUploadStatus" NOT NULL DEFAULT 'PENDING_EXTRACTION',
    "ocrText" TEXT,
    "extractedJson" JSONB,
    "extractionErrorMessage" TEXT,
    "isPhiSensitive" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientUpload_orgId_patientId_isDeleted_idx" ON "PatientUpload"("orgId", "patientId", "isDeleted");

-- CreateIndex
CREATE INDEX "PatientUpload_orgId_status_idx" ON "PatientUpload"("orgId", "status");

-- CreateIndex
CREATE INDEX "PatientUpload_patientId_kind_idx" ON "PatientUpload"("patientId", "kind");

-- AddForeignKey
ALTER TABLE "PatientUpload" ADD CONSTRAINT "PatientUpload_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientUpload" ADD CONSTRAINT "PatientUpload_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientUpload" ADD CONSTRAINT "PatientUpload_uploadedByOrgUserId_fkey" FOREIGN KEY ("uploadedByOrgUserId") REFERENCES "OrgUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================================================================
-- Tier 14 — Internal team coordination
-- ===================================================================

-- CreateEnum
CREATE TYPE "InternalMessageUrgency" AS ENUM ('LOW', 'NORMAL', 'URGENT');

-- CreateEnum
CREATE TYPE "InternalMessageStatus" AS ENUM ('SENT', 'READ', 'ARCHIVED');

-- CreateTable
CREATE TABLE "InternalPatientMessage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "senderOrgUserId" TEXT NOT NULL,
    "recipientOrgUserId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "urgency" "InternalMessageUrgency" NOT NULL DEFAULT 'NORMAL',
    "status" "InternalMessageStatus" NOT NULL DEFAULT 'SENT',
    "contextHref" TEXT,
    "inReplyToId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "InternalPatientMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InternalPatientMessage_orgId_recipientOrgUserId_status_sent_idx" ON "InternalPatientMessage"("orgId", "recipientOrgUserId", "status", "sentAt");

-- CreateIndex
CREATE INDEX "InternalPatientMessage_orgId_patientId_sentAt_idx" ON "InternalPatientMessage"("orgId", "patientId", "sentAt");

-- CreateIndex
CREATE INDEX "InternalPatientMessage_senderOrgUserId_sentAt_idx" ON "InternalPatientMessage"("senderOrgUserId", "sentAt");

-- AddForeignKey
ALTER TABLE "InternalPatientMessage" ADD CONSTRAINT "InternalPatientMessage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalPatientMessage" ADD CONSTRAINT "InternalPatientMessage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalPatientMessage" ADD CONSTRAINT "InternalPatientMessage_senderOrgUserId_fkey" FOREIGN KEY ("senderOrgUserId") REFERENCES "OrgUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalPatientMessage" ADD CONSTRAINT "InternalPatientMessage_recipientOrgUserId_fkey" FOREIGN KEY ("recipientOrgUserId") REFERENCES "OrgUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalPatientMessage" ADD CONSTRAINT "InternalPatientMessage_inReplyToId_fkey" FOREIGN KEY ("inReplyToId") REFERENCES "InternalPatientMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
