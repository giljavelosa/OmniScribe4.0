-- AlterTable
ALTER TABLE "GoalProgressEntry" ADD COLUMN     "deltaNote" TEXT,
ADD COLUMN     "recordedByOrgUserId" TEXT,
ADD COLUMN     "statusAtEntry" "GoalStatus",
ALTER COLUMN "noteId" DROP NOT NULL,
ALTER COLUMN "measureValue" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "GoalProgressEntry_goalId_recordedAt_idx" ON "GoalProgressEntry"("goalId", "recordedAt");
