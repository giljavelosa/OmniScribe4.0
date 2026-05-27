-- Patients-registry activity-state lookup: most recent attested note per patient.
--
-- Drives the "Active / Dormant / —" column on /patients (Active = SIGNED or
-- TRANSFERRED note within the last 90 days; Dormant = older than that; — = no
-- attested notes ever). Composite index lets Postgres satisfy
--   WHERE patientId = ? AND status IN ('SIGNED', 'TRANSFERRED')
--   ORDER BY signedAt DESC LIMIT 1
-- with an index-only scan as note volume grows per patient.
--
-- Additive only. No data backfill required.

-- CreateIndex
CREATE INDEX "Note_patientId_status_signedAt_idx" ON "Note"("patientId", "status", "signedAt");
