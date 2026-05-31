-- Unit 52 — Document upload + OCR extraction + clinician vetting.
-- Append-only migration (rules 1/2): status values are appended; existing
-- ExternalContext rows remain valid. Existing audio rows are backfilled to
-- mediaKind='AUDIO' so the new discriminator reflects historical data.

-- AppendEnum
ALTER TYPE "ExternalContextStatus" ADD VALUE IF NOT EXISTS 'PENDING_EXTRACTION';
ALTER TYPE "ExternalContextStatus" ADD VALUE IF NOT EXISTS 'EXTRACTED';
ALTER TYPE "ExternalContextStatus" ADD VALUE IF NOT EXISTS 'EXTRACTION_FAILED';

-- CreateEnum
CREATE TYPE "ExternalContextMediaKind" AS ENUM (
  'PASTE',
  'AUDIO',
  'DOCUMENT'
);

-- AlterTable
ALTER TABLE "ExternalContext"
  ADD COLUMN "mediaKind" "ExternalContextMediaKind" NOT NULL DEFAULT 'PASTE',
  ADD COLUMN "documentFileKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "documentMimeTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "pageCount" INTEGER,
  ADD COLUMN "ocrText" TEXT,
  ADD COLUMN "extractionJson" JSONB,
  ADD COLUMN "extractionModel" TEXT,
  ADD COLUMN "extractedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedByOrgUserId" TEXT,
  ADD COLUMN "vettedExtractionJson" JSONB,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedByOrgUserId" TEXT;

-- BackfillData
UPDATE "ExternalContext"
SET "mediaKind" = 'AUDIO'
WHERE "audioFileKey" IS NOT NULL;

-- CreateIndex
CREATE INDEX "ExternalContext_patientId_verifiedAt_idx"
  ON "ExternalContext"("patientId", "verifiedAt");

-- AddForeignKey
ALTER TABLE "ExternalContext"
  ADD CONSTRAINT "ExternalContext_verifiedByOrgUserId_fkey"
  FOREIGN KEY ("verifiedByOrgUserId") REFERENCES "OrgUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

