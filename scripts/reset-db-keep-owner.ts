/**
 * Dev utility — wipe ALL application data but keep platform-owner logins.
 *
 * Truncates every table except `_prisma_migrations` and `User`, then deletes
 * every non-PLATFORM_OWNER user. The surviving owner row (email + passwordHash
 * + platformRole) is all that's required to log in and reach /owner — no org,
 * OrgUser, or seat is needed (see src/lib/auth.config.ts authorize()).
 *
 * Run: node --env-file=.env --import=tsx scripts/reset-db-keep-owner.ts
 *
 * NOT for production (DATABASE_URL points at your local dev Postgres). After
 * running, sign out and back in — the old JWT references an orgUserId that no
 * longer exists.
 */
import { PrismaClient, PlatformRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const owners = await prisma.user.findMany({
    where: { platformRole: PlatformRole.PLATFORM_OWNER },
    select: { email: true },
  });

  if (owners.length === 0) {
    throw new Error(
      'Refusing to wipe: no PLATFORM_OWNER user found — you would be locked out.',
    );
  }

  console.log(
    `Keeping ${owners.length} platform owner(s): ${owners.map((o) => o.email).join(', ')}`,
  );

  // Every public table except the migration ledger and User. User has no
  // outgoing FKs, so truncating the rest CASCADE never cascades into it.
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const targets = rows
    .map((r) => r.tablename)
    .filter((name) => name !== '_prisma_migrations' && name !== 'User')
    .map((name) => `"public"."${name}"`);

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${targets.join(', ')} RESTART IDENTITY CASCADE;`,
  );

  const { count } = await prisma.user.deleteMany({
    where: { platformRole: { not: PlatformRole.PLATFORM_OWNER } },
  });

  console.log(
    `Truncated ${targets.length} tables; removed ${count} non-owner user(s).`,
  );
  console.log('Done. Sign out and back in to refresh your session.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
