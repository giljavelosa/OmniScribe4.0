-- Sprint 0 — Scanned documents: clinician attestation (accept / deny).
-- Additive enum values + columns on PatientUpload. Rule 2: append-only.

ALTER TYPE "PatientUploadStatus" ADD VALUE IF NOT EXISTS 'ATTESTED';
ALTER TYPE "PatientUploadStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE "PatientUpload" ADD COLUMN IF NOT EXISTS "captureContext" TEXT;
ALTER TABLE "PatientUpload" ADD COLUMN IF NOT EXISTS "attestedJson" JSONB;
ALTER TABLE "PatientUpload" ADD COLUMN IF NOT EXISTS "attestedAt" TIMESTAMP(3);
ALTER TABLE "PatientUpload" ADD COLUMN IF NOT EXISTS "attestedByOrgUserId" TEXT;
ALTER TABLE "PatientUpload" ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3);
ALTER TABLE "PatientUpload" ADD COLUMN IF NOT EXISTS "rejectedByOrgUserId" TEXT;
ALTER TABLE "PatientUpload" ADD COLUMN IF NOT EXISTS "supersedesUploadId" TEXT;

DO $$ BEGIN
  ALTER TABLE "PatientUpload"
    ADD CONSTRAINT "PatientUpload_attestedByOrgUserId_fkey"
    FOREIGN KEY ("attestedByOrgUserId") REFERENCES "OrgUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PatientUpload"
    ADD CONSTRAINT "PatientUpload_supersedesUploadId_fkey"
    FOREIGN KEY ("supersedesUploadId") REFERENCES "PatientUpload"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "PatientUpload_orgId_patientId_status_idx"
  ON "PatientUpload"("orgId", "patientId", "status");
