-- CreateTable
CREATE TABLE "SnapshotOverride" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "episodeId" TEXT,
    "measureKey" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "unit" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enteredByOrgUserId" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "supersededByOrgUserId" TEXT,

    CONSTRAINT "SnapshotOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SnapshotOverride_patientId_measureKey_supersededAt_idx" ON "SnapshotOverride"("patientId", "measureKey", "supersededAt");

-- CreateIndex
CREATE INDEX "SnapshotOverride_episodeId_measureKey_supersededAt_idx" ON "SnapshotOverride"("episodeId", "measureKey", "supersededAt");

-- CreateIndex
CREATE INDEX "SnapshotOverride_orgId_supersededAt_idx" ON "SnapshotOverride"("orgId", "supersededAt");

-- AddForeignKey
ALTER TABLE "SnapshotOverride" ADD CONSTRAINT "SnapshotOverride_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotOverride" ADD CONSTRAINT "SnapshotOverride_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "EpisodeOfCare"("id") ON DELETE SET NULL ON UPDATE CASCADE;
