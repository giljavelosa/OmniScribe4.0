import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Division, Prisma, PrismaClient } from '@prisma/client';

import {
  LLM_COST_CACHE_TTL_MS,
  LLM_COST_MAX_WINDOW_DAYS,
  computeOrgLlmCost,
  getCurrentMonthSpend,
  getPerModelCost,
} from '@/lib/owner/llm-cost-rollup';

/**
 * Per-org LLM cost rollup integration tests — Unit 35.
 *
 * Hits the live Postgres. Fixture: one org with LlmCallLog rows for
 * today (Sonnet + Haiku), yesterday (Sonnet only), and 35 days ago
 * (outside the window). Verifies the rollup aggregation, per-model
 * breakdown, cache TTL behavior, and current-month spend.
 */

// Skipped in CI (no Postgres). Run locally via `npm test` with DATABASE_URL set.
const hasDb = !!process.env.DATABASE_URL;
const describeMaybe = hasDb ? describe : describe.skip;
const prisma = hasDb ? new PrismaClient() : (null as unknown as PrismaClient);
const ORG_ID = 'test-org-unit-35-rollup';

const SONNET = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const HAIKU = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

beforeAll(async () => {
  if (!hasDb) return;
  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: 'Unit 35 Rollup Test Org',
      division: Division.MEDICAL,
      billingEmail: 'unit35rollup@test.local',
    },
  });
});

beforeEach(async () => {
  await prisma.llmCallLog.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.orgLlmCostDaily.deleteMany({ where: { orgId: ORG_ID } });

  const now = new Date();
  const noonToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0),
  );
  const noonYesterday = new Date(noonToday.getTime() - 86_400_000);
  const noon35DaysAgo = new Date(noonToday.getTime() - 35 * 86_400_000);

  // Today: 2 Sonnet calls + 1 Haiku call.
  await prisma.llmCallLog.createMany({
    data: [
      {
        orgId: ORG_ID,
        surface: 'copilot.ask',
        model: SONNET,
        tokensIn: 1000,
        tokensOut: 500,
        costUsd: new Prisma.Decimal('0.0105'),
        latencyMs: 1000,
        createdAt: noonToday,
      },
      {
        orgId: ORG_ID,
        surface: 'copilot.ask',
        model: SONNET,
        tokensIn: 2000,
        tokensOut: 1000,
        costUsd: new Prisma.Decimal('0.0210'),
        latencyMs: 1500,
        createdAt: noonToday,
      },
      {
        orgId: ORG_ID,
        surface: 'copilot.draft.patientMessage',
        model: HAIKU,
        tokensIn: 1000,
        tokensOut: 500,
        costUsd: new Prisma.Decimal('0.0035'),
        latencyMs: 600,
        createdAt: noonToday,
      },
      // Yesterday: 1 Sonnet call.
      {
        orgId: ORG_ID,
        surface: 'worker.brief.sonnet',
        model: SONNET,
        tokensIn: 500,
        tokensOut: 1000,
        costUsd: new Prisma.Decimal('0.0165'),
        latencyMs: 2000,
        createdAt: noonYesterday,
      },
      // 35 days ago: outside the default 30-day window.
      {
        orgId: ORG_ID,
        surface: 'copilot.ask',
        model: SONNET,
        tokensIn: 5000,
        tokensOut: 5000,
        costUsd: new Prisma.Decimal('0.0900'),
        latencyMs: 3000,
        createdAt: noon35DaysAgo,
      },
    ],
  });
});

afterAll(async () => {
  if (!hasDb) return;
  await prisma.llmCallLog.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.orgLlmCostDaily.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

describeMaybe('computeOrgLlmCost', () => {
  it('returns exactly windowDays entries, sorted oldest-first', async () => {
    const result = await computeOrgLlmCost(ORG_ID, 7);
    expect(result).toHaveLength(7);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.day > result[i - 1]!.day).toBe(true);
    }
  });

  it('aggregates today + yesterday correctly + zeros outside the window', async () => {
    const result = await computeOrgLlmCost(ORG_ID, 3);
    const [twoDaysAgo, yesterday, today] = result;
    expect(twoDaysAgo!.totalCostUsd).toBe(0);
    expect(twoDaysAgo!.callCount).toBe(0);

    expect(yesterday!.callCount).toBe(1);
    expect(yesterday!.totalCostUsd).toBe(0.0165);
    expect(yesterday!.totalTokensIn).toBe(500);
    expect(yesterday!.totalTokensOut).toBe(1000);

    expect(today!.callCount).toBe(3);
    expect(today!.totalCostUsd).toBe(0.035); // 0.0105 + 0.021 + 0.0035
    expect(today!.totalTokensIn).toBe(4000);
    expect(today!.totalTokensOut).toBe(2000);
  });

  it('excludes rows outside the 30-day window', async () => {
    const result = await computeOrgLlmCost(ORG_ID, 30);
    const total = result.reduce((sum, d) => sum + d.totalCostUsd, 0);
    // Should NOT include the $0.09 row from 35 days ago.
    expect(total).toBeCloseTo(0.0515, 4); // 0.0165 + 0.035
  });

  it('caches: second call within TTL does not bump computedAt', async () => {
    await computeOrgLlmCost(ORG_ID, 3);
    const before = await prisma.orgLlmCostDaily.findMany({
      where: { orgId: ORG_ID },
      select: { day: true, computedAt: true },
      orderBy: { day: 'asc' },
    });
    expect(before.length).toBe(3);
    await computeOrgLlmCost(ORG_ID, 3);
    const after = await prisma.orgLlmCostDaily.findMany({
      where: { orgId: ORG_ID },
      select: { day: true, computedAt: true },
      orderBy: { day: 'asc' },
    });
    for (const a of after) {
      const b = before.find((x) => x.day.getTime() === a.day.getTime());
      expect(a.computedAt.getTime()).toBe(b!.computedAt.getTime());
    }
  });

  it('recomputes when cache is stale (past TTL)', async () => {
    await computeOrgLlmCost(ORG_ID, 3);
    const stale = new Date(Date.now() - LLM_COST_CACHE_TTL_MS - 60_000);
    await prisma.orgLlmCostDaily.updateMany({
      where: { orgId: ORG_ID },
      data: { computedAt: stale },
    });
    await computeOrgLlmCost(ORG_ID, 3);
    const after = await prisma.orgLlmCostDaily.findMany({
      where: { orgId: ORG_ID },
      select: { computedAt: true },
    });
    for (const row of after) {
      expect(row.computedAt.getTime()).toBeGreaterThan(stale.getTime());
    }
  });

  it('caps window at LLM_COST_MAX_WINDOW_DAYS', async () => {
    const result = await computeOrgLlmCost(ORG_ID, 999);
    expect(result.length).toBe(LLM_COST_MAX_WINDOW_DAYS);
  });
});

describeMaybe('getPerModelCost', () => {
  it('groups + sorts models by totalCostUsd DESC', async () => {
    const result = await getPerModelCost(ORG_ID, 30);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // Sonnet should outweigh Haiku because of the larger calls today.
    expect(result[0]!.model).toBe(SONNET);
    expect(result[0]!.totalCostUsd).toBeGreaterThan(result[1]!.totalCostUsd);
  });

  it('excludes rows outside the window', async () => {
    const result = await getPerModelCost(ORG_ID, 3);
    const total = result.reduce((sum, m) => sum + m.totalCostUsd, 0);
    // Excludes the 35-days-ago row.
    expect(total).toBeCloseTo(0.0515, 4);
  });
});

describeMaybe('getCurrentMonthSpend', () => {
  it('sums all rows in the current calendar month', async () => {
    const spend = await getCurrentMonthSpend(ORG_ID);
    // Depending on day-of-month, either today+yesterday land in the
    // current month (most days) OR yesterday is last month (1st of
    // month). Spend is always >= today's bucket alone.
    expect(spend).toBeGreaterThanOrEqual(0.035);
  });
});
