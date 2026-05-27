/**
 * One-off helper to populate the Care Pathway library into the dev DB
 * without running the full `prisma db seed` flow (which the user has
 * been cautious about given cross-branch data drift).
 *
 * Idempotent. Safe to re-run.
 *
 *   npx tsx scripts/seed-care-pathways-dev.ts
 */
import { PrismaClient } from '@prisma/client';
import { seedCarePathwaysForOrg } from '../prisma/seed-care-pathways';

const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  for (const o of orgs) {
    await seedCarePathwaysForOrg(prisma, o.id);
    console.log(`seeded pathways for ${o.name}`);
  }
  const total = await prisma.carePathway.count();
  console.log(`total pathways in dev DB: ${total}`);
}

main().finally(() => prisma.$disconnect());
