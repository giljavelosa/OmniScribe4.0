import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Division, PrismaClient } from '@prisma/client';

import {
  refreshAllOrgRollups,
  refreshOrgRollups,
} from '@/lib/owner/rollup-refresh';

/**
 * Rollup refresh CLI integration tests — Polish (post-Wave 6).
 *
 * Hits the live Postgres. Verifies that calling refreshOrgRollups
 * writes the cache rows + the ROLLUP_REFRESHED audit rows, and that
 * refreshAllOrgRollups iterates across orgs cleanly.
 */

// Skipped in CI (no Postgres). Run locally via `npm test` with DATABASE_URL set.
const hasDb = !!process.env.DATABASE_URL;
const describeMaybe = hasDb ? describe : describe.skip;
const prisma = hasDb ? new PrismaClient() : (null as unknown as PrismaClient);

const ORG_ID = 'test-org-polish-rollup-refresh';

beforeAll(async () => {
  if (!hasDb) return;
  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: 'Polish Rollup Refresh Test Org',
      division: Division.MEDICAL,
      billingEmail: 'polishrollup@test.local',
    },
  });
});

beforeEach(async () => {
  await prisma.orgUsageDaily.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.orgLlmCostDaily.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.auditLog.deleteMany({
    where: { orgId: ORG_ID, action: 'ROLLUP_REFRESHED' },
  });
});

afterAll(async () => {
  if (!hasDb) return;
  await prisma.orgUsageDaily.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.orgLlmCostDaily.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.auditLog.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

describeMaybe('refreshOrgRollups', () => {
  it('returns one result per rollup type', async () => {
    const results = await refreshOrgRollups(ORG_ID);
    expect(results).toHaveLength(2);
    const types = results.map((r) => r.rollupType).sort();
    expect(types).toEqual(['llm-cost', 'usage']);
  });

  it('writes one ROLLUP_REFRESHED audit row per rollup type', async () => {
    await refreshOrgRollups(ORG_ID);
    const rows = await prisma.auditLog.findMany({
      where: { orgId: ORG_ID, action: 'ROLLUP_REFRESHED' },
    });
    expect(rows).toHaveLength(2);
    const types = rows
      .map((r) => (r.metadata as { rollupType: string }).rollupType)
      .sort();
    expect(types).toEqual(['llm-cost', 'usage']);
  });

  it('warms the OrgUsageDaily cache (rows present after refresh)', async () => {
    const before = await prisma.orgUsageDaily.count({ where: { orgId: ORG_ID } });
    expect(before).toBe(0);
    await refreshOrgRollups(ORG_ID, 7);
    const after = await prisma.orgUsageDaily.count({ where: { orgId: ORG_ID } });
    expect(after).toBe(7);
  });

  it('warms the OrgLlmCostDaily cache', async () => {
    await refreshOrgRollups(ORG_ID, 7);
    const after = await prisma.orgLlmCostDaily.count({ where: { orgId: ORG_ID } });
    expect(after).toBe(7);
  });

  it('audit metadata captures durationMs + rowsComputed + hasError', async () => {
    await refreshOrgRollups(ORG_ID, 7);
    const rows = await prisma.auditLog.findMany({
      where: { orgId: ORG_ID, action: 'ROLLUP_REFRESHED' },
    });
    for (const row of rows) {
      const meta = row.metadata as {
        durationMs: number;
        rowsComputed: number;
        hasError: boolean;
        windowDays: number;
      };
      expect(meta.rowsComputed).toBe(7);
      expect(meta.windowDays).toBe(7);
      expect(meta.hasError).toBe(false);
      expect(typeof meta.durationMs).toBe('number');
    }
  });
});

describeMaybe('refreshAllOrgRollups', () => {
  it('processes the test org + returns aggregate counts', async () => {
    const result = await refreshAllOrgRollups();
    expect(result.orgsProcessed).toBeGreaterThanOrEqual(1);
    expect(result.totalRefreshes).toBeGreaterThanOrEqual(2); // at least our test org × 2 rollup types
    // The test org's results should appear in perOrg.
    const ourOrg = result.perOrg.find((o) => o.orgId === ORG_ID);
    expect(ourOrg).toBeDefined();
    expect(ourOrg!.results).toHaveLength(2);
  });
});
