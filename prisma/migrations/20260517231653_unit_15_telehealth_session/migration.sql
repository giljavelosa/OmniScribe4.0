-- CreateEnum
CREATE TYPE "TelehealthSessionStatus" AS ENUM ('SCHEDULED', 'VERIFIED', 'CONSENT_CAPTURED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "TelehealthSession" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "magicToken" TEXT NOT NULL,
    "magicExpiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "consentAt" TIMESTAMP(3),
    "consentVersion" TEXT,
    "roomUrl" TEXT,
    "roomName" TEXT,
    "roomExpiresAt" TIMESTAMP(3),
    "status" "TelehealthSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,
    "createdByOrgUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelehealthSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelehealthSession_scheduleId_key" ON "TelehealthSession"("scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "TelehealthSession_magicToken_key" ON "TelehealthSession"("magicToken");

-- CreateIndex
CREATE INDEX "TelehealthSession_orgId_status_idx" ON "TelehealthSession"("orgId", "status");

-- CreateIndex
CREATE INDEX "TelehealthSession_magicExpiresAt_idx" ON "TelehealthSession"("magicExpiresAt");

-- AddForeignKey
ALTER TABLE "TelehealthSession" ADD CONSTRAINT "TelehealthSession_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelehealthSession" ADD CONSTRAINT "TelehealthSession_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelehealthSession" ADD CONSTRAINT "TelehealthSession_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
