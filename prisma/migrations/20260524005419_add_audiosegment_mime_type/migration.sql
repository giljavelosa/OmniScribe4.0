-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- DropForeignKey
ALTER TABLE "CopilotConversation" DROP CONSTRAINT "CopilotConversation_patientId_fkey";

-- AlterTable
ALTER TABLE "AudioSegment" ADD COLUMN     "mimeType" TEXT;

-- CreateTable
CREATE TABLE "VoiceProfile" (
    "id" TEXT NOT NULL,
    "orgUserId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "embedding" vector(192),
    "enrollmentS3Key" TEXT,
    "consentVersion" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "displayName" TEXT,
    "defaultRole" TEXT NOT NULL DEFAULT 'CLINICIAN',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "hardDeleteAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoiceProfile_orgId_isDeleted_idx" ON "VoiceProfile"("orgId", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceProfile_orgUserId_key" ON "VoiceProfile"("orgUserId");

-- AddForeignKey
ALTER TABLE "VoiceProfile" ADD CONSTRAINT "VoiceProfile_orgUserId_fkey" FOREIGN KEY ("orgUserId") REFERENCES "OrgUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotConversation" ADD CONSTRAINT "CopilotConversation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
