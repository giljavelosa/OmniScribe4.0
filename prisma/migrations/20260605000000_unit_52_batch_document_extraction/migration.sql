-- Unit 52 follow-up — batch-based document extraction with clinician batch review.
-- Append-only migration: existing ExternalContext rows stay valid; final document
-- verification remains gated by ExternalContext.verifiedAt IS NOT NULL.

-- AppendEnum
ALTER TYPE "ExternalContextStatus" ADD VALUE IF NOT EXISTS 'PARTIAL_EXTRACTION_REVIEW';

-- CreateEnum
CREATE TYPE "ExternalContextExtractionBatchStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'NEEDS_REVIEW',
  'REVIEWED',
  'FAILED'
);

-- CreateTable
CREATE TABLE "ExternalContextExtractionBatch" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "externalContextId" TEXT NOT NULL,
  "batchIndex" INTEGER NOT NULL,
  "pageStart" INTEGER NOT NULL,
  "pageEnd" INTEGER NOT NULL,
  "status" "ExternalContextExtractionBatchStatus" NOT NULL DEFAULT 'PENDING',
  "ocrText" TEXT,
  "extractionJson" JSONB,
  "vettedExtractionJson" JSONB,
  "extractionModel" TEXT,
  "extractedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewedByOrgUserId" TEXT,
  "errorClass" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExternalContextExtractionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalContextExtractionBatch_externalContextId_batchIndex_key"
  ON "ExternalContextExtractionBatch"("externalContextId", "batchIndex");
CREATE INDEX "ExternalContextExtractionBatch_externalContextId_status_idx"
  ON "ExternalContextExtractionBatch"("externalContextId", "status");
CREATE INDEX "ExternalContextExtractionBatch_orgId_idx"
  ON "ExternalContextExtractionBatch"("orgId");

-- AddForeignKey
ALTER TABLE "ExternalContextExtractionBatch"
  ADD CONSTRAINT "ExternalContextExtractionBatch_externalContextId_fkey"
  FOREIGN KEY ("externalContextId") REFERENCES "ExternalContext"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalContextExtractionBatch"
  ADD CONSTRAINT "ExternalContextExtractionBatch_reviewedByOrgUserId_fkey"
  FOREIGN KEY ("reviewedByOrgUserId") REFERENCES "OrgUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
