-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NoteStatus" ADD VALUE 'DRAFTING';
ALTER TYPE "NoteStatus" ADD VALUE 'INTERRUPTED';

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "inferenceLog" JSONB,
ADD COLUMN     "interruptedAt" TIMESTAMP(3),
ADD COLUMN     "lastWorkerError" TEXT;
