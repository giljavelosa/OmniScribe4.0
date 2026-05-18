-- CreateEnum
CREATE TYPE "ReviewFlagSeverity" AS ENUM ('RED', 'BLUE', 'YELLOW', 'GREEN');

-- CreateEnum
CREATE TYPE "ReviewFlagStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "ReviewFlag" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "severity" "ReviewFlagSeverity" NOT NULL,
    "status" "ReviewFlagStatus" NOT NULL DEFAULT 'OPEN',
    "claim" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence" TEXT,
    "suggestion" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByOrgUserId" TEXT,
    "resolutionAction" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewFlag_noteId_status_idx" ON "ReviewFlag"("noteId", "status");

-- CreateIndex
CREATE INDEX "ReviewFlag_noteId_sectionId_idx" ON "ReviewFlag"("noteId", "sectionId");

-- CreateIndex
CREATE INDEX "ReviewFlag_orgId_createdAt_idx" ON "ReviewFlag"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReviewFlag" ADD CONSTRAINT "ReviewFlag_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
