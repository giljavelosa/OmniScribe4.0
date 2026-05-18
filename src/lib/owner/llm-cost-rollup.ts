/**
 * Per-org LLM cost rollup — Unit 35.
 *
 * Aggregates `LlmCallLog` rows into per-day buckets cached in
 * `OrgLlmCostDaily`. Same shape + freshness semantics as Unit 32's
 * usage-rollup module:
 *   - 60-minute TTL on each cached row
 *   - 30-day hard cap on the request window
 *   - UTC-midnight day buckets
 *
 * Per-model breakdown is computed on-the-fly (not cached) because the
 * UI shows it at the org-window level (single aggregate query), not
 * per-day-per-model.
 */

import { prisma } from '@/lib/prisma';

export const LLM_COST_CACHE_TTL_MS = 60 * 60 * 1000;
export const LLM_COST_MAX_WINDOW_DAYS = 30;

export type DailyLlmCost = {
  day: string; // YYYY-MM-DD (UTC)
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  callCount: number;
};

export type PerModelCost = {
  model: string;
  totalCostUsd: number;
  callCount: number;
};

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function generateDayBuckets(now: Date, days: number): Date[] {
  const today = startOfUtcDay(now);
  const out: Date[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(today.getTime() - i * 24 * 60 * 60 * 1000));
  }
  return out;
}

async function computeOneBucket(
  orgId: string,
  dayStart: Date,
): Promise<{ totalTokensIn: number; totalTokensOut: number; totalCostUsd: number; callCount: number }> {
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const agg = await prisma.llmCallLog.aggregate({
    where: { orgId, createdAt: { gte: dayStart, lt: dayEnd } },
    _sum: { tokensIn: true, tokensOut: true, costUsd: true },
    _count: { _all: true },
  });
  return {
    totalTokensIn: agg._sum.tokensIn ?? 0,
    totalTokensOut: agg._sum.tokensOut ?? 0,
    totalCostUsd: agg._sum.costUsd ? Number(agg._sum.costUsd) : 0,
    callCount: agg._count._all,
  };
}

/**
 * Compute per-day cost rollup for an org. Returns exactly `windowDays`
 * entries (zero-padded for empty buckets), oldest-first.
 *
 * Cache strategy mirrors `computeOrgUsage`:
 *   - Fetch existing OrgLlmCostDaily rows for the window.
 *   - For each bucket where the row is missing OR past TTL, recompute +
 *     upsert.
 *   - Re-read so the returned array reflects the post-compute state.
 */
export async function computeOrgLlmCost(
  orgId: string,
  windowDays: number = LLM_COST_MAX_WINDOW_DAYS,
  now: Date = new Date(),
): Promise<DailyLlmCost[]> {
  const days = Math.min(Math.max(windowDays, 1), LLM_COST_MAX_WINDOW_DAYS);
  const buckets = generateDayBuckets(now, days);
  const oldest = buckets[0]!;
  const newest = buckets[buckets.length - 1]!;
  const cacheCutoff = new Date(now.getTime() - LLM_COST_CACHE_TTL_MS);

  const existingRows = await prisma.orgLlmCostDaily.findMany({
    where: { orgId, day: { gte: oldest, lte: newest } },
  });
  const byDay = new Map(existingRows.map((row) => [row.day.getTime(), row]));

  const toCompute = buckets.filter((dayStart) => {
    const row = byDay.get(dayStart.getTime());
    if (!row) return true;
    return row.computedAt < cacheCutoff;
  });

  for (const dayStart of toCompute) {
    const counts = await computeOneBucket(orgId, dayStart);
    await prisma.orgLlmCostDaily.upsert({
      where: { orgId_day: { orgId, day: dayStart } },
      create: { orgId, day: dayStart, ...counts, computedAt: now },
      update: { ...counts, computedAt: now },
    });
  }

  const finalRows = await prisma.orgLlmCostDaily.findMany({
    where: { orgId, day: { gte: oldest, lte: newest } },
    orderBy: { day: 'asc' },
  });
  const finalByDay = new Map(finalRows.map((r) => [r.day.getTime(), r]));

  return buckets.map((dayStart) => {
    const row = finalByDay.get(dayStart.getTime());
    return {
      day: toIsoDay(dayStart),
      totalTokensIn: row?.totalTokensIn ?? 0,
      totalTokensOut: row?.totalTokensOut ?? 0,
      totalCostUsd: row?.totalCostUsd ? Number(row.totalCostUsd) : 0,
      callCount: row?.callCount ?? 0,
    };
  });
}

/**
 * Per-model breakdown across the same window. Always live (not cached).
 * Returned sorted by totalCostUsd DESC so the UI surfaces the most-
 * expensive models first.
 */
export async function getPerModelCost(
  orgId: string,
  windowDays: number = LLM_COST_MAX_WINDOW_DAYS,
  now: Date = new Date(),
): Promise<PerModelCost[]> {
  const days = Math.min(Math.max(windowDays, 1), LLM_COST_MAX_WINDOW_DAYS);
  const buckets = generateDayBuckets(now, days);
  const oldest = buckets[0]!;
  const newest = new Date(buckets[buckets.length - 1]!.getTime() + 24 * 60 * 60 * 1000);

  const grouped = await prisma.llmCallLog.groupBy({
    by: ['model'],
    where: { orgId, createdAt: { gte: oldest, lt: newest } },
    _sum: { costUsd: true },
    _count: { _all: true },
  });

  return grouped
    .map((row) => ({
      model: row.model,
      totalCostUsd: row._sum.costUsd ? Number(row._sum.costUsd) : 0,
      callCount: row._count._all,
    }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

/**
 * Current calendar-month spend in USD. Used for the budget-threshold
 * warning ("over budget" badge on the LlmCostCard).
 */
export async function getCurrentMonthSpend(
  orgId: string,
  now: Date = new Date(),
): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const agg = await prisma.llmCallLog.aggregate({
    where: { orgId, createdAt: { gte: monthStart } },
    _sum: { costUsd: true },
  });
  return agg._sum.costUsd ? Number(agg._sum.costUsd) : 0;
}
