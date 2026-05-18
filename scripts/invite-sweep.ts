/**
 * scripts/invite-sweep.ts — Unit 37 (TS sibling for invite-sweep.mjs).
 *
 * Finds expired-unconsumed invites; groups them by org; marks them
 * consumed (with the current timestamp); writes one
 * INVITE_EXPIRED_SWEPT audit row per affected org capturing the count.
 *
 * Fail-loud: per-org audit-write failures throw. The cron sees a
 * non-zero exit + alerts; a partial sweep leaves the rest for the
 * next run.
 */

import { PrismaClient } from '@prisma/client';

import { writeAuditLog } from '@/lib/audit/log';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const now = new Date();

  // Group expired-unconsumed invites by org.
  const expired = await prisma.invite.findMany({
    where: { expiresAt: { lt: now }, consumedAt: null },
    select: { id: true, orgId: true },
  });

  if (expired.length === 0) {
    console.log(
      JSON.stringify({
        event: 'invite_sweep_summary',
        orgsAffected: 0,
        totalSwept: 0,
      }),
    );
    await prisma.$disconnect();
    return;
  }

  // Mark all as consumed in one updateMany.
  const result = await prisma.invite.updateMany({
    where: { id: { in: expired.map((r) => r.id) } },
    data: { consumedAt: now },
  });

  // Per-org grouping for audit.
  const perOrg = new Map<string, number>();
  for (const row of expired) {
    perOrg.set(row.orgId, (perOrg.get(row.orgId) ?? 0) + 1);
  }

  for (const [orgId, count] of perOrg) {
    await writeAuditLog({
      orgId,
      action: 'INVITE_EXPIRED_SWEPT',
      resourceType: 'Invite',
      resourceId: 'sweep',
      metadata: { count, sweptAt: now.toISOString() },
    });
    console.log(
      JSON.stringify({
        event: 'invite_sweep_per_org',
        orgId,
        count,
      }),
    );
  }

  console.log(
    JSON.stringify({
      event: 'invite_sweep_summary',
      orgsAffected: perOrg.size,
      totalSwept: result.count,
    }),
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      event: 'invite_sweep_fatal',
      message: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
    }),
  );
  process.exit(1);
});
