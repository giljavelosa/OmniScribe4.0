-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'MET', 'CARRIED', 'DROPPED', 'CLOSED_BY_DISCHARGE');

-- CreateTable
CREATE TABLE "NoteBrief" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "episodeId" TEXT,
    "sourceNoteIds" TEXT[],
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatorVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "content" JSONB NOT NULL,

    CONSTRAINT "NoteBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "episodeId" TEXT,
    "originNoteId" TEXT NOT NULL,
    "closingNoteId" TEXT,
    "text" TEXT NOT NULL,
    "patientFacingText" TEXT,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "closingNoteText" TEXT,
    "dropReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedByOrgUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NoteBrief_noteId_key" ON "NoteBrief"("noteId");

-- CreateIndex
CREATE INDEX "NoteBrief_patientId_generatedAt_idx" ON "NoteBrief"("patientId", "generatedAt");

-- CreateIndex
CREATE INDEX "NoteBrief_orgId_generatedAt_idx" ON "NoteBrief"("orgId", "generatedAt");

-- CreateIndex
CREATE INDEX "FollowUp_patientId_status_idx" ON "FollowUp"("patientId", "status");

-- CreateIndex
CREATE INDEX "FollowUp_orgId_status_idx" ON "FollowUp"("orgId", "status");

-- CreateIndex
CREATE INDEX "FollowUp_episodeId_idx" ON "FollowUp"("episodeId");

-- AddForeignKey
ALTER TABLE "NoteBrief" ADD CONSTRAINT "NoteBrief_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteBrief" ADD CONSTRAINT "NoteBrief_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteBrief" ADD CONSTRAINT "NoteBrief_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "EpisodeOfCare"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_originNoteId_fkey" FOREIGN KEY ("originNoteId") REFERENCES "Note"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_closingNoteId_fkey" FOREIGN KEY ("closingNoteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;
