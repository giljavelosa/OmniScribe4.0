-- Unit 16 — link TelehealthSession 1:1 to the Note its live transcript writes
-- into. NULL until the clinician starts the call (see /api/admin/telehealth/
-- sessions/[id]/start). Unique to enforce the 1:1.

-- AlterTable
ALTER TABLE "TelehealthSession" ADD COLUMN "noteId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TelehealthSession_noteId_key" ON "TelehealthSession"("noteId");

-- AddForeignKey
ALTER TABLE "TelehealthSession" ADD CONSTRAINT "TelehealthSession_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;
