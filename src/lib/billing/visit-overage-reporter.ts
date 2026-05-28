/**
 * Daily visit overage reporter — pushes visit-bank overage counts to
 * Stripe metered subscription items for orgs with allowOverage enabled.
 */

import { prisma } from '@/lib/prisma';

export type VisitOverageReportRow = {
  orgId: string;
  overageVisits: number;
  reported_increment: number;
  status:
    | 'reported'
    | 'no_change'
    | 'skipped_no_contract'
    | 'skipped_overage_disabled'
    | 'skipped_no_subscription'
    | 'skipped_no_overage_item'
    | 'failed';
  error?: string;
  durationMs: number;
};

export type VisitOverageReporterDeps = {
  loadOrgContext: (orgId: string) => Promise<{
    overageSubscriptionItemId: string | null;
    overageReportedSoFar: number;
    currentPeriodStartIso: string;
  } | null>;
  reportToStripe: (args: {
    subscriptionItemId: string;
    quantity: number;
    idempotencyKey: string;
    timestampMs: number;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export async function countVisitOverageSince(orgId: string, periodStart: Date): Promise<number> {
  return prisma.visitLedgerEntry.count({
    where: {
      orgId,
      sourceType: 'NOTE_DEBIT',
      createdAt: { gte: periodStart },
      metadata: {
        path: ['overage'],
        equals: true,
      },
    },
  });
}

export async function reportVisitOverageForOrg(
  orgId: string,
  deps: VisitOverageReporterDeps,
  now: Date = new Date(),
): Promise<VisitOverageReportRow> {
  const start = Date.now();

  const contract = await prisma.organizationCommercialContract.findUnique({
    where: { orgId },
    select: { allowOverage: true, capacityEnforcementEnabled: true },
  });

  if (!contract?.capacityEnforcementEnabled) {
    return {
      orgId,
      overageVisits: 0,
      reported_increment: 0,
      status: 'skipped_no_contract',
      durationMs: Date.now() - start,
    };
  }

  if (!contract.allowOverage) {
    return {
      orgId,
      overageVisits: 0,
      reported_increment: 0,
      status: 'skipped_overage_disabled',
      durationMs: Date.now() - start,
    };
  }

  const ctx = await deps.loadOrgContext(orgId);
  if (!ctx) {
    return {
      orgId,
      overageVisits: 0,
      reported_increment: 0,
      status: 'skipped_no_subscription',
      durationMs: Date.now() - start,
    };
  }

  if (!ctx.overageSubscriptionItemId) {
    return {
      orgId,
      overageVisits: 0,
      reported_increment: 0,
      status: 'skipped_no_overage_item',
      durationMs: Date.now() - start,
    };
  }

  const periodStart = new Date(ctx.currentPeriodStartIso);
  const overageVisits = await countVisitOverageSince(orgId, periodStart);
  const reported_increment = Math.max(0, overageVisits - ctx.overageReportedSoFar);

  if (reported_increment === 0) {
    return {
      orgId,
      overageVisits,
      reported_increment: 0,
      status: 'no_change',
      durationMs: Date.now() - start,
    };
  }

  const dayKey = now.toISOString().slice(0, 10).replace(/-/g, '');
  const stripeResult = await deps.reportToStripe({
    subscriptionItemId: ctx.overageSubscriptionItemId,
    quantity: reported_increment,
    idempotencyKey: `visit-overage:${orgId}:${dayKey}`,
    timestampMs: now.getTime(),
  });

  if (!stripeResult.ok) {
    return {
      orgId,
      overageVisits,
      reported_increment,
      status: 'failed',
      error: stripeResult.error,
      durationMs: Date.now() - start,
    };
  }

  return {
    orgId,
    overageVisits,
    reported_increment,
    status: 'reported',
    durationMs: Date.now() - start,
  };
}

export async function reportVisitOverageAllOrgs(
  deps: VisitOverageReporterDeps,
  now: Date = new Date(),
): Promise<VisitOverageReportRow[]> {
  const orgs = await prisma.organization.findMany({
    where: {
      stripeSubscriptionId: { not: null },
      commercialContract: {
        allowOverage: true,
        capacityEnforcementEnabled: true,
      },
    },
    select: { id: true },
  });

  const rows: VisitOverageReportRow[] = [];
  for (const { id } of orgs) {
    rows.push(await reportVisitOverageForOrg(id, deps, now));
  }
  return rows;
}
