-- Unit 34: Audit log enrichment depth
-- Adds per-org auditRetentionDays column. NULL = retain forever
-- (default for existing orgs so behavior doesn't change retroactively).
-- Owner-only settable via /api/owner/orgs/[id]/audit-retention.
ALTER TABLE "Organization" ADD COLUMN "auditRetentionDays" INTEGER;
