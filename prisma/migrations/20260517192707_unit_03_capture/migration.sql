-- CreateEnum
CREATE TYPE "CaptureMode" AS ENUM ('LIVE', 'UPLOADED', 'PASTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NoteStatus" ADD VALUE 'RECORDING';
ALTER TYPE "NoteStatus" ADD VALUE 'PAUSED';
ALTER TYPE "NoteStatus" ADD VALUE 'TRANSCRIBING';

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "audioFileKey" TEXT,
ADD COLUMN     "captureMode" "CaptureMode" NOT NULL DEFAULT 'LIVE',
ADD COLUMN     "transcriptClean" JSONB,
ADD COLUMN     "transcriptRaw" JSONB;

-- CreateTable
CREATE TABLE "AudioSegment" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "segmentIndex" INTEGER NOT NULL DEFAULT 0,
    "s3Key" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "sampleRate" INTEGER NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AudioSegment_noteId_segmentIndex_idx" ON "AudioSegment"("noteId", "segmentIndex");

-- AddForeignKey
ALTER TABLE "AudioSegment" ADD CONSTRAINT "AudioSegment_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
