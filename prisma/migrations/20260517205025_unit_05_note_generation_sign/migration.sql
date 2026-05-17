-- CreateEnum
CREATE TYPE "NoteArtifactKind" AS ENUM ('PATIENT_INSTRUCTIONS', 'REFERRAL_LETTER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NoteStatus" ADD VALUE 'DRAFT';
ALTER TYPE "NoteStatus" ADD VALUE 'REVIEWING';
ALTER TYPE "NoteStatus" ADD VALUE 'SIGNED';
ALTER TYPE "NoteStatus" ADD VALUE 'TRANSFERRED';
ALTER TYPE "NoteStatus" ADD VALUE 'PENDING_REVIEW';

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "backfillReason" TEXT,
ADD COLUMN     "backfilledAt" TIMESTAMP(3),
ADD COLUMN     "draftJson" JSONB,
ADD COLUMN     "finalJson" JSONB,
ADD COLUMN     "noteStyle" "NoteStyle" NOT NULL DEFAULT 'HYBRID',
ADD COLUMN     "sensitivityLevel" "NoteSensitivityLevel" NOT NULL DEFAULT 'STANDARD_CLINICAL',
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "signedByUserId" TEXT,
ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "templateVersion" INTEGER;

-- CreateTable
CREATE TABLE "NoteTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "division" "Division" NOT NULL,
    "specialty" TEXT,
    "visibility" TEXT NOT NULL,
    "isPreset" BOOLEAN NOT NULL DEFAULT false,
    "sectionSchema" JSONB NOT NULL,
    "promptHints" JSONB,
    "sensitivityDefault" "NoteSensitivityLevel" NOT NULL DEFAULT 'STANDARD_CLINICAL',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByOrgUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteArtifact" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "kind" "NoteArtifactKind" NOT NULL,
    "content" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoteTemplate_orgId_division_isPreset_idx" ON "NoteTemplate"("orgId", "division", "isPreset");

-- CreateIndex
CREATE INDEX "NoteArtifact_noteId_kind_idx" ON "NoteArtifact"("noteId", "kind");

-- CreateIndex
CREATE INDEX "Note_patientId_status_idx" ON "Note"("patientId", "status");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NoteTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteTemplate" ADD CONSTRAINT "NoteTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteArtifact" ADD CONSTRAINT "NoteArtifact_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
