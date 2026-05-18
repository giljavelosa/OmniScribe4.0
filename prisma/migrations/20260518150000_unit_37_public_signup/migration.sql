-- Unit 37: Public signup + self-serve org creation
-- Adds User.failedLoginCount (auto-lockout counter) + User.lockedUntil
-- (lock expiry timestamp). Both nullable / default 0 so existing rows
-- migrate cleanly to "no lock active."
ALTER TABLE "User" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);
