-- Drop `SUPER_ADMIN` from `OrgRole`.
--
-- Rationale: `OrgRole.SUPER_ADMIN` was conflated with the platform-owner
-- concept. The role model is now strictly separated:
--   - Platform owner (OmniScribe's owner) = `User.platformRole = PLATFORM_OWNER`
--   - Org admin (customer's org owner)    = `OrgUser.role = ORG_ADMIN`
-- They do not mix. Cross-org access happens via impersonation only.
--
-- ORG_ADMIN absorbs all powers `SUPER_ADMIN` previously held (clinical
-- features + cross-clinician note-read bypass within their own org).
--
-- PostgreSQL cannot drop an enum value in-place; we rebuild the type.

-- Step 1: backfill data — any existing rows on the deprecated value land
-- on ORG_ADMIN so the column type-cast in Step 2 succeeds.
UPDATE "OrgUser" SET "role" = 'ORG_ADMIN' WHERE "role" = 'SUPER_ADMIN';
UPDATE "Invite"  SET "role" = 'ORG_ADMIN' WHERE "role" = 'SUPER_ADMIN';

-- Step 2: rebuild the enum type without SUPER_ADMIN.
ALTER TYPE "OrgRole" RENAME TO "OrgRole_old";
CREATE TYPE "OrgRole" AS ENUM ('ORG_ADMIN', 'SITE_ADMIN', 'CLINICIAN', 'VIEWER');
ALTER TABLE "OrgUser" ALTER COLUMN "role" TYPE "OrgRole" USING "role"::text::"OrgRole";
ALTER TABLE "Invite"  ALTER COLUMN "role" TYPE "OrgRole" USING "role"::text::"OrgRole";
DROP TYPE "OrgRole_old";
