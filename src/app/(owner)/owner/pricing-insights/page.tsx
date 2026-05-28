import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  ALL_BILLING_PLANS,
  computeIncludedDrafts,
  getPlanPolicy,
  UNLIMITED,
} from '@/lib/billing/plan-policy';
import type { BillingPlan, CommercialModel } from '@prisma/client';
import { usesVisitBankBilling } from '@/lib/billing/commercial-mode';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pricing insights' };

/**
 * /owner/pricing-insights — internal pricing dashboard.
 *
 * Tells the platform owner whether the published tier numbers (60 /
 * 160 / 300 drafts) are right, by showing the actual usage histogram
 * across every paid org. The point: design Tier 3 (vocabulary
 * commands, Practice volume bands, etc.) from REAL data, not
 * imagination — same pattern as the Tier 2 telemetry dashboard.
 *
 * Surfaces:
 *   1. Total active orgs by plan (for the revenue mix).
 *   2. Per-org draft histogram for the last 30 days.
 *   3. "Right-fit" analysis: % of orgs where their CURRENT plan
 *      matches the cheapest plan for their actual usage.
 *   4. Margin signals: estimated cost per org (drafts × $0.55) vs
 *      revenue (subscription base + overage).
 *
 * Owner-only (PLATFORM_OWNER role). PHI-free — reads only AuditLog
 * counts + Organization.billingPlan + seat counts.
 */

const MS_PER_DAY = 86_400_000;

const COMMERCIAL_MODEL_LABELS: Record<CommercialModel, string> = {
  TRIAL: 'Trial',
  SOLO_VISIT_BANK: 'Solo visit bank',
  ORG_VISIT_BANK: 'Org visit bank',
  ENTERPRISE_PER_SEAT: 'Enterprise',
  LEGACY_SKU: 'Legacy SKU',
};

/** Estimated marginal cost per draft (cents). Pulled from the cost
 *  analysis in `references/strategic/stripe-pricing-skus.md` — Soniox
 *  $0.10 + Bedrock ~$0.30 + infra ~$0.10 + Stripe fee ~$0.05 = ~$0.55. */
const ESTIMATED_DRAFT_COST_CENTS = 55;

/** Estimated base price per plan (cents/month) for the revenue side
 *  of the margin calculation. Mirrors `recommend-plan.ts` SOLO map +
 *  per-seat plans multiplied by current seat count at render time. */
const PLAN_BASE_PRICE_CENTS: Record<BillingPlan, number> = {
  TRIAL: 0,
  SOLO_STARTER: 9_900,
  SOLO_PRO: 17_900,
  SOLO_POWER: 29_900,
  SOLO_UNLIMITED: 34_900,
  DUO: 14_900, // per seat
  PRACTICE: 17_900, // per seat (small-band default; Stripe carries the volume-band actual)
  ENTERPRISE: 0, // contract-defined, not modeled here
};

export default async function OwnerPricingInsightsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.platformRole !== 'PLATFORM_OWNER') redirect('/home');

  const now = new Date();
  const since = new Date(now.getTime() - 30 * MS_PER_DAY);

  // 1. Org counts by plan + per-org seat counts + visit-bank contracts.
  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      billingPlan: true,
      visitBankBalance: true,
      commercialContract: {
        select: {
          commercialModel: true,
          capacityEnforcementEnabled: true,
          committedSeats: true,
        },
      },
    },
  });
  const seatCounts = await prisma.orgUser.groupBy({
    by: ['orgId'],
    where: { isActive: true },
    _count: { _all: true },
  });
  const seatByOrg = new Map(seatCounts.map((s) => [s.orgId, s._count._all]));

  // 2. Per-org draft counts for the last 30 days.
  const draftRows = await prisma.auditLog.findMany({
    where: {
      action: 'NOTE_GENERATION_COMPLETED',
      createdAt: { gte: since },
      resourceId: { not: null },
    },
    select: { orgId: true, resourceId: true },
    distinct: ['orgId', 'resourceId'],
  });
  const draftsByOrg = new Map<string, number>();
  for (const r of draftRows) {
    if (!r.orgId) continue;
    draftsByOrg.set(r.orgId, (draftsByOrg.get(r.orgId) ?? 0) + 1);
  }

  // 2b. Visit-bank consumption — distinct note debits in the last 30 days.
  const visitDebitRows = await prisma.visitLedgerEntry.groupBy({
    by: ['orgId'],
    where: {
      sourceType: 'NOTE_DEBIT',
      createdAt: { gte: since },
    },
    _count: { _all: true },
  });
  const visitsUsedByOrg = new Map(
    visitDebitRows.map((row) => [row.orgId, row._count._all]),
  );

  // 3. Per-org metrics.
  const perOrg = orgs.map((org) => {
    const drafts = draftsByOrg.get(org.id) ?? 0;
    const seats = seatByOrg.get(org.id) ?? 0;
    const policy = getPlanPolicy(org.billingPlan);
    const draftsIncluded = computeIncludedDrafts(org.billingPlan, seats);
    const overage =
      draftsIncluded === UNLIMITED ? 0 : Math.max(0, drafts - draftsIncluded);
    const overageCents = overage * policy.overageRateCents;
    const baseCents =
      (PLAN_BASE_PRICE_CENTS[org.billingPlan] ?? 0) *
      (policy.perSeat ? Math.max(seats, policy.seatMin) : 1);
    const revenueCents = baseCents + overageCents;
    const costCents = drafts * ESTIMATED_DRAFT_COST_CENTS;
    const marginCents = revenueCents - costCents;
    const marginPct =
      revenueCents > 0 ? (marginCents / revenueCents) * 100 : 0;
    return {
      orgId: org.id,
      orgName: org.name,
      billingPlan: org.billingPlan,
      seats,
      drafts,
      draftsIncluded,
      overage,
      revenueCents,
      costCents,
      marginCents,
      marginPct,
    };
  });

  // 4. Histogram by plan.
  const planSummary = ALL_BILLING_PLANS.map((plan) => {
    const orgsOnPlan = perOrg.filter((o) => o.billingPlan === plan);
    const totalDrafts = orgsOnPlan.reduce((s, o) => s + o.drafts, 0);
    const totalRevenue = orgsOnPlan.reduce((s, o) => s + o.revenueCents, 0);
    const totalCost = orgsOnPlan.reduce((s, o) => s + o.costCents, 0);
    const totalMargin = totalRevenue - totalCost;
    return {
      plan,
      label: getPlanPolicy(plan).label,
      orgCount: orgsOnPlan.length,
      totalDrafts,
      avgDrafts: orgsOnPlan.length > 0 ? Math.round(totalDrafts / orgsOnPlan.length) : 0,
      totalRevenueCents: totalRevenue,
      totalCostCents: totalCost,
      totalMarginCents: totalMargin,
    };
  }).filter((s) => s.orgCount > 0);

  const totalActiveOrgs = perOrg.length;
  const totalRevenueCents = perOrg.reduce((s, o) => s + o.revenueCents, 0);
  const totalCostCents = perOrg.reduce((s, o) => s + o.costCents, 0);
  const totalMarginCents = totalRevenueCents - totalCostCents;
  const overallMarginPct =
    totalRevenueCents > 0 ? (totalMarginCents / totalRevenueCents) * 100 : 0;

  // 5. Top whales (highest absolute draft counts) — these drive the
  //    "do we need a Power tier ceiling" question.
  const topWhales = [...perOrg]
    .sort((a, b) => b.drafts - a.drafts)
    .slice(0, 10);

  const visitBankOrgs = orgs
    .filter((org) => usesVisitBankBilling(org.commercialContract))
    .map((org) => ({
      orgId: org.id,
      orgName: org.name,
      commercialModel: org.commercialContract!.commercialModel,
      modelLabel: COMMERCIAL_MODEL_LABELS[org.commercialContract!.commercialModel],
      visitBankBalance: org.visitBankBalance,
      visitsUsed30d: visitsUsedByOrg.get(org.id) ?? 0,
      committedSeats: org.commercialContract!.committedSeats,
      legacyPlanLabel: getPlanPolicy(org.billingPlan).label,
    }))
    .sort((a, b) => b.visitsUsed30d - a.visitsUsed30d);

  const totalVisitsUsed30d = visitBankOrgs.reduce((sum, row) => sum + row.visitsUsed30d, 0);
  const totalBankBalance = visitBankOrgs.reduce((sum, row) => sum + row.visitBankBalance, 0);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2lg font-semibold">Pricing insights</h1>
        <p className="text-sm text-muted-foreground">
          Internal — last 30 days · {totalActiveOrgs.toLocaleString()} orgs ·{' '}
          {visitBankOrgs.length.toLocaleString()} on visit bank ·{' '}
          {totalVisitsUsed30d.toLocaleString()} visits used ·{' '}
          {totalBankBalance.toLocaleString()} visits in bank · $
          {(totalRevenueCents / 100).toLocaleString()} legacy-plan revenue · $
          {(totalCostCents / 100).toLocaleString()} est. draft cost · gross margin{' '}
          {overallMarginPct.toFixed(1)}%.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-md">Revenue mix by plan</CardTitle>
            <CardDescription>
              How orgs distribute across the published ladder. A heavy
              concentration on one plan suggests the tier above is
              under-priced; on the other hand a flat distribution suggests
              the steps are well-calibrated.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 font-medium">Plan</th>
                  <th className="py-2 font-medium text-right">Orgs</th>
                  <th className="py-2 font-medium text-right">Avg drafts</th>
                  <th className="py-2 font-medium text-right">Revenue</th>
                  <th className="py-2 font-medium text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {planSummary.map((row) => (
                  <tr key={row.plan} className="border-b border-border/40">
                    <td className="py-2">
                      <StatusBadge variant="neutral" noIcon>
                        {row.label}
                      </StatusBadge>
                    </td>
                    <td className="py-2 text-right font-mono text-xs">
                      {row.orgCount}
                    </td>
                    <td className="py-2 text-right font-mono text-xs">
                      {row.avgDrafts.toLocaleString()}
                    </td>
                    <td className="py-2 text-right font-mono text-xs">
                      ${(row.totalRevenueCents / 100).toLocaleString()}
                    </td>
                    <td className="py-2 text-right font-mono text-xs">
                      <span
                        className={
                          row.totalMarginCents < 0 ? 'text-[var(--status-danger-fg)]' : ''
                        }
                      >
                        ${(row.totalMarginCents / 100).toLocaleString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-md">Top 10 by draft volume</CardTitle>
            <CardDescription>
              Heaviest-usage orgs. Whales on Solo Unlimited (which has no
              overage line) cap your margin at $349 — watch for orgs here
              that are unprofitable based on their actual draft cost.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 font-medium">Org</th>
                  <th className="py-2 font-medium">Plan</th>
                  <th className="py-2 font-medium text-right">Drafts</th>
                  <th className="py-2 font-medium text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {topWhales.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      No drafts in the last 30 days yet.
                    </td>
                  </tr>
                ) : (
                  topWhales.map((row) => (
                    <tr key={row.orgId} className="border-b border-border/40">
                      <td className="py-2 truncate max-w-[180px]">{row.orgName}</td>
                      <td className="py-2">
                        <StatusBadge variant="neutral" noIcon className="text-[10px]">
                          {getPlanPolicy(row.billingPlan).label}
                        </StatusBadge>
                      </td>
                      <td className="py-2 text-right font-mono text-xs">
                        {row.drafts.toLocaleString()}
                      </td>
                      <td className="py-2 text-right font-mono text-xs">
                        <span
                          className={row.marginCents < 0 ? 'text-[var(--status-danger-fg)]' : ''}
                        >
                          ${(row.marginCents / 100).toFixed(0)} (
                          {row.marginPct.toFixed(0)}%)
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Visit bank orgs</CardTitle>
          <CardDescription>
            Orgs on the Unit 51 visit-bank model — bank balance, visits consumed in the last 30
            days, and commercial model. Legacy BillingPlan label shown for cross-check until the
            bridge is fully retired.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 font-medium">Org</th>
                <th className="py-2 font-medium">Model</th>
                <th className="py-2 font-medium text-right">Bank</th>
                <th className="py-2 font-medium text-right">Used 30d</th>
                <th className="py-2 font-medium text-right">Seats</th>
                <th className="py-2 font-medium">Legacy plan</th>
              </tr>
            </thead>
            <tbody>
              {visitBankOrgs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    No visit-bank contracts yet.
                  </td>
                </tr>
              ) : (
                visitBankOrgs.map((row) => (
                  <tr key={row.orgId} className="border-b border-border/40">
                    <td className="py-2 truncate max-w-[180px]">{row.orgName}</td>
                    <td className="py-2">
                      <StatusBadge variant="info" noIcon className="text-[10px]">
                        {row.modelLabel}
                      </StatusBadge>
                    </td>
                    <td className="py-2 text-right font-mono text-xs">
                      {row.visitBankBalance.toLocaleString()}
                    </td>
                    <td className="py-2 text-right font-mono text-xs">
                      {row.visitsUsed30d.toLocaleString()}
                    </td>
                    <td className="py-2 text-right font-mono text-xs">
                      {row.committedSeats.toLocaleString()}
                    </td>
                    <td className="py-2">
                      <StatusBadge variant="neutral" noIcon className="text-[10px]">
                        {row.legacyPlanLabel}
                      </StatusBadge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Cost-basis assumption</CardTitle>
          <CardDescription>
            All margin calculations use a flat ${(ESTIMATED_DRAFT_COST_CENTS / 100).toFixed(2)}/draft
            cost basis (Soniox + Bedrock + infra + Stripe fee, derived in{' '}
            <code className="text-xs">references/strategic/stripe-pricing-skus.md</code>).
            Replace this with a real per-draft cost from AWS + Stripe invoices once
            you have ≥30 days of production billing data.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
