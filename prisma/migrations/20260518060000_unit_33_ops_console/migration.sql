-- Unit 33: Ops Console
-- Adds the PLATFORM_OPS enum value to PlatformRole. Postgres requires
-- ALTER TYPE ... ADD VALUE statements to run outside an explicit
-- transaction; Prisma's migrate runner handles this automatically.
ALTER TYPE "PlatformRole" ADD VALUE IF NOT EXISTS 'PLATFORM_OPS';
