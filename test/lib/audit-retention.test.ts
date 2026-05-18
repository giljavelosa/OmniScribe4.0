import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Division, PrismaClient } from '@prisma/client';

import { purgeAuditAllOrgs, purgeAuditForOrg } from '@/lib/audit/retention';

/**
 * purgeAuditForOrg / purgeAuditAllOrgs integration tests — Unit 34.
 *
 * Hits the live Postgres. Fixture: one org with auditRetentionDays=30
 * + AuditLog rows spread across "fresh" (1 day old), "old" (60 days
 * old), and "AUDIT_PURGE_RUN" (60 days old — should be exempt).
 *
 * Verifies:
 *   - Old rows are deleted; fresh rows + AUDIT_PURGE_RUN rows preserved
 *   - A purge run writes exactly one AUDIT_PURGE_RUN audit row
 *   - Org with auditRetentionDays=null returns skipped:'no_retention'
 *   - All-orgs runner aggregates row counts correctly
 */

// Skipped in CI (no Postgres). Run locally via `npm test` with DATABASE_URL set.
const hasDb = !!process.env.DATABASE_URL;
const describeMaybe = hasDb ? describe : describe.skip;
const prisma = hasDb ? new PrismaClient() : (null as unknown as PrismaClient);

const ORG_RETAIN_ID = 'test-org-unit-34-retain';
const ORG_FOREVER_ID = 'test-org-unit-34-forever';

beforeAll(async () => {
  if (!hasDb) return;
  await prisma.organization.upsert({
    where: { id: ORG_RETAIN_ID },
    update: { auditRetentionDays: 30 },
    create: {
      id: ORG_RETAIN_ID,
      name: 'Unit 34 Retain Test Org',
      division: Division.MEDICAL,
      billingEmail: 'unit34retain@test.local',
      auditRetentionDays: 30,
    },
  });
  await prisma.organization.upsert({
    where: { id: ORG_FOREVER_ID },
    update: { auditRetentionDays: null },
    create: {
      id: ORG_FOREVER_ID,
      name: 'Unit 34 Forever Test Org',
      division: Division.MEDICAL,
      billingEmail: 'unit34forever@test.local',
      auditRetentionDays: null,
    },
  });
});

beforeEach(async () => {
  // Wipe ALL audit rows for the test orgs so each test starts cold.
  await prisma.auditLog.deleteMany({
    where: { orgId: { in: [ORG_RETAIN_ID, ORG_FOREVER_ID] } },
  });
});

afterAll(async () => {
  if (!hasDb) return;
  await prisma.auditLog.deleteMany({
    where: { orgId: { in: [ORG_RETAIN_ID, ORG_FOREVER_ID] } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: [ORG_RETAIN_ID, ORG_FOREVER_ID] } },
  });
  await prisma.$disconnect();
});

describeMaybe('purgeAuditForOrg', () => {
  it('skips when org has no retention configured', async () => {
    const result = await purgeAuditForOrg(ORG_FOREVER_ID);
    expect(result.skipped).toBe('no_retention');
    expect(result.rowsDeleted).toBe(0);
    expect(result.cutoffDate).toBeNull();
    // No AUDIT_PURGE_RUN row written on skip.
    const purgeRows = await prisma.auditLog.findMany({
      where: { orgId: ORG_FOREVER_ID, action: 'AUDIT_PURGE_RUN' },
    });
    expect(purgeRows).toHaveLength(0);
  });

  it('deletes old rows + preserves fresh rows + writes one purge receipt', async () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 1 * 86_400_000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 86_400_000);

    // 3 old + 2 fresh rows.
    await prisma.auditLog.createMany({
      data: [
        { orgId: ORG_RETAIN_ID, action: 'USER_SIGNED_IN', createdAt: sixtyDaysAgo },
        { orgId: ORG_RETAIN_ID, action: 'NOTE_SIGNED', createdAt: sixtyDaysAgo },
        { orgId: ORG_RETAIN_ID, action: 'COPILOT_ASK_QUERY', createdAt: sixtyDaysAgo },
        { orgId: ORG_RETAIN_ID, action: 'USER_SIGNED_IN', createdAt: oneDayAgo },
        { orgId: ORG_RETAIN_ID, action: 'NOTE_SIGNED', createdAt: oneDayAgo },
      ],
    });

    const result = await purgeAuditForOrg(ORG_RETAIN_ID, now);

    expect(result.skipped).toBeNull();
    expect(result.rowsDeleted).toBe(3);
    expect(result.retentionDays).toBe(30);

    // Fresh rows + the new AUDIT_PURGE_RUN row remain.
    const remaining = await prisma.auditLog.findMany({
      where: { orgId: ORG_RETAIN_ID },
      orderBy: { createdAt: 'desc' },
    });
    expect(remaining).toHaveLength(3); // 2 fresh + 1 purge receipt
    const purgeRows = remaining.filter((r) => r.action === 'AUDIT_PURGE_RUN');
    expect(purgeRows).toHaveLength(1);
    expect((purgeRows[0]!.metadata as { rowsDeleted?: number }).rowsDeleted).toBe(3);
  });

  it('exempts AUDIT_PURGE_RUN rows from deletion (preserves deletion history)', async () => {
    const now = new Date();
    const oldPurgeReceipt = new Date(now.getTime() - 365 * 86_400_000); // 1 year old
    const oldOther = new Date(now.getTime() - 60 * 86_400_000);

    await prisma.auditLog.createMany({
      data: [
        {
          orgId: ORG_RETAIN_ID,
          action: 'AUDIT_PURGE_RUN',
          createdAt: oldPurgeReceipt,
          metadata: { rowsDeleted: 10, retentionDays: 30 },
        },
        { orgId: ORG_RETAIN_ID, action: 'NOTE_SIGNED', createdAt: oldOther },
      ],
    });

    const result = await purgeAuditForOrg(ORG_RETAIN_ID, now);
    expect(result.rowsDeleted).toBe(1); // only NOTE_SIGNED, not the old purge receipt

    const remaining = await prisma.auditLog.findMany({
      where: { orgId: ORG_RETAIN_ID, action: 'AUDIT_PURGE_RUN' },
    });
    // Old receipt + new receipt both survive.
    expect(remaining.length).toBeGreaterThanOrEqual(2);
  });

  it('returns no_rows_to_delete skip when nothing matches', async () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 1 * 86_400_000);

    // Only fresh rows.
    await prisma.auditLog.create({
      data: { orgId: ORG_RETAIN_ID, action: 'USER_SIGNED_IN', createdAt: oneDayAgo },
    });

    const result = await purgeAuditForOrg(ORG_RETAIN_ID, now);
    expect(result.skipped).toBe('no_rows_to_delete');
    expect(result.rowsDeleted).toBe(0);
    // Receipt still written (proof the purge ran, even if no-op).
    const purgeRows = await prisma.auditLog.findMany({
      where: { orgId: ORG_RETAIN_ID, action: 'AUDIT_PURGE_RUN' },
    });
    expect(purgeRows).toHaveLength(1);
  });
});

describeMaybe('purgeAuditAllOrgs', () => {
  it('processes only orgs with retention set + aggregates totals', async () => {
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 86_400_000);

    // RETAIN_ID has 2 old rows; FOREVER_ID has 1 old row (should NOT be touched).
    await prisma.auditLog.createMany({
      data: [
        { orgId: ORG_RETAIN_ID, action: 'USER_SIGNED_IN', createdAt: sixtyDaysAgo },
        { orgId: ORG_RETAIN_ID, action: 'NOTE_SIGNED', createdAt: sixtyDaysAgo },
        { orgId: ORG_FOREVER_ID, action: 'USER_SIGNED_IN', createdAt: sixtyDaysAgo },
      ],
    });

    const result = await purgeAuditAllOrgs(now);
    expect(result.orgsProcessed).toBe(1); // only RETAIN_ID has retention set
    expect(result.totalRowsDeleted).toBe(2);

    // FOREVER_ID's old row preserved.
    const forever = await prisma.auditLog.findMany({
      where: { orgId: ORG_FOREVER_ID },
    });
    expect(forever).toHaveLength(1);
  });
});
