-- Signing-PIN MVP: Pattern D / Epic-style sign-time auth
-- Adds User.signingPinHash (bcrypt) + User.signUnlockedUntil (grace window).
-- Both nullable so existing users migrate cleanly to "no PIN, falls back to
-- per-sign TOTP" until they opt in via the in-app setup.
ALTER TABLE "User" ADD COLUMN     "signUnlockedUntil" TIMESTAMP(3),
ADD COLUMN     "signingPinHash" TEXT;
