-- Sprint 0.20 — Remove MFA.
--
-- Authentication is now password-only. Admin invite + password-reset
-- flows remain the supported account-recovery surfaces (User.passwordHash,
-- User.failedLoginCount, User.lockedUntil intact). Note-signing PIN
-- (User.signingPinHash, User.signUnlockedUntil) is a separate feature
-- and is NOT touched by this migration.
--
-- Columns dropped:
--   - User.mfaSecret
--   - User.mfaEnabled
--   - User.mfaRecoveryCodes
--   - Organization.forceMfa
--
-- The `MFA_VERIFIED` and `MFA_VERIFY_FAILED` AuditAction values are
-- retained in the application's TypeScript union so historical audit
-- rows still resolve cleanly. They are no longer emitted.

ALTER TABLE "User" DROP COLUMN IF EXISTS "mfaSecret";
ALTER TABLE "User" DROP COLUMN IF EXISTS "mfaEnabled";
ALTER TABLE "User" DROP COLUMN IF EXISTS "mfaRecoveryCodes";

ALTER TABLE "Organization" DROP COLUMN IF EXISTS "forceMfa";

-- The Sprint 0.21 login-verification-codes feature was removed alongside
-- MFA in Sprint 0.20. Drop its table + columns + enum if they exist (the
-- migration was a sibling commit on this branch and reached the dev DB
-- before being abandoned).
DROP TABLE IF EXISTS "LoginVerificationCode" CASCADE;
ALTER TABLE "User" DROP COLUMN IF EXISTS "loginVerifyChannel";
ALTER TABLE "User" DROP COLUMN IF EXISTS "phone";
DROP TYPE IF EXISTS "LoginVerifyChannel";
