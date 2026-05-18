import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import {
  LLM_COST_MAX_WINDOW_DAYS,
  computeOrgLlmCost,
  getCurrentMonthSpend,
  getPerModelCost,
} from '@/lib/owner/llm-cost-rollup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(LLM_COST_MAX_WINDOW_DAYS).optional(),
});

/**
 * GET /api/owner/orgs/[id]/llm-cost?days=30 — Unit 35.
 *
 * Returns the per-day LLM cost rollup + per-model breakdown +
 * current-month spend + over-budget flag + cost-per-signed-note KPI.
 *
 * Owner-only. No audit row on read (consistent with
 * /api/owner/orgs/[id]/usage — high-frequency owner pages don't write
 * audit-noise).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;

  const { id: orgId } = await params;
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ days: url.searchParams.get('days') ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, monthlyLlmBudgetUsd: true },
  });
  if (!org) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const days = parsed.data.days ?? LLM_COST_MAX_WINDOW_DAYS;
  const now = new Date();

  const [rollup, perModel, currentMonthSpend] = await Promise.all([
    computeOrgLlmCost(orgId, days, now),
    getPerModelCost(orgId, days, now),
    getCurrentMonthSpend(orgId, now),
  ]);

  // Cost-per-signed-note over the same window. Pulls SIGNED notes
  // directly (rather than from OrgUsageDaily) so the metric is exact
  // for the requested window, not affected by usage cache staleness.
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      (days - 1) * 86_400_000,
  );
  const notesSigned = await prisma.note.count({
    where: { orgId, status: 'SIGNED', signedAt: { gte: windowStart } },
  });
  const totalCostUsd = rollup.reduce((sum, d) => sum + d.totalCostUsd, 0);
  const costPerSignedNote =
    notesSigned > 0 ? Math.round((totalCostUsd / notesSigned) * 10_000) / 10_000 : null;

  const budgetUsd = org.monthlyLlmBudgetUsd ? Number(org.monthlyLlmBudgetUsd) : null;
  const isOverBudget = budgetUsd != null && currentMonthSpend > budgetUsd;

  return NextResponse.json({
    data: {
      windowDays: days,
      rollup,
      perModel,
      totalCostUsd,
      notesSigned,
      costPerSignedNote,
      currentMonthSpend,
      monthlyBudgetUsd: budgetUsd,
      isOverBudget,
    },
  });
}
