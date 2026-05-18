-- AlterTable
ALTER TABLE "NoteTemplate" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedByOrgUserId" TEXT,
ADD COLUMN     "clonedFromId" TEXT,
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "NoteTemplate_orgId_isArchived_idx" ON "NoteTemplate"("orgId", "isArchived");

-- CreateIndex
CREATE INDEX "NoteTemplate_clonedFromId_idx" ON "NoteTemplate"("clonedFromId");

-- AddForeignKey
ALTER TABLE "NoteTemplate" ADD CONSTRAINT "NoteTemplate_clonedFromId_fkey" FOREIGN KEY ("clonedFromId") REFERENCES "NoteTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
