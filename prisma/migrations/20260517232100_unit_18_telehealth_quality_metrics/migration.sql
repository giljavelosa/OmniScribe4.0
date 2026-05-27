-- Unit 18 — PHI-free call quality metrics. Written by /api/admin/telehealth/
-- sessions/[id]/end when the room shell packages metrics into the request
-- body. Auditor lens + future ops dashboards.

-- AlterTable
ALTER TABLE "TelehealthSession" ADD COLUMN "qualityMetrics" JSONB;
