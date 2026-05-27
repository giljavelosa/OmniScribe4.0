-- ActiveRecordingLock — single-concurrent-recording enforcement.
-- One row per User (unique on userId) so a single account can hold AT MOST one
-- active recording across all their devices. Anti-credential-sharing defense
-- shipped 2026-05-25; the threat is two clinicians splitting one $179 Solo
-- subscription and recording on different devices simultaneously.
--
-- Lock lifecycle:
--   - claim   on POST /api/notes/[id]/realtime-key (first mint)
--   - refresh on every realtime-key re-mint (~50s heartbeat)
--   - takeover when a different device claims and prior heartbeat is stale
--     (older than the staleness window) OR the new device passes takeover=true
--   - release on POST /api/notes/[id]/complete-stream success
--
-- The unique constraint on userId is the primary enforcement; application
-- logic in src/lib/recording-lock/claim.ts is defense in depth.

CREATE TABLE "ActiveRecordingLock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "clientNonce" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActiveRecordingLock_pkey" PRIMARY KEY ("id")
);

-- One lock per user — the structural guarantee that a single account can't
-- record on two devices at once.
CREATE UNIQUE INDEX "ActiveRecordingLock_userId_key" ON "ActiveRecordingLock"("userId");

-- noteId index: lets the takeover audit query find the displaced lock fast.
CREATE INDEX "ActiveRecordingLock_noteId_idx" ON "ActiveRecordingLock"("noteId");

-- orgId index: ops/auditor reads "all active recordings in this org" without a
-- table scan.
CREATE INDEX "ActiveRecordingLock_orgId_idx" ON "ActiveRecordingLock"("orgId");

-- Cascade on User deletion — the lock can't outlive the account that owns it.
ALTER TABLE "ActiveRecordingLock"
    ADD CONSTRAINT "ActiveRecordingLock_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
