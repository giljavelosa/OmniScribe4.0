-- CreateEnum: Profession (clinician categorical profession used to drive
-- the /capture profile-completion gate + Phase-B template defaulting).
CREATE TYPE "Profession" AS ENUM (
    'MD',
    'DO',
    'NP',
    'PA',
    'OT',
    'PT',
    'SLP',
    'LCSW',
    'LMFT',
    'LPC',
    'PSYCHOLOGIST',
    'RN',
    'OTHER'
);

-- AlterTable: add nullable Profession column to OrgUser. Additive (no NOT NULL)
-- so existing rows continue to validate; clinicians with NULL hit the runtime
-- gate on next /(clinical)/* page load and complete via /onboarding/profile.
ALTER TABLE "OrgUser" ADD COLUMN "professionType" "Profession";

-- AlterTable: parity column on Invite so admins can pre-populate the
-- categorical profession at invite time (existing free-text `profession`
-- column stays as the sub-specialty detail).
ALTER TABLE "Invite" ADD COLUMN "professionType" "Profession";
