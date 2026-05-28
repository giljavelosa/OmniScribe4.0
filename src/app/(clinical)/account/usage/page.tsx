import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import {
  computeIncludedDrafts,
  getPlanPolicy,
  UNLIMITED,
} from '@/lib/billing/plan-policy';
import {
  compareSoloPlans,
  recommendSoloPlan,
} from '@/lib/billing/recommend-plan';
import { countOrgDraftsSince } from '@/lib/billing/draft-counter';
import { VisitBankSection } from '@/components/billing/visit-bank-section';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Usage' };

/**
 * /account/usage — customer-facing usage + plan-economics page.
 *
 * Surfaces:
 *   1. Current plan + bundled drafts + this-period overage rate.
 *   2. This-month draft count (from AuditLog NOTE_GENERATION_COMPLETED rows).
 *   3. Effective $/draft on the current plan.
 *   4. Last 3 months of draft counts as a sparkline.
 *   5. "Would you save money on plan X?" comparison table (Solo only).
 *
 * Why the customer sees this
 * --------------------------
 * The pricing-discovery loop we sketched in
 * `references/strategic/stripe-pricing-skus.md`: launch flat-rate, let
 * the customer see their actual usage, let them self-select into the
 * right tier. This page IS that loop on the customer side.
 *
 * PHI fence
 * ---------
 * Reads only AuditLog `resourceId`s (note ids, not note bodies).
 * Counts only — no transcript text, no patient names, no PHI ever
 * surfaced.
 */

const MS_PER_DAY = 86_400_000;

export default async function AccountUsagePage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');
  const orgId = session.user.orgId;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, billingPlan: true },
  });
  if (!org) redirect('/home');

  const policy = getPlanPolicy(org.billingPlan);
  const seatCount = await prisma.orgUser.count({
    where: { orgId, isActive: true },
  });
  const draftsIncluded = computeIncludedDrafts(org.billingPlan, seatCount);

  // This billing period — for v1 we approximate as the last 30 days
  // since we don't have direct access to the Stripe period boundary
  // here. Close enough for the customer's mental model; the actual
  // billed overage uses the Stripe period (see usage-reporter).
  const now = new Date();
  const periodStart = new Date(now.getTime() - 30 * MS_PER_DAY);
  const draftsThisPeriod = await countOrgDraftsSince(orgId, periodStart);

  const monthlyHistory = await countDraftsByMonth(orgId, 6);

  const overage =
    draftsIncluded === UNLIMITED ? 0 : Math.max(0, draftsThisPeriod - draftsIncluded);
  const overageCostCents = overage * policy.overageRateCents;

  // Solo plans get a recommendation; per-seat plans show their own
  // economics + a "looks fine" message.
  const isSoloPlan =
    org.billingPlan === 'SOLO_STARTER' ||
    org.billingPlan === 'SOLO_PRO' ||
    org.billingPlan === 'SOLO_POWER' ||
    org.billingPlan === 'SOLO_UNLIMITED';

  const soloComparison = isSoloPlan ? compareSoloPlans(draftsThisPeriod) : null;
  const soloRecommendation = isSoloPlan ? recommendSoloPlan(draftsThisPeriod) : null;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2lg font-semibold">Usage</h1>
        <p className="text-sm text-muted-foreground">
          {org.name} · {policy.label} plan · last 30 days
        </p>
      </header>

      <VisitBankSection />

      {org.billingPlan === 'TRIAL' && (
        <StatusBanner variant="info">
          You&apos;re on a trial. Pick a plan from the comparison below to
          continue after your trial ends.
        </StatusBanner>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-md">This period</CardTitle>
            <CardDescription>
              Drafts the AI generated for this account in the last 30 days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-mono tabular-nums">
                  {draftsThisPeriod.toLocaleString()}
                </span>
                <span className="text-sm text-muted-foreground">
                  drafts
                  {draftsIncluded !== UNLIMITED && (
                    <> of {draftsIncluded.toLocaleString()} included</>
                  )}
                </span>
              </div>
              {draftsIncluded !== UNLIMITED && (
                <ProgressBar
                  numerator={draftsThisPeriod}
                  denominator={draftsIncluded}
                />
              )}
              {overage > 0 && (
                <p className="text-sm text-muted-foreground">
                  <strong>{overage.toLocaleString()}</strong> overage drafts at{' '}
                  ${(policy.overageRateCents / 100).toFixed(2)} = $
                  {(overageCostCents / 100).toFixed(2)} this period.
                </p>
              )}
              {overage === 0 && draftsIncluded !== UNLIMITED && (
                <p className="text-sm text-muted-foreground">
                  You&apos;re within your bundle. No overage charges.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-md">Effective cost</CardTitle>
            <CardDescription>
              What you&apos;re paying per draft right now.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EffectiveCost
              billingPlan={org.billingPlan}
              draftsThisPeriod={draftsThisPeriod}
              overageCostCents={overageCostCents}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Last 6 months</CardTitle>
          <CardDescription>Drafts per calendar month — your usage curve.</CardDescription>
        </CardHeader>
        <CardContent>
          <MonthlySparkline data={monthlyHistory} />
        </CardContent>
      </Card>

      {soloComparison && soloRecommendation && (
        <Card>
          <CardHeader>
            <CardTitle className="text-md">
              Plan economics — based on this month
            </CardTitle>
            <CardDescription>
              At {draftsThisPeriod.toLocaleString()} drafts/month, here&apos;s
              what you would pay on each Solo plan. Your current plan is
              highlighted; the cheapest fit is marked with{' '}
              <StatusBadge variant="success" noIcon className="text-[10px]">Best</StatusBadge>.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 font-medium">Plan</th>
                  <th className="py-2 font-medium">Base</th>
                  <th className="py-2 font-medium">Drafts incl.</th>
                  <th className="py-2 font-medium">Overage</th>
                  <th className="py-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {soloComparison.map((row) => {
                  const isCurrent = row.plan === org.billingPlan;
                  const isBest = row.plan === soloRecommendation.plan;
                  return (
                    <tr key={row.plan} className="border-b border-border/40">
                      <td className="py-2 flex items-center gap-2">
                        {row.label}
                        {isCurrent && (
                          <StatusBadge variant="info" noIcon className="text-[10px]">
                            Current
                          </StatusBadge>
                        )}
                        {isBest && !isCurrent && (
                          <StatusBadge variant="success" noIcon className="text-[10px]">
                            Best
                          </StatusBadge>
                        )}
                      </td>
                      <td className="py-2 font-mono text-xs">
                        ${(row.basePriceCents / 100).toFixed(0)}
                      </td>
                      <td className="py-2 font-mono text-xs">
                        {row.draftsIncluded === UNLIMITED
                          ? '∞'
                          : row.draftsIncluded.toLocaleString()}
                      </td>
                      <td className="py-2 font-mono text-xs">
                        {row.overageDrafts === 0
                          ? '—'
                          : `${row.overageDrafts} × $${(
                              row.overageCostCents / row.overageDrafts / 100
                            ).toFixed(2)} = $${(
                              row.overageCostCents / 100
                            ).toFixed(2)}`}
                      </td>
                      <td className="py-2 font-mono text-xs text-right">
                        ${(row.totalCostCents / 100).toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {soloRecommendation.plan !== org.billingPlan && (
              <p className="mt-3 text-sm text-muted-foreground">
                Switching to <strong>{soloRecommendation.label}</strong> would
                save you{' '}
                <strong>
                  $
                  {(
                    (soloComparison.find((r) => r.plan === org.billingPlan)
                      ?.totalCostCents ?? 0) / 100 -
                    soloRecommendation.totalCostCents / 100
                  ).toFixed(2)}
                </strong>{' '}
                this month. (Your usage may vary — pick the plan that matches
                your typical month, not your busiest one.)
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function EffectiveCost({
  billingPlan,
  draftsThisPeriod,
  overageCostCents,
}: {
  billingPlan: string;
  draftsThisPeriod: number;
  overageCostCents: number;
}) {
  const policy = getPlanPolicy(billingPlan as Parameters<typeof getPlanPolicy>[0]);
  const baseCents =
    {
      TRIAL: 0,
      SOLO_STARTER: 9_900,
      SOLO_PRO: 17_900,
      SOLO_POWER: 29_900,
      SOLO_UNLIMITED: 34_900,
      DUO: 29_800, // 2 × $149
      PRACTICE: 17_900, // per-seat — UI shows "per seat"
      ENTERPRISE: 0,
    }[billingPlan] ?? 0;
  const totalCents = baseCents + overageCostCents;
  const effectiveCents =
    draftsThisPeriod > 0 ? totalCents / draftsThisPeriod : 0;

  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div>
        <dt className="text-xs text-muted-foreground">Plan base</dt>
        <dd className="font-mono">
          ${(baseCents / 100).toFixed(2)}
          {policy.perSeat ? '/seat' : ''}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Overage</dt>
        <dd className="font-mono">${(overageCostCents / 100).toFixed(2)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Total this month</dt>
        <dd className="font-mono">${(totalCents / 100).toFixed(2)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">$ per draft</dt>
        <dd className="font-mono">
          {draftsThisPeriod === 0
            ? '—'
            : `$${(effectiveCents / 100).toFixed(2)}`}
        </dd>
      </div>
    </dl>
  );
}

function ProgressBar({
  numerator,
  denominator,
}: {
  numerator: number;
  denominator: number;
}) {
  const pct = denominator === 0 ? 0 : Math.min(100, (numerator / denominator) * 100);
  const variant = pct >= 100 ? 'bg-[var(--status-warning-fg)]' : 'bg-primary';
  return (
    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full ${variant}`}
        style={{ width: `${pct}%` }}
        aria-hidden
      />
    </div>
  );
}

function MonthlySparkline({
  data,
}: {
  data: Array<{ monthLabel: string; drafts: number }>;
}) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No drafts in the last 6 months. Generate your first AI draft from a
        recording to start seeing usage here.
      </p>
    );
  }
  const max = Math.max(1, ...data.map((d) => d.drafts));
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.monthLabel} className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-20 shrink-0">
            {d.monthLabel}
          </span>
          <div className="flex-1 h-3 bg-muted rounded-sm overflow-hidden">
            <div
              className="h-full bg-primary"
              style={{ width: `${(d.drafts / max) * 100}%` }}
              aria-hidden
            />
          </div>
          <span className="text-xs font-mono tabular-nums w-12 text-right">
            {d.drafts}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

async function countDraftsByMonth(
  orgId: string,
  monthsBack: number,
): Promise<Array<{ monthLabel: string; drafts: number }>> {
  const buckets: Array<{ monthLabel: string; drafts: number }> = [];
  const now = new Date();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const rows = await prisma.auditLog.findMany({
      where: {
        orgId,
        action: 'NOTE_GENERATION_COMPLETED',
        createdAt: { gte: start, lt: end },
        resourceId: { not: null },
      },
      select: { resourceId: true },
      distinct: ['resourceId'],
    });
    buckets.push({
      monthLabel: start.toLocaleString(undefined, { month: 'short', year: '2-digit' }),
      drafts: rows.length,
    });
  }
  return buckets;
}
